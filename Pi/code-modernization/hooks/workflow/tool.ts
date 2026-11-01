import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { noteAgent, noteCall, noteDone, noteFailure } from "../fleet/fleet";
import { finalText, runSubagent, type AgentSpec } from "../subagent";
import type { Panel } from "../panel";
import { listScripts, readScript, runScript, type WorkflowScript } from "./loader";
import { agentNameOf, meetsSchema, parseAnswer, runParallel, runPipeline, schemaInstruction, type AgentAnswer, type WorkflowHost } from "./runtime";

/**
 * The `workflow` tool: a scripted fan-out.
 *
 * The upstream plugin registers six workflow scripts and a tool that runs one
 * by name. The port keeps the scripts and the tool's shape, and binds the
 * runtime to pi: `agent()` starts one of the package's specialists in its own
 * process, reads its answer back against the schema the script asked for, and
 * `parallel()` runs a batch of those at once.
 */

/** How many agents a batch runs at once. */
const BATCH = 8;

/** The journal of finished agents, so a stopped run can resume. */
const JOURNAL_DIR = ".code-modernization";
const JOURNAL_FILE = "workflow-journal.jsonl";

const WorkflowParams = Type.Object({
	name: Type.String({
		description:
			"The workflow to run, by the name of its script: modernize-extract-rules-mine, modernize-portfolio-assess, " +
			"modernize-harden-scan, modernize-reimagine-scaffold, modernize-uplift-deltas or modernize-uplift-migrate.",
	}),
	args: Type.Optional(
		Type.Object(
			{
				system: Type.Optional(Type.String({ description: "The system under analysis/, the way the skills name it." })),
				modules: Type.Optional(Type.Array(Type.Any(), { description: "The shards a fan-out is cut into." })),
				services: Type.Optional(Type.Array(Type.Any(), { description: "The services a rebuild scaffolds." })),
				systems: Type.Optional(Type.Array(Type.String(), { description: "The systems a survey covers." })),
				batchSize: Type.Optional(Type.Number({ description: "How many shards run per batch." })),
				modulePattern: Type.Optional(Type.String({ description: "A pattern that narrows the scope." })),
				maxRounds: Type.Optional(Type.Number({ description: "How many rounds a lens run may take." })),
				parentDir: Type.Optional(Type.String({ description: "The directory a survey covers." })),
				source: Type.Optional(Type.String({ description: "The stack a delta scan starts from." })),
				target: Type.Optional(Type.String({ description: "The stack a delta scan goes to." })),
				units: Type.Optional(Type.Array(Type.Any(), { description: "The units an uplift migrates." })),
				resumeFromRunId: Type.Optional(Type.String({ description: "The run id of a stopped run to resume." })),
			},
			{ additionalProperties: true },
		),
	),
});

/** One finished agent, as the journal holds it. */
type JournalEntry = { runId: string; key: string; result: AgentAnswer };

/** The journal's file, for a workspace. */
const journalPath = (cwd: string): string => path.join(cwd, JOURNAL_DIR, JOURNAL_FILE);

