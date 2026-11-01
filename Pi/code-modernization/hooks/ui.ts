import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component } from "@earendil-works/pi-tui";

import { subjectOf } from "./subagent";
import { Panel } from "./panel";
import { optionsOf, type Options } from "./state";
import { deckView, signView } from "./views/deck";
import { buttonsOf, headerRowsOf, legendRowsOf, nextRowsOf, paneView, planOf, type PaneFrame } from "./views/pane";
import type { Line } from "./views/kit";

/**
 * The panel, bound to pi's terminal UI.
 *
 * The upstream plugin docks its pane beside the transcript and opens the deck
 * and the sign-off dialog in a band above the prompt. pi has no docked pane
 * and no such band, so the port binds the same three surfaces to what pi
 * has: a persistent widget above the editor for the standing state, and a
 * full-screen custom view for each of the three interactive surfaces.
 */

/** The widget key the panel's standing line is drawn under. */
const WIDGET_KEY = "code-modernization";

/** The settings key the panel's options are read from. */
const SETTINGS_KEY = "codeModernization";

/** The pi theme, wrapped as the kit the views draw with. */
function kit(theme: Theme) {
	const rgb = (color: number) => ({ kind: "rgb" as const, r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff });

	return {
		fg: (token: "accent" | "success" | "error" | "warning" | "muted" | "text", text: string) => theme.fg(token, text),
		fgColor: (color: number, text: string) => theme.style(text, { fg: rgb(color) }),
		bg: (color: number, text: string) => theme.style(text, { bg: rgb(color) }),
		bold: (text: string) => theme.bold(text),
		dim: (text: string) => theme.fg("muted", text),
	};
}

/** The panel's options, from pi's own settings. */
function readOptions(pi: ExtensionAPI): Options {
	const settings = pi.getSettings() as Record<string, unknown>;
	const raw = settings[SETTINGS_KEY];

	return optionsOf(typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {});
}

export type PanelBinding = {
	/** The panel of the running session, once it has started. */
	panel: () => Panel | null;
	/** Re-reads the workspace and repaints the standing line. */
	refresh: () => Promise<void>;
	/** Stops the panel's polling. */
	stop: () => void;
};

/**
 * Binds the panel to pi: the standing widget, and the three commands.
 */
