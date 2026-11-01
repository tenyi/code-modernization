// The OpenCode side of the workflow runtime: how `agent()` becomes real work.
//
// The upstream's workflow scripts ask their host for one agent at a time; the
// port binds that call to an OpenCode child session — the same primitive the
// built-in `subagent` tool uses. Each agent gets its own context, the package's
// agent file as its system prompt, and the schema the script asked for as an
// instruction; its last assistant text is parsed back into the answer.
//
// The journal is the same file the other ports write
// (`.code-modernization/workflow-journal.jsonl`): a resumed run replays the
// agents that already finished, so a stopped fan-out does not start over.

import * as fs from "node:fs";
import * as path from "node:path";

import {
	agentNameOf,
	meetsSchema,
	parseAnswer,
	runParallel,
	runPipeline,
	schemaInstruction,
	type AgentAnswer,
	type WorkflowHost,
} from "./runtime";

/** How many agents a batch runs at once. */
export const BATCH = 8;

/** The journal of finished agents, so a stopped run can resume. */
export const JOURNAL_DIR = ".code-modernization";
export const JOURNAL_FILE = "workflow-journal.jsonl";

/** One finished agent, as the journal holds it. */
export type JournalEntry = { runId: string; key: string; result: AgentAnswer };

/** The slice of the plugin context this module needs. */
export type WorkflowContext = {
	location: { directory: string };
	agent: { list(input?: unknown): Promise<unknown> };
	session: {
		get(input: { sessionID: string }): Promise<unknown>;
		create(input: {
			parentID?: string;
			agent?: string;
			model?: unknown;
			location?: unknown;
			title?: string;
		}): Promise<unknown>;
		prompt(input: { sessionID: string; text: string }): Promise<unknown>;
		wait(input: { sessionID: string }): Promise<unknown>;
		context(input: { sessionID: string }): Promise<unknown>;
		interrupt(input: { sessionID: string; resume: boolean }): Promise<unknown>;
	};
};

/** What the tool executor knows about the call being served. */
export type ToolExecutionContext = {
	sessionID: string;
	signal?: AbortSignal;
	progress?: (update: { status?: string }) => void | Promise<void>;
};

/** A finished run's ledger, read once when the tool starts. */
export type Journal = Map<string, AgentAnswer>;

/** The journal's file, for a workspace. */
export const journalPath = (cwd: string): string => path.join(cwd, JOURNAL_DIR, JOURNAL_FILE);

/** The finished agents the journal holds for a run. */
export function readJournal(cwd: string, runId: string): Journal {
	const out: Journal = new Map();

	let text: string;

	try {
		text = fs.readFileSync(journalPath(cwd), "utf-8");
	} catch {
		return out;
	}

	for (const line of text.split("\n")) {
		if (line.trim() === "") continue;

		try {
			const entry = JSON.parse(line) as JournalEntry;

			if (entry.runId === runId && typeof entry.key === "string") {
				out.set(entry.key, entry.result ?? null);
			}
		} catch {
			// A broken line is a line that was never finished.
		}
	}

	return out;
}

/** Adds a finished agent to the journal. */
export function writeJournal(cwd: string, entry: JournalEntry): void {
	try {
		fs.mkdirSync(path.join(cwd, JOURNAL_DIR), { recursive: true });
		fs.appendFileSync(journalPath(cwd), `${JSON.stringify(entry)}\n`, "utf-8");
	} catch {
		// A run that cannot be journalled still runs; it simply cannot resume.
	}
}

/** A stable key for one agent call, so a resumed run replays it. */
export function keyOf(prompt: string, agentType: string): string {
	let hash = 2166136261;

	for (const char of `${agentType}::${prompt}`) {
		hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	}

	return (hash >>> 0).toString(16);
}

/** A stable key for one run. */
export function runIdOf(name: string, args: unknown): string {
	return keyOf(name, JSON.stringify(args ?? {}));
}

/** The plugin adapter unwraps single-property `{data}` responses; others stay wrapped. */
function unwrap(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;

	const record = value as Record<string, unknown>;

	if (typeof record.id === "string") return record;

	const data = record.data;

	return data !== null && typeof data === "object" && !Array.isArray(data)
		? (data as Record<string, unknown>)
		: undefined;
}

/** A list response, whether the adapter unwrapped it or not. */
function listOf(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) return value as Record<string, unknown>[];

	if (value !== null && typeof value === "object") {
		const data = (value as Record<string, unknown>).data;

		if (Array.isArray(data)) return data as Record<string, unknown>[];
	}

	return [];
}

/** The text parts of one message, joined. */
function textOf(message: unknown): string {
	const record = (message ?? {}) as Record<string, unknown>;

	// Some adapters hand back `{info, parts}` rather than the message itself.
	const parts = Array.isArray(record.content)
		? record.content
		: Array.isArray(record.parts)
			? record.parts
			: [];

	return parts
		.filter(
			(part): part is { type: string; text: string } =>
				part !== null &&
				typeof part === "object" &&
				(part as Record<string, unknown>).type === "text" &&
				typeof (part as Record<string, unknown>).text === "string",
		)
		.map((part) => part.text)
		.join("\n")
		.trim();
}

