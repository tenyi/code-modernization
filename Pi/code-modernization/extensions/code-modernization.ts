/**
 * code-modernization — pi extension.
 *
 * The Code Modernization package is written as skills plus specialist subagents. pi has
 * no scripted workflow runner, no subagent primitive and no questionnaire tool, so this
 * extension supplies the pieces the procedures need:
 *
 *   - `task`      — runs one specialist agent in its own pi process (isolated context).
 *   - `workflow`  — runs the package's scripted fan-outs: the upstream's workflow
 *                   scripts, with the runtime they expect, bound to pi's subagents.
 *   - `ask_user`  — asks the person a short questionnaire (1–4 questions, 2–4 options each).
 *   - the pane    — the progress pane, the rule review deck and the sign-off dialog,
 *                   drawn in the terminal, plus the standing line above the editor.
 *   - the hooks   — x-ray notes after a `read`, and the progress line with the next step.
 *
 * It also exports the package root as `$CODE_MODERNIZATION_ROOT`, so every skill can
 * reach `scripts/` and `assets/` without hard-coding a path.
 *
 * A subagent process is started with CODE_MODERNIZATION_SUBAGENT=1: in that mode the
 * extension registers nothing, so a subagent cannot delegate further or ask questions.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { noteAgent, noteCall, noteDone, noteFailure } from "../hooks/fleet/fleet";
import { finalText, loadAgents, runSubagent } from "../hooks/subagent";
import { registerPanel } from "../hooks/ui";
import { registerWorkflowTool } from "../hooks/workflow/tool";

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * The package root: the directory that holds `scripts/` and `assets/`.
 *
 * Looked up from the extension's own location (the normal case: the extension sits in
 * `<package>/extensions/`), so a package that is installed, copied or symlinked anywhere
 * still finds its own scripts. `CODE_MODERNIZATION_ROOT` overrides it when the extension
 * is installed apart from the rest of the package.
 */
function findPackageRoot(): string {
	const override = process.env.CODE_MODERNIZATION_ROOT;
	if (override && fs.existsSync(path.join(override, "scripts", "build_report.py"))) {
		return path.resolve(override);
	}
	let dir = EXTENSION_DIR;
	for (let depth = 0; depth < 6; depth++) {
		if (fs.existsSync(path.join(dir, "scripts", "build_report.py"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return path.resolve(EXTENSION_DIR, "..");
}

const PACKAGE_ROOT = findPackageRoot();
const AGENTS_DIR = path.join(PACKAGE_ROOT, "agents");
const SCRIPTS_DIR = path.join(PACKAGE_ROOT, "scripts");

/** Set in the subagent processes: no tools, no hooks, no status line. */
const IS_SUBAGENT = process.env.CODE_MODERNIZATION_SUBAGENT === "1";

/** Every bash call in the session inherits it, so skills can run the package scripts. */
process.env.CODE_MODERNIZATION_ROOT = PACKAGE_ROOT;

/** How long a hook script may take before it is dropped (seconds). */
const HOOK_TIMEOUT_SECONDS = 5;

const TaskParams = Type.Object({
	agent_name: Type.String({
		description:
			"Name of the specialist agent to run. One of the agents shipped with this package: " +
			"legacy-analyst, business-rules-extractor, architecture-critic, security-auditor, " +
			"test-engineer, version-delta-analyst, uplift-migrator, scaffolder.",
	}),
	description: Type.String({
		description: "Short name of the work item, e.g. extract:billing or find:breaking-changes.",
	}),
	prompt: Type.String({
		description:
			"The full prompt for the subagent. It sees none of this conversation, so it must carry " +
			"everything it needs: the files, the question, the output contract and the rules.",
	}),
});

const QuestionSchema = Type.Object({
	question: Type.String({ description: "The question to ask, in one or two sentences." }),
	header: Type.Optional(Type.String({ description: "Short label for the question, e.g. 'Scope'." })),
	options: Type.Array(Type.String(), {
		minItems: 2,
		maxItems: 4,
		description: "Two to four options the person can pick from.",
	}),
	multi: Type.Optional(
		Type.Boolean({
			description: "When true the person may pick several options (a checklist). Default: false.",
			default: false,
		}),
	),
});

const AskUserParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		maxItems: 4,
		description: "One to four questions, asked in order.",
	}),
});

