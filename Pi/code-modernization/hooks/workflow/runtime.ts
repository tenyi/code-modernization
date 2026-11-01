/**
 * The workflow runner: a scripted fan-out, run by the `workflow` tool.
 *
 * The upstream plugin ships six workflow scripts and a runtime that executes
 * them. The runtime's contract is small — an `agent()` that starts one
 * subagent and returns its structured answer, a `parallel()` and a
 * `pipeline()` over those calls, a `log()` for progress, and a `budget` the
 * script may consult — and the scripts themselves are plain JavaScript that
 * use nothing else.
 *
 * So the port keeps the scripts and gives them the same contract, bound to
 * pi's own subagents: `agent()` is one `task` call whose answer is parsed
 * against the schema the script asked for, and `parallel()` runs a batch of
 * them at once.
 */

/** The options a script passes to `agent()`. */
export type AgentOptions = {
	/** Which specialist runs it. `code-modernization:<name>` and a bare name both work. */
	agentType?: string;
	/** A short name for the work item, shown in the panel's fleet. */
	label?: string;
	/** The phase of the run this belongs to. */
	phase?: string;
	/** The JSON schema the answer must have. */
	schema?: JsonSchema;
};

/** The JSON schema shape the scripts write their answers against. */
export type JsonSchema = {
	type?: string;
	required?: string[];
	properties?: Record<string, { type?: string; description?: string; items?: { type?: string } }>;
};

/** What `agent()` resolves to: the parsed answer, or null when the agent died. */
export type AgentAnswer = Record<string, unknown> | null;

/** The host the workflow scripts run against. */
export type WorkflowHost = {
	/** Starts one subagent and returns its structured answer. */
	agent: (prompt: string, options?: AgentOptions) => Promise<AgentAnswer>;
	/** Runs the thunks at once, in order, and returns their answers. */
	parallel: (thunks: (() => Promise<AgentAnswer>)[]) => Promise<AgentAnswer[]>;
	/** Maps the items through `fn`, in order. */
	pipeline: <T, R>(items: T[], fn: (item: T, original: T, index: number) => Promise<R>) => Promise<R[]>;
	/** A line of progress. */
	log: (message: string) => void;
	/** The token budget the run may spend; zero when the person set none. */
	budget: { total: number; remaining: () => number };
};

/**
 * The JSON schema, as the instruction a subagent is given.
 *
 * The scripts ask for a structured answer; pi's subagents answer in prose, so
 * the schema becomes an instruction and the answer is parsed back out.
 */
export function schemaInstruction(schema: JsonSchema | undefined): string {
	if (schema === undefined) {
		return "";
	}

	const required = schema.required ?? [];
	const properties = Object.entries(schema.properties ?? {}).map(([name, spec]) => {
		const type = spec.type ?? "any";

		return `  "${name}": ${type}${spec.description !== undefined ? ` — ${spec.description}` : ""}`;
	});

	return [
		"",
		"Return your answer as a single JSON object and nothing else: no prose, no code fences.",
		`Its required properties are: ${required.length > 0 ? required.join(", ") : "(none)"}.`,
		properties.length > 0 ? "Its properties are:" : "",
		...properties,
	]
		.filter((part) => part !== "")
		.join("\n");
}

/**
 * The JSON object in a subagent's answer, or null when there is none.
 *
 * The answer may be fenced, may carry a sentence before it, or may be the
 * object alone; all three are read.
 */
export function parseAnswer(text: string): AgentAnswer {
	const trimmed = text.trim();

	if (trimmed === "") {
		return null;
	}

	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);

	if (fenced !== null) {
		const parsed = parseJson(fenced[1] ?? "");

		if (parsed !== null) {
			return parsed;
		}
	}

	const parsed = parseJson(trimmed);

	if (parsed !== null) {
		return parsed;
	}

	// The object may sit inside a sentence: take the outermost braces.
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");

	if (start < 0 || end <= start) {
		return null;
	}

	return parseJson(trimmed.slice(start, end + 1));
}

/** The parsed JSON, when it is an object. */
function parseJson(text: string): AgentAnswer {
	try {
		const value: unknown = JSON.parse(text);

		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Whether an answer has every property the schema requires. */
export function meetsSchema(answer: AgentAnswer, schema: JsonSchema | undefined): boolean {
	if (answer === null) {
		return false;
	}

	if (schema === undefined) {
		return true;
	}

	return (schema.required ?? []).every((name) => answer[name] !== undefined);
}

/**
 * The agent name a script's `agentType` names.
 *
 * The upstream writes `code-modernization:<name>`; pi's agents are the bare
 * names, so the namespace is dropped when it is there.
 */
export const agentNameOf = (agentType: string | undefined): string => {
	if (agentType === undefined) {
		return "";
	}

	const colon = agentType.lastIndexOf(":");

	return colon < 0 ? agentType : agentType.slice(colon + 1);
};

/**
 * Runs the thunks at once, with at most `limit` of them in flight.
 *
 * The order the thunks are given in is the order they start in: the upstream's
 * scripts rely on that, because a resumed run replays its agents by the
 * order it spawned them.
 */
export async function runParallel(thunks: (() => Promise<AgentAnswer>)[], limit = 8): Promise<AgentAnswer[]> {
	const results: AgentAnswer[] = new Array(thunks.length).fill(null);

	let next = 0;

	const worker = async () => {
		for (;;) {
			const index = next++;

			if (index >= thunks.length) {
				return;
			}

			const thunk = thunks[index];

			if (thunk === undefined) {
				continue;
			}

			try {
				results[index] = await thunk();
			} catch {
				// A failed agent is a null answer: the script counts it and moves on.
				results[index] = null;
			}
		}
	};

	const workers = Array.from({ length: Math.max(1, Math.min(limit, thunks.length)) }, () => worker());

	await Promise.all(workers);

	return results;
}

/** Maps the items through `fn`, in order, at most `limit` at a time. */
export async function runPipeline<T, R>(items: T[], fn: (item: T, original: T, index: number) => Promise<R>, limit = 8): Promise<R[]> {
	const thunks = items.map((item, index) => async () => fn(item, item, index));

	return (await runParallel(thunks as unknown as (() => Promise<AgentAnswer>)[], limit)) as unknown as R[];
}
