import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type ExtensionContext, parseFrontmatter } from "@earendil-works/pi-coding-agent";

/**
 * The specialist agents, and how one of them runs.
 *
 * A subagent is its own pi process: its own context, its own tool allowlist,
 * and the agent file's body as its system prompt. The `task` tool and the
 * workflow runner both start agents, so the machinery lives here.
 */

/** One agent of the package, read from its file. */
export interface AgentSpec {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	filePath: string;
}

/** The tool list of an agent's frontmatter, in either spelling. */
export function parseToolList(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((t): t is string => typeof t === "string")
		.map((t) => t.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

/** Every agent of the package, by file name. */
export function loadAgents(agentsDir: string): AgentSpec[] {
	if (!fs.existsSync(agentsDir)) return [];
	const agents: AgentSpec[] = [];
	for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
		if (!entry.name.endsWith(".md")) continue;
		const filePath = path.join(agentsDir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}
		let frontmatter: Record<string, unknown>;
		let body: string;
		try {
			({ frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content));
		} catch {
			continue;
		}
		const name = typeof frontmatter.name === "string" ? frontmatter.name : entry.name.replace(/\.md$/, "");
		const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
		agents.push({
			name,
			description,
			tools: parseToolList(frontmatter.tools),
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			systemPrompt: body,
			filePath,
		});
	}
	return agents.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How to start pi again from inside pi: the running script when there is one, the
 * `pi` binary otherwise.
 */
export function piInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

export interface SubagentResult {
	agent: string;
	description: string;
	exitCode: number;
	output: string;
	stderr: string;
	turns: number;
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}

interface JsonEvent {
	type?: string;
	toolCallId?: string;
	toolName?: string;
	args?: Record<string, unknown>;
	isError?: boolean;
	result?: { content?: { type?: string; text?: string }[]; errorMessage?: string };
	message?: {
		role?: string;
		content?: { type: string; text?: string }[];
		usage?: {
			input?: number;
			output?: number;
			cacheRead?: number;
			cacheWrite?: number;
			cost?: { total?: number };
		};
		model?: string;
		stopReason?: string;
		errorMessage?: string;
	};
}

/** The last assistant text of a subagent run. */
export function finalText(result: SubagentResult): string {
	return result.output.trim();
}

/**
 * A short subject for a call, from the arguments the tools commonly carry.
 *
 * The upstream's fleet names a call the same way: a file's name, or a command's
 * head — what the call was aimed at, not where it ran.
 */
export function subjectOf(tool: string, args: Readonly<Record<string, unknown>>): string {
	const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : undefined);
	const path = str("file_path") ?? str("path") ?? str("notebook_path");

	if (path !== undefined) {
		return path.split("/").slice(-1)[0] ?? path;
	}

	const command = str("command");

	if (command !== undefined) {
		// What runs, not where: a leading `cd …`, `VAR=…;` or `export …` says nothing at a glance.
		const lead = /^(?:\s*(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)(?:\s+\d?>{1,2}\s*\S+)*|(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*))\s*(?:&&|;)\s*)+/;

		return command.replace(/\s+/g, " ").replace(lead, "").slice(0, 48);
	}

	return (str("pattern") ?? str("description") ?? str("query") ?? str("prompt") ?? "").replace(/\s+/g, " ").slice(0, 48);
}

/** The failure text of a failed tool call, as the fleet's shared-failure detection reads it. */
export function errorTextOf(result: JsonEvent["result"]): string {
	if (result === undefined || result === null) {
		return "";
	}

	if (typeof result.errorMessage === "string" && result.errorMessage !== "") {
		return result.errorMessage;
	}

	const parts = (result.content ?? [])
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string);

	return parts.join("\n");
}

/** What a subagent did, as the panel's fleet records it. */
export type SubagentCall = {
	/** The tool the agent called. */
	tool: string;
	/** A short name for what the call was aimed at. */
	subject: string;
	/** The failure text, when the call failed. */
	error?: string;
};