/**
 * A checklist for the questions where several options may hold at once ("pick any").
 * Up and down move, space toggles, enter confirms, escape cancels.
 */
async function askMultiple(
	ctx: ExtensionContext,
	title: string,
	options: string[],
): Promise<string[] | undefined> {
	return ctx.ui.custom<string[] | undefined>((tui, theme, _keybindings, done) => {
		let index = 0;
		const chosen = new Set<number>();
		let cachedLines: string[] | undefined;

		const refresh = () => {
			cachedLines = undefined;
			tui.requestRender();
		};

		const render = (width: number): string[] => {
			if (cachedLines) return cachedLines;
			const lines: string[] = [];
			const wrap = (text: string) => lines.push(...wrapTextWithAnsi(text, Math.max(1, width)));
			wrap(theme.fg("accent", theme.bold(title)));
			lines.push("");
			options.forEach((option, i) => {
				const mark = chosen.has(i) ? "[x]" : "[ ]";
				const prefix = i === index ? "> " : "  ";
				const color = i === index ? "accent" : chosen.has(i) ? "success" : "text";
				wrap(`${prefix}${theme.fg(color, mark)} ${theme.fg(color, option)}`);
			});
			lines.push("");
			wrap(theme.fg("dim", "up/down move · space toggles · enter confirms · esc cancels"));
			return lines;
		};

		const handleInput = (data: string) => {
			if (matchesKey(data, Key.up)) {
				index = (index - 1 + options.length) % options.length;
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				index = (index + 1) % options.length;
				refresh();
				return;
			}
			if (data === " " || matchesKey(data, Key.space)) {
				if (chosen.has(index)) chosen.delete(index);
				else chosen.add(index);
				refresh();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				done(options.filter((_, i) => chosen.has(i)));
				return;
			}
			if (matchesKey(data, Key.escape)) {
				done(undefined);
				return;
			}
		};

		return { render, handleInput, invalidate: () => (cachedLines = undefined) };
	});
}

/**
 * Run one of the package's hook scripts and return the context it produced.
 * A hook never fails the turn: anything that goes wrong returns no context.
 */
async function runHookScript(script: string, payload: Record<string, unknown>): Promise<string> {
	return new Promise((resolve) => {
		const child = spawn("python3", [path.join(SCRIPTS_DIR, script)], {
			stdio: ["pipe", "pipe", "ignore"],
			env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
		});
		let out = "";
		let settled = false;
		const finish = (value: string) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish("");
		}, HOOK_TIMEOUT_SECONDS * 1000);
		child.stdout.on("data", (data: Buffer) => {
			out += data.toString();
		});
		child.on("error", () => {
			clearTimeout(timer);
			finish("");
		});
		child.on("close", () => {
			clearTimeout(timer);
			try {
				const parsed = JSON.parse(out) as {
					additionalContext?: string;
					hookSpecificOutput?: { additionalContext?: string };
				};
				finish(parsed.hookSpecificOutput?.additionalContext ?? parsed.additionalContext ?? "");
			} catch {
				finish("");
			}
		});
		try {
			child.stdin.write(JSON.stringify(payload));
			child.stdin.end();
		} catch {
			clearTimeout(timer);
			finish("");
		}
	});
}