/** The last assistant text of a child session. */
export function finalText(messages: unknown[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];

		if (message === null || typeof message !== "object") continue;

		const record = message as Record<string, unknown>;

		if (record.type !== "assistant") continue;

		const text = textOf(message);

		if (text !== "") return text;
	}

	return "";
}

/** The child session's outcome, when it has one. */
function outcomeOf(session: Record<string, unknown> | undefined): string | undefined {
	const outcome = session?.outcome;

	return typeof outcome === "string" ? outcome : undefined;
}

/**
 * Builds the host the workflow scripts run against.
 *
 * The parent session is the session that called the tool: the children are
 * parented to it, so they show up in its hierarchy — and in the panel's fleet
 * — exactly like the built-in `subagent` calls do.
 */
export async function createHost(
	ctx: WorkflowContext,
	parentSessionID: string,
	tool: ToolExecutionContext,
	config: { cwd: string; runId: string; journal: Journal },
): Promise<{ host: WorkflowHost; log: string[] }> {
	const log: string[] = [];

	let agentIDs: Set<string> | undefined;

	async function knownAgent(name: string): Promise<boolean> {
		if (agentIDs === undefined) {
			try {
				agentIDs = new Set(
					listOf(await ctx.agent.list({ location: { directory: config.cwd } }))
						.map((agent) => (typeof agent.id === "string" ? agent.id : ""))
						.filter((id) => id !== ""),
				);
			} catch {
				agentIDs = new Set();
			}
		}

		return agentIDs.has(name);
	}

	const parent = unwrap(await ctx.session.get({ sessionID: parentSessionID }).catch(() => undefined));
	const model = parent?.model;
	const location = parent?.location ?? { directory: config.cwd };

	async function startAgent(prompt: string, agentType: string, label: string): Promise<string | undefined> {
		const created = unwrap(
			await ctx.session
				.create({
					parentID: parentSessionID,
					agent: agentType,
					...(model !== undefined ? { model } : {}),
					...(location !== undefined ? { location } : {}),
					title: `workflow: ${label}`,
				})
				.catch(() => undefined),
		);

		const sessionID = typeof created?.id === "string" ? created.id : "";

		if (sessionID === "") {
			log.push(`${label}: the child session could not be created.`);

			return undefined;
		}

		const onAbort = () => {
			void ctx.session.interrupt({ sessionID, resume: false }).catch(() => {});
		};

		tool.signal?.addEventListener("abort", onAbort, { once: true });

		try {
			await tool.progress?.({ status: `workflow: ${label}` });

			await ctx.session.prompt({ sessionID, text: prompt });

			// `wait` resolves when the session is idle again. A failure here is
			// not fatal: the context below is still the agent's answer so far.
			await ctx.session.wait({ sessionID }).catch(() => {});

			return sessionID;
		} catch (error) {
			log.push(`${label}: ${(error as Error).message}`);

			return sessionID;
		} finally {
			tool.signal?.removeEventListener("abort", onAbort);
		}
	}

	const host: WorkflowHost = {
		async agent(prompt: string, options): Promise<AgentAnswer> {
			const agentType = agentNameOf(options?.agentType);
			const label = options?.label ?? agentType;

			if (agentType === "") {
				log.push(`${label}: the workflow did not name an agent.`);

				return null;
			}

			if (!(await knownAgent(agentType))) {
				log.push(`No agent called "${agentType}": the workflow cannot run it.`);

				return null;
			}

			const key = keyOf(prompt, agentType);

			// A resumed run replays the agents that already finished.
			if (config.journal.has(key)) {
				log.push(`${label}: replayed from the journal.`);

				return config.journal.get(key) ?? null;
			}

			const sessionID = await startAgent(`${prompt}${schemaInstruction(options?.schema)}`, agentType, label);

			if (sessionID === undefined) {
				return null;
			}

			const finished = unwrap(await ctx.session.get({ sessionID }).catch(() => undefined));
			const outcome = outcomeOf(finished);

			if (outcome === "failed" || outcome === "interrupted") {
				log.push(`${label}: the agent ${outcome}.`);

				return null;
			}

			const messages = listOf(await ctx.session.context({ sessionID }).catch(() => []));
			const answer = parseAnswer(finalText(messages));

			if (!meetsSchema(answer, options?.schema)) {
				log.push(`${label}: the answer did not have the shape the workflow asked for.`);

				return null;
			}

			writeJournal(config.cwd, { runId: config.runId, key, result: answer });

			return answer;
		},

		parallel: (thunks) => runParallel(thunks, BATCH),

		pipeline: (items, fn) => runPipeline(items, fn, BATCH),

		log: (message: string) => {
			log.push(message);
		},

		// OpenCode does not set a token target for a turn's agents; the
		// scripts' own agent cap is the only limit that bites.
		budget: { total: 0, remaining: () => Number.POSITIVE_INFINITY },
	};

	return { host, log };
}