/** Runs one agent in its own pi process. */
export async function runSubagent(
	agent: AgentSpec,
	task: string,
	description: string,
	ctx: ExtensionContext,
	cwd: string | undefined,
	signal: AbortSignal | undefined,
	onUpdate: ((text: string) => void) | undefined,
	onCall: ((call: SubagentCall) => void) | undefined,
): Promise<SubagentResult> {
	// The child gets its own process, its own context and its own tool allowlist.
	// Project instruction files (AGENTS.md) still reach it, like any other agent in the workspace.
	const args: string[] = ["--mode", "json", "-p", "--no-session", "--no-skills"];

	const model = agent.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined);
	if (model) args.push("--model", model);
	if (!agent.model && ctx.thinkingLevel) args.push("--thinking", ctx.thinkingLevel);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	// The agent body is the system prompt of the subagent, on top of pi's own.
	let promptFile: string | null = null;
	let promptDir: string | null = null;
	if (agent.systemPrompt.trim()) {
		promptDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cm-subagent-"));
		promptFile = path.join(promptDir, "agent.md");
		fs.writeFileSync(promptFile, agent.systemPrompt, { encoding: "utf-8", mode: 0o600 });
		args.push("--append-system-prompt", promptFile);
	}

	args.push("--", task);

	const result: SubagentResult = {
		agent: agent.name,
		description,
		exitCode: 0,
		output: "",
		stderr: "",
		turns: 0,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		model,
	};

	let aborted = false;

	try {
		result.exitCode = await new Promise<number>((resolve) => {
			const invocation = piInvocation(args);
			const child = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? ctx.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, CODE_MODERNIZATION_SUBAGENT: "1" },
			});

			let buffer = "";
			// The subject of each call, by its id: the end event carries no
			// arguments, so a failure is named by the call that started it.
			const subjects = new Map<string, string>();

			const handleLine = (line: string) => {
				if (!line.trim()) return;
				let event: JsonEvent;
				try {
					event = JSON.parse(line) as JsonEvent;
				} catch {
					return;
				}

				// The child's own tool calls: pi's JSON mode reports them, so the
				// fleet sees what each agent did, the way the upstream's does.
				if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
					const subject = subjectOf(event.toolName, event.args ?? {});

					subjects.set(event.toolCallId ?? "", subject);
					onCall?.({ tool: event.toolName, subject });

					return;
				}

				if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
					const failure = event.isError === true ? errorTextOf(event.result) : "";

					// The call itself was counted when it started; only its
					// failure is news.
					if (failure !== "") {
						onCall?.({
							tool: event.toolName,
							subject: subjects.get(event.toolCallId ?? "") ?? "",
							error: failure,
						});
					}

					subjects.delete(event.toolCallId ?? "");

					return;
				}

				const message = event.message;
				if (!message) return;
				if (event.type === "message_end" && message.role === "assistant") {
					const text = (message.content ?? [])
						.filter((part) => part.type === "text" && typeof part.text === "string")
						.map((part) => part.text as string)
						.join("");
					if (text) result.output = text;
					result.turns += 1;
					const usage = message.usage;
					if (usage) {
						result.usage.input += usage.input ?? 0;
						result.usage.output += usage.output ?? 0;
						result.usage.cacheRead += usage.cacheRead ?? 0;
						result.usage.cacheWrite += usage.cacheWrite ?? 0;
						result.usage.cost += usage.cost?.total ?? 0;
					}
					if (!result.model && message.model) result.model = message.model;
					if (message.stopReason) result.stopReason = message.stopReason;
					if (message.errorMessage) result.errorMessage = message.errorMessage;
					onUpdate?.(result.output);
				}
			};

			child.stdout.on("data", (data: Buffer) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) handleLine(line);
			});
			child.stderr.on("data", (data: Buffer) => {
				result.stderr += data.toString();
			});
			child.on("close", (code) => {
				if (buffer.trim()) handleLine(buffer);
				resolve(code ?? 0);
			});
			child.on("error", (error: Error) => {
				result.stderr += `${error.message}\n`;
				resolve(1);
			});

			if (signal) {
				const kill = () => {
					aborted = true;
					child.kill("SIGTERM");
					setTimeout(() => {
						if (!child.killed) child.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) kill();
				else signal.addEventListener("abort", kill, { once: true });
			}
		});

		if (aborted) throw new Error(`Subagent "${agent.name}" was aborted`);
		return result;
	} finally {
		if (promptFile) {
			try {
				fs.unlinkSync(promptFile);
			} catch {
				/* ignore */
			}
		}
		if (promptDir) {
			try {
				fs.rmdirSync(promptDir);
			} catch {
				/* ignore */
			}
		}
	}
}