/** The finished agents the journal holds for a run. */
function readJournal(cwd: string, runId: string): Map<string, AgentAnswer> {
	const out = new Map<string, AgentAnswer>();

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
function writeJournal(cwd: string, entry: JournalEntry): void {
	try {
		fs.mkdirSync(path.join(cwd, JOURNAL_DIR), { recursive: true });
		fs.appendFileSync(journalPath(cwd), `${JSON.stringify(entry)}\n`, "utf-8");
	} catch {
		// A run that cannot be journalled still runs; it simply cannot resume.
	}
}

/** A stable key for one agent call, so a resumed run replays it. */
const keyOf = (prompt: string, agentType: string): string => {
	let hash = 2166136261;

	for (const char of `${agentType}::${prompt}`) {
		hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	}

	return (hash >>> 0).toString(16);
};

/** A stable key for one run. */
const runIdOf = (name: string, args: unknown): string => keyOf(name, JSON.stringify(args ?? {}));

export type WorkflowBinding = {
	/** The names of the workflows this package ships. */
	names: () => Promise<string[]>;
};

/**
 * Registers the `workflow` tool.
 */
export function registerWorkflowTool(
	pi: ExtensionAPI,
	params: { scriptsDir: string; agents: AgentSpec[]; panel: () => Panel | null },
): WorkflowBinding {
	const { scriptsDir, agents } = params;

	/** The script a name stands for: by its file name or by the name it declares. */
	const findScript = async (name: string): Promise<WorkflowScript | null> => {
		const wanted = name.trim().toLowerCase();
		const files = await listScripts(scriptsDir);

		for (const entry of files) {
			if (entry.name === wanted || entry.name.replace(/-/g, "") === wanted.replace(/-/g, "")) {
				return readScript(entry.file);
			}
		}

		for (const entry of files) {
			const script = await readScript(entry.file);

			if (script.meta.name.toLowerCase() === wanted) {
				return script;
			}
		}

		return null;
	};

	pi.registerTool({
		name: "workflow",
		label: "Workflow",
		description: [
			"Run one of the package's scripted fan-outs: a workflow starts a batch of specialists itself and returns",
			"their structured answers, so the shards of a large system are cut and worked in one call.",
			"Call it by name (`modernize-extract-rules-mine`, `modernize-portfolio-assess`, `modernize-harden-scan`,",
			"`modernize-reimagine-scaffold`, `modernize-uplift-deltas`, `modernize-uplift-migrate`) with the arguments",
			"the workflow asks for. The result is a JSON object: render the artifacts from it, never from the agents' prose.",
		].join(" "),
		promptSnippet: "workflow: run a scripted fan-out of specialists and return their structured answers",
		parameters: WorkflowParams,

		async execute(_toolCallId, input, signal, onUpdate, ctx) {
			const script = await findScript(input.name);

			if (script === null) {
				const available = (await listScripts(scriptsDir)).map((entry) => entry.name);

				return {
					content: [
						{
							type: "text",
							text: `There is no workflow called "${input.name}". The package ships: ${available.join(", ") || "none"}.`,
						},
					],
					details: { workflow: input.name, error: "unknown workflow" },
					isError: true,
				};
			}

			const args = input.args ?? {};
			const runId = typeof args.resumeFromRunId === "string" && args.resumeFromRunId !== "" ? args.resumeFromRunId : runIdOf(script.meta.name, args);
			const journal = readJournal(ctx.cwd, runId);
			const log: string[] = [];

			const host: WorkflowHost = {
				async agent(prompt: string, options): Promise<AgentAnswer> {
					const agentType = agentNameOf(options?.agentType);
					const spec = agents.find((candidate) => candidate.name === agentType);

					if (spec === undefined) {
						log.push(`No agent called "${agentType}": the workflow cannot run it.`);

						return null;
					}

					const key = keyOf(prompt, agentType);

					// A resumed run replays the agents that already finished.
					if (journal.has(key)) {
						log.push(`${options?.label ?? agentType}: replayed from the journal.`);

						return journal.get(key) ?? null;
					}

					const fleet = params.panel()?.state.fleet;
					const agentId = `workflow-${agentType}-${key}`;

					if (fleet !== undefined) {
						noteAgent(fleet, agentId, Date.now(), agentType);
					}

					const result = await runSubagent(
						spec,
						`${prompt}${schemaInstruction(options?.schema)}`,
						options?.label ?? agentType,
						ctx,
						undefined,
						signal,
						onUpdate
							? (text) => onUpdate({ content: [{ type: "text", text }], details: { agent: agentType, label: options?.label } })
							: undefined,
						fleet === undefined
							? undefined
							: (call) => {
									noteCall(fleet, agentId, call.tool, call.subject, Date.now(), agentType);

									if (call.error !== undefined) {
										noteFailure(fleet, agentId, call.error, Date.now(), call.subject);
									}
								},
					);

					if (fleet !== undefined) {
						noteDone(fleet, agentId, Date.now());
					}

					const answer = parseAnswer(finalText(result));

					if (!meetsSchema(answer, options?.schema)) {
						log.push(`${options?.label ?? agentType}: the answer did not have the shape the workflow asked for.`);

						return null;
					}

					writeJournal(ctx.cwd, { runId, key, result: answer });

					return answer;
				},

				parallel: (thunks) => runParallel(thunks, BATCH),

				pipeline: (items, fn) => runPipeline(items, fn, BATCH),

				log: (message: string) => {
					log.push(message);
				},

				// pi sets no token target for a turn's agents, so the scripts'
				// own agent cap is the only limit that bites.
				budget: { total: 0, remaining: () => Number.POSITIVE_INFINITY },
			};

			try {
				const outcome = await runScript(script, args, host);
				const text = JSON.stringify(outcome ?? null, null, 2);

				return {
					content: [{ type: "text", text: log.length > 0 ? `${log.join("\n")}\n\n${text}` : text }],
					details: { workflow: script.meta.name, runId, agents: log.length },
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `The workflow "${script.meta.name}" failed: ${(error as Error).message}${
								log.length > 0 ? `\n\n${log.join("\n")}` : ""
							}`,
						},
					],
					details: { workflow: script.meta.name, runId, error: (error as Error).message },
					isError: true,
				};
			}
		},
	});

	return {
		names: async () => (await listScripts(scriptsDir)).map((entry) => entry.name),
	};
}

export type { ExtensionContext };