export default function codeModernization(pi: ExtensionAPI) {
	// A subagent gets no tools and no hooks: it analyses, it does not orchestrate.
	if (IS_SUBAGENT) return;

	const agents = loadAgents(AGENTS_DIR);
	const agentNames = agents.map((agent) => agent.name);

	// The pane: the standing state above the editor, and the three surfaces
	// the upstream plugin draws in the terminal.
	const panel = registerPanel(pi);

	// The scripted fan-out: the package's workflow scripts, run by the runtime
	// they expect, with pi's subagents behind it.
	registerWorkflowTool(pi, {
		scriptsDir: path.join(PACKAGE_ROOT, "workflows"),
		agents,
		panel: () => panel.panel(),
	});

	pi.registerTool({
		name: "task",
		label: "Task",
		description: [
			"Run one specialist subagent in its own pi process, with an isolated context.",
			"One call is one work item: `agent_name` picks the specialist, `description` names the item,",
			"and `prompt` carries everything the subagent needs — it sees none of this conversation.",
			"Make several calls in one response and pi runs them in parallel; keep a batch to at most 8.",
			"A subagent returns one final message and nothing enforces its shape, so the prompt must spell out",
			"the output contract. Collect every result before writing any artifact.",
			`Available agents: ${agentNames.join(", ") || "none"}.`,
		].join(" "),
		promptSnippet: "task: run a specialist subagent (isolated context) and return its final message",
		parameters: TaskParams,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agent = agents.find((candidate) => candidate.name === params.agent_name);
			if (!agent) {
				return {
					content: [
						{
							type: "text",
							text:
								`Unknown agent: "${params.agent_name}". ` +
								`Available agents: ${agentNames.join(", ") || "none"}.`,
						},
					],
					details: { agent: params.agent_name, error: "unknown agent" },
					isError: true,
				};
			}

			try {
				// The fleet: the panel's session block counts the agents this
				// session has running, and how each of them ended.
				const fleet = panel.panel()?.state.fleet;
				const agentId = `${agent.name}-${params.description}-${Date.now()}`;

				if (fleet !== undefined) {
					noteAgent(fleet, agentId, Date.now(), agent.name);
				}

				const result = await runSubagent(
					agent,
					params.prompt,
					params.description,
					ctx,
					undefined,
					signal,
					onUpdate ? (text) => onUpdate({ content: [{ type: "text", text }], details: { agent: agent.name } }) : undefined,
					fleet === undefined
						? undefined
						: (call) => {
								noteCall(fleet, agentId, call.tool, call.subject, Date.now(), agent.name);

								if (call.error !== undefined) {
									const shared = noteFailure(fleet, agentId, call.error, Date.now(), call.subject);

									if (shared !== null) {
										ctx.ui.notify(`Fleet: ${shared.agents.size} agents hit the same failure: ${shared.text}`, "warning");
									}
								}
							},
				);

				if (fleet !== undefined) {
					noteDone(fleet, agentId, Date.now());
				}

				const output = finalText(result);
				const failed = result.exitCode !== 0 || result.stopReason === "error";
				const text = failed
					? `The subagent "${agent.name}" failed (exit ${result.exitCode}).\n` +
						`${result.errorMessage ?? result.stderr ?? ""}\n${output}`.trim()
					: output || "(the subagent returned no output)";

				return {
					content: [{ type: "text", text }],
					details: {
						agent: agent.name,
						description: params.description,
						exitCode: result.exitCode,
						turns: result.turns,
						usage: result.usage,
						model: result.model,
						stopReason: result.stopReason,
					},
					isError: failed,
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: `The subagent "${agent.name}" could not run: ${(error as Error).message}` }],
					details: { agent: agent.name, error: (error as Error).message },
					isError: true,
				};
			}
		},
	});

	pi.registerTool({
		name: "ask_user",
		label: "Ask user",
		description: [
			"Ask the person a short questionnaire: one to four questions, two to four options each.",
			"The person can always type their own answer instead of picking one.",
			"Use it for the decisions a person owns; never answer the questions yourself.",
			"In a headless run (no interactive UI) the call returns an error — pick the defaults then,",
			"and record the open items.",
		].join(" "),
		promptSnippet: "ask_user: ask the person a short questionnaire (1–4 questions, 2–4 options each)",
		parameters: AskUserParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text:
								"No interactive UI in this run: the questions could not be asked. " +
								"Pick the defaults, record the open items, and say what is still unanswered.",
						},
					],
					details: { questions: params.questions, answers: [], cancelled: true },
					isError: true,
				};
			}

			const answers: { question: string; answer: string; custom: boolean }[] = [];
			for (const question of params.questions) {
				const title = question.header ? `${question.header}: ${question.question}` : question.question;
				if (question.multi) {
					if (ctx.mode === "tui") {
						const picked = await askMultiple(ctx, title, question.options);
						if (picked === undefined) {
							answers.push({ question: title, answer: "(cancelled)", custom: false });
							break;
						}
						answers.push({
							question: title,
							answer: picked.length > 0 ? picked.join("; ") : "(nothing selected)",
							custom: false,
						});
						continue;
					}
					// Outside the terminal UI the checklist cannot be drawn: ask for the choices.
					const typed = await ctx.ui.input(
						`${title} — pick any of: ${question.options.join(", ")}`,
						"comma-separated choices",
					);
					answers.push({ question: title, answer: typed?.trim() || "(no answer)", custom: true });
					continue;
				}
				const choice = await ctx.ui.select(title, [...question.options, "Type something…"]);
				if (choice === undefined) {
					answers.push({ question: title, answer: "(cancelled)", custom: false });
					break;
				}
				if (choice === "Type something…") {
					const typed = await ctx.ui.input(title, "Your answer");
					answers.push({ question: title, answer: typed?.trim() || "(no answer)", custom: true });
				} else {
					answers.push({ question: title, answer: choice, custom: false });
				}
			}

			const text = answers.map((answer) => `${answer.question} → ${answer.answer}`).join("\n");
			return {
				content: [{ type: "text", text: text || "(no answers)" }],
				details: { questions: params.questions, answers },
			};
		},
	});

	// X-ray: after a `read`, tell the model what the analysis already knows about that file.
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "read") return;
		const input = event.input as { path?: string; offset?: number; limit?: number };
		if (!input?.path) return;
		const note = await runHookScript("xray.py", {
			tool_input: { path: input.path, offset: input.offset, limit: input.limit },
			cwd: ctx.cwd,
		});
		if (!note) return;
		// The pane's session block counts the reads that carried the analysis.
		const activity = panel.panel()?.state.activity;

		if (activity !== undefined) {
			activity.xrays += 1;
			activity.xraysThisTurn += 1;
		}

		return { content: [...event.content, { type: "text", text: note }] };
	});

	// Status: where the modernization stands, and the one step to take next.
	let sessionNote = "";
	pi.on("session_start", async (_event, ctx) => {
		sessionNote = await runHookScript("status.py", {
			cwd: ctx.cwd,
			prompt: "",
			hook_event_name: "SessionStart",
		});
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (event.messageType !== "user") return;

		// The step this turn runs, for the pane's session block.
		const activity = panel.panel()?.state.activity;

		if (activity !== undefined) {
			activity.xraysThisTurn = 0;

			const step = /\/?(?:skill:)?(modernize-[a-z-]+)/.exec(event.prompt ?? "");

			activity.step = step !== null ? `/${step[1]}` : null;
		}

		const note = await runHookScript("status.py", {
			cwd: ctx.cwd,
			prompt: event.prompt ?? "",
			hook_event_name: "UserPromptSubmit",
		});
		const text = [note, sessionNote].find((part) => part && part.trim()) ?? "";
		sessionNote = "";
		if (!text.trim()) return;
		return {
			message: {
				customType: "code-modernization-status",
				content: [{ type: "text", text }],
				display: false,
			},
		};
	});
}
