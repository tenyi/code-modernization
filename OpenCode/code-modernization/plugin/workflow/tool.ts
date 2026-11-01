// The `workflow` tool: a scripted fan-out, run from the calling session.
//
// The upstream plugin ships six workflow scripts and a tool that runs one by
// name. The port keeps the scripts and the tool's shape, and binds the runtime
// to OpenCode: `agent()` starts one of the package's specialists in its own
// child session, reads its answer back against the schema the script asked
// for, and `parallel()` runs a batch of those at once.
//
// The script text is the upstream's, unchanged apart from the runtime names
// (bare agent ids, `@` skill references, lowercase tool names), so a workflow
// fixed upstream can be re-synced without being rewritten.

import { createHost, readJournal, runIdOf, type Journal, type WorkflowContext } from "./host";
import { listScripts, readScript, runScript, type WorkflowScript } from "./loader";

/** The slice of the plugin context this module needs. */
export type WorkflowPluginContext = WorkflowContext & {
	tool: {
		transform(callback: (editor: { add(tool: WorkflowToolDefinition): void }) => void): Promise<unknown>;
	};
};

type WorkflowToolDefinition = {
	name: string;
	description: string;
	input: Record<string, unknown>;
	execute: (
		input: { name?: unknown; args?: unknown },
		context: { sessionID: string; signal?: AbortSignal; progress?: (update: { status?: string }) => void | Promise<void> },
	) => Promise<{ content: string }>;
};

/** The names of the workflows this package ships. */
const WORKFLOW_DESCRIPTION = [
	"Run one of the package's scripted fan-outs: a workflow starts a batch of specialists itself and returns",
	"their structured answers, so the shards of a large system are cut and worked in one call.",
	"Call it by name (`modernize-extract-rules-mine`, `modernize-portfolio-assess`, `modernize-harden-scan`,",
	"`modernize-reimagine-scaffold`, `modernize-uplift-deltas`, `modernize-uplift-migrate`) with the arguments",
	"the workflow asks for. The result is a JSON object: render the artifacts from it, never from the agents' prose.",
].join(" ");

/** The input schema the model sees. */
const WORKFLOW_INPUT = {
	type: "object",
	properties: {
		name: {
			type: "string",
			description:
				"The workflow to run, by the name of its script: modernize-extract-rules-mine, " +
				"modernize-portfolio-assess, modernize-harden-scan, modernize-reimagine-scaffold, " +
				"modernize-uplift-deltas or modernize-uplift-migrate.",
		},
		args: {
			type: "object",
			additionalProperties: true,
			description:
				"The arguments the workflow's meta describes: system, modules, services, systems, " +
				"batchSize, modulePattern, maxRounds, parentDir, source, target, units, resumeFromRunId.",
		},
	},
	required: ["name"],
	additionalProperties: false,
};

/**
 * Registers the `workflow` tool.
 *
 * `scriptsDir` is `<package>/workflows`: the six scripts the package ships.
 */
export async function registerWorkflowTool(
	ctx: WorkflowPluginContext,
	options: { scriptsDir: string },
): Promise<void> {
	/** The script a name stands for: by its file name or by the name it declares. */
	const findScript = async (name: string): Promise<WorkflowScript | null> => {
		const wanted = name.trim().toLowerCase();
		const files = await listScripts(options.scriptsDir);

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

	await ctx.tool.transform((editor) => {
		editor.add({
			name: "workflow",
			description: WORKFLOW_DESCRIPTION,
			input: WORKFLOW_INPUT,
			execute: async (input, context) => {
				const requested = typeof input.name === "string" ? input.name : "";
				const script = await findScript(requested);

				if (script === null) {
					const available = (await listScripts(options.scriptsDir)).map((entry) => entry.name);

					return {
						content: `There is no workflow called "${requested}". The package ships: ${
							available.join(", ") || "none"
						}.`,
					};
				}

				const args = readArgs(input.args);
				const runId =
					typeof args.resumeFromRunId === "string" && args.resumeFromRunId !== ""
						? args.resumeFromRunId
						: runIdOf(script.meta.name, args);

				const cwd = await workspaceOf(ctx, context.sessionID);
				const journal: Journal = readJournal(cwd, runId);

				const { host, log } = await createHost(ctx, context.sessionID, context, {
					cwd,
					runId,
					journal,
				});

				try {
					const outcome = await runScript(script, args, host);
					const text = JSON.stringify(outcome ?? null, null, 2);

					return { content: log.length > 0 ? `${log.join("\n")}\n\n${text}` : text };
				} catch (error) {
					const message = (error as Error).message;
					const notes = log.length > 0 ? `\n\n${log.join("\n")}` : "";

					return { content: `The workflow "${script.meta.name}" failed: ${message}${notes}` };
				}
			},
		});
	});
}

/** The workflow arguments, whether the caller sent an object or its JSON text. */
function readArgs(value: unknown): Record<string, unknown> {
	if (typeof value === "string") {
		try {
			const parsed: unknown = JSON.parse(value);

			return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	}

	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** The directory the workspace's `analysis/` and `legacy/` live in. */
async function workspaceOf(ctx: WorkflowContext, sessionID: string): Promise<string> {
	try {
		const response = await ctx.session.get({ sessionID });
		const session =
			response !== null && typeof response === "object" && typeof (response as Record<string, unknown>).id === "string"
				? (response as Record<string, unknown>)
				: ((response as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined);
		const directory = session?.directory;

		if (typeof directory === "string" && directory !== "") return directory;
	} catch {
		// fall through
	}

	return ctx.location.directory;
}