export function registerPanel(pi: ExtensionAPI): PanelBinding {
	// The panel reads the workspace, so it belongs to a session: it is made
	// when the session starts, and thrown away when it ends.
	let current: Panel | null = null;

	const paintWidget = (ctx: ExtensionContext) => {
		const text = current?.oneLine() ?? "";

		ctx.ui.setWidget(WIDGET_KEY, text === "" ? undefined : [text]);
	};

	const refresh = async () => {
		if (current === null) {
			return;
		}

		await current.refresh();
	};

	pi.registerCommand("modernize-panel", {
		description: "Show the modernization pane: where the work stands, what needs a person, and the next step.",
		handler: async (_args, command) => {
			const panel = current;

			if (panel === null) {
				command.ui.notify("The panel is not ready yet.", "info");

				return;
			}

			if (command.mode !== "tui") {
				command.ui.notify("The modernization pane needs the terminal UI.", "info");

				return;
			}

			await panel.refresh();

			const snapshot = panel.state.snapshot;

			if (snapshot === null) {
				command.ui.notify(panel.state.readError ?? "There is no modernization in this workspace yet.", "info");

				return;
			}

			await command.ui.custom<void>((tui, theme, _keybindings, done) => {
				const k = kit(theme);
				let cachedWidth: number | undefined;
				let cached: string[] | undefined;

				const invalidate = () => {
					cached = undefined;
					cachedWidth = undefined;
				};

				const component: Component = {
					render: (width: number): string[] => {
						if (cached !== undefined && cachedWidth === width) {
							return cached;
						}

						cachedWidth = width;
						// The pane takes the room the terminal leaves over the
						// editor, so a tall terminal shows more of the map.
						const rows = Math.max(20, tui.terminal.rows - 6);
						cached = drawPane(panel, k, width, rows).map((entry) => entry.text);

						return cached;
					},
					handleInput: (data: string) => {
						if (matchesKey(data, Key.escape) || data === "q") {
							done();

							return;
						}

						if (pressPaneKey(panel, command, data)) {
							invalidate();
							tui.requestRender();
						}
					},
					invalidate: () => {
						invalidate();
					},
				};

				return component;
			});
		},
	});

	pi.registerCommand("modernize-review-pane", {
		description: "Review the business rules that need a person, one card at a time.",
		handler: async (args, command) => {
			const panel = current;

			if (panel === null) {
				command.ui.notify("The panel is not ready yet.", "info");

				return;
			}

			if (command.mode !== "tui") {
				command.ui.notify("The modernization pane needs the terminal UI.", "info");

				return;
			}

			await panel.refresh();

			const words = args.trim().split(/\s+/).filter((word) => word !== "");
			const first = (words[0] ?? "").toLowerCase();
			const scope = first === "p0" || first === "all" || first === "flagged" ? first : "flagged";
			const filter = (scope === first ? words.slice(1) : words).join(" ");

			panel.openDeck(scope as "flagged" | "p0" | "all", filter);

			if (panel.state.deck.queue.length === 0) {
				command.ui.notify("There are no rules to review among those.", "info");

				return;
			}

			await command.ui.custom<void>((tui, theme, _keybindings, done) => {
				const k = kit(theme);
				let cachedWidth: number | undefined;
				let cached: string[] | undefined;

				const invalidate = () => {
					cached = undefined;
					cachedWidth = undefined;
				};

				const component: Component = {
					render: (width: number): string[] => {
						if (cached !== undefined && cachedWidth === width) {
							return cached;
						}

						cachedWidth = width;
						cached = deckView(k, panel.state.deck, width, 40, deckActions(panel, done)).map((entry) => entry.text);

						return cached;
					},
					handleInput: async (data: string) => {
						if (matchesKey(data, Key.escape) || data === "0") {
							const saved = panel.saveDeck();

							command.ui.notify(saved.message, saved.written ? "info" : "error");
							done();

							return;
						}

						await pressDeckKey(panel, data);
						invalidate();
						tui.requestRender();
					},
					invalidate: () => {
						invalidate();
					},
				};

				return component;
			});
		},
	});

	pi.registerCommand("modernize-sign", {
		description: "Sign the modernization brief: who approves the plan, and how much of it.",
		handler: async (args, command) => {
			const panel = current;

			if (panel === null) {
				command.ui.notify("The panel is not ready yet.", "info");

				return;
			}

			if (command.mode !== "tui") {
				command.ui.notify("The modernization pane needs the terminal UI.", "info");

				return;
			}

			await panel.refresh();

			const snapshot = panel.state.snapshot;

			if (snapshot === null) {
				command.ui.notify("There is no modernization in this workspace yet.", "info");

				return;
			}

			panel.openSign();

			// A name given on the command line signs at once; otherwise the
			// dialog asks for it.
			const given = args.trim();

			if (given !== "") {
				const result = panel.sign(given, panel.state.sign.covers);

				command.ui.notify(result.message, result.written ? "info" : "error");

				return;
			}

			await command.ui.custom<void>((tui, theme, _keybindings, done) => {
				const k = kit(theme);
				let cachedWidth: number | undefined;
				let cached: string[] | undefined;

				const invalidate = () => {
					cached = undefined;
					cachedWidth = undefined;
				};

				const component: Component = {
					render: (width: number): string[] => {
						if (cached !== undefined && cachedWidth === width) {
							return cached;
						}

						cachedWidth = width;
						cached = signView(k, panel.state.sign, snapshot.system, snapshot.brief?.openQuestions ?? 0, width, {
							name: (value) => {
								panel.state.sign.name = value;
							},
							covers: (value) => {
								panel.state.sign.covers = value;
							},
							sign: () => {
								const result = panel.sign(panel.state.sign.name, panel.state.sign.covers);

								command.ui.notify(result.message, result.written ? "info" : "error");
								done();
							},
							cancel: () => done(),
						}).map((entry) => entry.text);

						return cached;
					},
					handleInput: (data: string) => {
						if (matchesKey(data, Key.escape)) {
							done();

							return;
						}

						if (matchesKey(data, Key.tab)) {
							panel.state.sign.covers = panel.state.sign.covers === "phase-1" ? "full" : "phase-1";
							invalidate();
							tui.requestRender();

							return;
						}

						if (matchesKey(data, Key.enter)) {
							const result = panel.sign(panel.state.sign.name, panel.state.sign.covers);

							command.ui.notify(result.message, result.written ? "info" : "error");
							done();

							return;
						}

						if (matchesKey(data, Key.backspace)) {
							panel.state.sign.name = panel.state.sign.name.slice(0, -1);
							invalidate();
							tui.requestRender();

							return;
						}

						// Anything else is a letter of the name.
						if (data.length === 1 && /[\w @.\-]/.test(data)) {
							panel.state.sign.name += data;
							invalidate();
							tui.requestRender();
						}
					},
					invalidate: () => {
						invalidate();
					},
				};

				return component;
			});
		},
	});

	// The standing line follows the work: it is refreshed when a turn settles
	// and on a slow poll, so it is right without being noisy.
	pi.on("agent_settled", async (_event, ctx) => {
		await refresh();
		paintWidget(ctx);
	});

	// What the session is doing: the pane's session block shows it.
	pi.on("agent_start", () => {
		const panel = current;

		if (panel === null) {
			return;
		}

		panel.state.activity.isWorking = true;
		panel.state.activity.turnStartMs = Date.now();
		panel.state.activity.running.clear();
	});

	pi.on("agent_end", () => {
		const panel = current;

		if (panel === null) {
			return;
		}

		panel.state.activity.isWorking = false;
		panel.state.activity.running.clear();
	});

	pi.on("tool_execution_start", (event) => {
		const panel = current;

		if (panel === null) {
			return;
		}

		const subject = subjectOf(event.toolName, (event.args ?? {}) as Record<string, unknown>);

		panel.state.activity.running.set(event.toolCallId, {
			id: event.toolCallId,
			tool: event.toolName,
			subject,
			startMs: Date.now(),
		});

		// A read or a write under the legacy tree lights its tile on the map.
		panel.noteTouch(event.toolName, event.args as Record<string, unknown> | undefined);
	});

	pi.on("tool_execution_end", (event) => {
		const panel = current;

		if (panel === null) {
			return;
		}

		// The end event carries no arguments: the subject comes from the start.
		const running = panel.state.activity.running.get(event.toolCallId);
		const subject = running?.subject ?? event.toolName;

		panel.state.activity.running.delete(event.toolCallId);
		panel.state.activity.finished.push({
			tool: event.toolName,
			subject,
			isOk: event.isError !== true,
			ms: event.durationMs ?? 0,
		});

		// Only the last few are of interest; the pane has room for a handful.
		if (panel.state.activity.finished.length > 40) {
			panel.state.activity.finished = panel.state.activity.finished.slice(-40);
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		current?.stop();
		current = new Panel({ cwd: ctx.cwd, options: readOptions(pi) });

		await current.refresh();
		paintWidget(ctx);

		current.start(() => {
			paintWidget(ctx);
		});
	});

	pi.on("session_shutdown", () => {
		current?.stop();
		current = null;
	});

	return {
		panel: () => current,
		refresh,
		stop: () => current?.stop(),
	};
}

/** The pane's lines, at a width and a height. */
function drawPane(panel: Panel, k: ReturnType<typeof kit>, width: number, rows: number): Line[] {
	const snapshot = panel.state.snapshot;

	if (snapshot === null) {
		return paneView(
			k,
			panel.state,
			{ columns: width, rows, nowMs: Date.now(), estate: null, plan: planOf(rows, "dock", { phases: 0, modules: 0, attention: 0, hasMap: false, headerRows: 3 }) },
			noActions(),
		);
	}

	const hasMap = snapshot.estate !== null;
	const counts = {
		phases: snapshot.brief?.phases.length ?? 0,
		modules: snapshot.modules.length,
		attention: snapshot.attention.length,
		hasMap,
		headerRows: headerRowsOf(snapshot, width),
		nextRows: nextRowsOf(snapshot, width),
		legendRows: legendRowsOf(snapshot, width),
	};
	const plan = planOf(rows, "dock", counts);
	// The map is drawn at the height the plan gave it, so the pane's blocks
	// share the space the way the upstream's do.
	const estate = plan.estate > 0 ? panel.estateTiles(width, plan.estate) : null;
	const frame: PaneFrame = {
		columns: width,
		rows,
		nowMs: Date.now(),
		estate: estate === null ? null : { cells: estate.cells, columns: estate.columns, rows: estate.rows, tiles: estate.tiles },
		plan,
	};

	return paneView(k, panel.state, frame, noActions());
}

/** The pane's buttons: the actions its keys stand for. */
function noActions() {
	return {
		system: () => undefined,
		next: () => undefined,
		review: () => undefined,
		sign: () => undefined,
		close: () => undefined,
		stop: () => undefined,
	};
}

/** A key in the pane: the numbers press the buttons the pane drew. */
function pressPaneKey(panel: Panel, command: { ui: ExtensionContext["ui"]; abort: () => void }, data: string): boolean {
	const snapshot = panel.state.snapshot;

	if (snapshot === null) {
		return false;
	}

	const next = snapshot.next;
	const labels = buttonsOf(snapshot, panel.state);
	const pressed = labels[Number(data) - 1];

	if (pressed === undefined) {
		return false;
	}

	// The buttons the pane drew, pressed by the number it drew them with.
	if (pressed === "put in prompt" && next !== null && !next.isByHand) {
		command.ui.setEditorText(next.text);

		return true;
	}

	if (pressed === "sign the brief") {
		command.ui.notify("Run /modernize-sign to sign the brief.", "info");

		return true;
	}

	if (pressed === "review rules") {
		command.ui.notify("Run /modernize-review-pane to review the rules.", "info");

		return true;
	}

	if (pressed === "stop the run" && panel.state.activity.isWorking) {
		command.abort();

		return true;
	}

	return false;
}

/** The deck's keys. */
async function pressDeckKey(panel: Panel, data: string): Promise<void> {
	if (data === "1") {
		panel.decide("confirmed");
	} else if (data === "2") {
		panel.decide("wrong");
	} else if (data === "3") {
		panel.decide("discuss");
	} else if (data === "4") {
		panel.prev();
	} else if (data === "5") {
		panel.next();
	} else if (data === "6") {
		await panel.toggleSource();
	} else if (data === "7") {
		panel.undo();
	}
}

/** The deck's actions, for the view's own signature. */
function deckActions(panel: Panel, done: (value?: void) => void) {
	return {
		decide: (verdict: "confirmed" | "wrong" | "discuss") => panel.decide(verdict),
		undo: () => panel.undo(),
		prev: () => panel.prev(),
		next: () => panel.next(),
		source: () => void panel.toggleSource(),
		close: () => done(),
	};
}

export { WIDGET_KEY, SETTINGS_KEY };
