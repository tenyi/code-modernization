// The TUI's side of the panel: the workspace the controller reads, the fleet
// the panel shows, and the two things OpenCode knows that the upstream host
// did not — which child sessions belong to the session, and whether the
// session is executing.
//
// Everything that draws lives in `views/`, the workspace readers in
// `reader/`, and the controller in `panel.ts`; this module only binds them to
// the TUI plugin context, so the pure parts can be tested without a terminal.

import * as fs from "node:fs";
import * as path from "node:path";

import { noteAgent, noteCall, noteDone, noteFailure, subjectOf, type Signature } from "./fleet/fleet";
import { Panel, type Touched } from "./panel";
import { optionsOf, type Options } from "./state";
import { headerRowsOf, legendRowsOf, nextRowsOf, paneView, planOf, type PaneActions, type PaneFrame } from "./views/pane";
import { deckView, type DeckActions } from "./views/deck";
import type { Line, Theme } from "./views/kit";

/** The panel names the TUI part registers in `session.panel`. */
export const PANEL_NAME = "code-modernization.panel";
export const DECK_NAME = "code-modernization.review";
export const SIGN_NAME = "code-modernization.sign";

/** The file the panel's options are read from, under the workspace. */
export const OPTIONS_FILE = path.join(".code-modernization", "panel.json");

/** The rows the panel asks the plan for: enough for a docked pane, scrollable when shorter. */
const PANEL_ROWS = 46;

/** The rows a review card may take. */
const DECK_ROWS = 34;

/** The slice of the TUI context this module needs. */
export type HostContext = {
	readonly data: {
		readonly session: {
			root(sessionID: string): string;
			family(sessionID: string): string[];
			status(sessionID: string): "idle" | "running";
		};
		readonly listen: (handler: (event: { details: { type: string; data?: Record<string, unknown> } }) => void) => () => void;
	};
};

/** The options of the workspace's panel file, with the plugin entry's on top. */
export function readOptions(cwd: string, override: Record<string, unknown> = {}): Options {
	let fromFile: Record<string, unknown> = {};

	try {
		const text = fs.readFileSync(path.join(cwd, OPTIONS_FILE), "utf-8");
		const parsed: unknown = JSON.parse(text);

		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			fromFile = parsed as Record<string, unknown>;
		}
	} catch {
		// No file, or a file that cannot be read: the defaults are the panel.
	}

	return optionsOf({ ...fromFile, ...override });
}

/** The panel's buttons: the keys are handled by the TUI part, not the view. */
const NO_ACTIONS: PaneActions = {
	system: () => undefined,
	next: () => undefined,
	review: () => undefined,
	sign: () => undefined,
	close: () => undefined,
	stop: () => undefined,
};

/** How many finished calls the panel keeps. */
const KEPT_CALLS = 40;

/** A tool call in flight: what it is, and where it ran. */
type ToolCall = {
	/** The session the call ran in. */
	sessionID: string;
	/** The tool's name, as OpenCode calls it. */
	tool: string;
	/** What the call was aimed at: a file's name, a command's head. */
	subject: string;
	/** When the call started. */
	startMs: number;
	/** True when the call ran in the session the panel is for. */
	isOwn: boolean;
};

/** How a tool call ended. */
export type ToolOutcome = {
	/** The tool that ran. */
	tool: string;
	/** The session it ran in. */
	sessionID: string;
	/** True when it ran in the session the panel is for. */
	isOwn: boolean;
	/** The failure to call out, when enough agents share this cause. */
	signature: Signature | null;
};

/**
 * The panel, bound to one workspace and to the session that opened it.
 */
export class PanelHost {
	readonly controller: Panel;
	private readonly cwd: string;
	/** The session the panel was last drawn for; execution events from its children do not count as its own. */
	private sessionID: string | null = null;
	/** The sessions that belong to this one: itself and its children. */
	private family: Set<string> = new Set();
	/** The tool calls in flight, by the id the events carry. */
	private readonly calls: Map<string, ToolCall> = new Map();
	/** The tool each call is for: the events name it only as the input streams in. */
	private readonly names: Map<string, string> = new Map();

	constructor(cwd: string, options: Options) {
		this.cwd = cwd;
		this.controller = new Panel({ cwd, options });
	}

	/** Re-reads the workspace. Never throws: the panel shows why it could not read. */
	async refresh(): Promise<void> {
		await this.controller.refresh();
	}

	/** Follows a session's child sessions into the panel's fleet. */
	syncFleet(context: HostContext, sessionID: string): void {
		const now = Date.now();
		let family: string[] = [];
		let root = sessionID;

		this.sessionID = sessionID;
		this.family = new Set([sessionID]);

		try {
			family = context.data.session.family(sessionID);
			root = context.data.session.root(sessionID);
		} catch {
			return;
		}

		for (const id of family) {
			this.family.add(id);

			if (id === root || id === sessionID) continue;

			const status = context.data.session.status(id);

			if (status === "running") {
				noteAgent(this.controller.state.fleet, id, now);
			}

			if (status === "idle") {
				noteDone(this.controller.state.fleet, id, now);
			}
		}
	}

	/** True when the session is the panel's own. */
	isOwn(sessionID: string): boolean {
		return this.sessionID !== null && sessionID === this.sessionID;
	}

	/** True when the session is the panel's own, or one of its children. */
	isOurs(sessionID: string): boolean {
		return this.family.has(sessionID);
	}

	/** Follows the session's executions into the activity block. */
	noteExecution(type: string, data: Record<string, unknown> | undefined): void {
		const activity = this.controller.state.activity;
		const sessionID = typeof data?.sessionID === "string" ? data.sessionID : null;

		// A child session running is the fleet's business, not this session's own turn.
		if (sessionID !== null && this.sessionID !== null && sessionID !== this.sessionID) {
			return;
		}

		if (type === "session.execution.started") {
			activity.isWorking = true;
			activity.turnId = sessionID;
			activity.turnStartMs = Date.now();

			return;
		}

		if (
			type === "session.execution.succeeded" ||
			type === "session.execution.failed" ||
			type === "session.execution.interrupted" ||
			type === "session.idle"
		) {
			activity.isWorking = false;
		}
	}

	/** Remembers the tool a call is for; the events name it only as the input streams in. */
	noteToolName(id: string, name: string): void {
		this.names.set(id, name);
	}

	/**
	 * Records a tool call as it starts.
	 *
	 * The session's own calls go to the activity block; a child agent's calls
	 * go to the fleet, which counts them and names the unit they work on.
	 * Every call lights the tile of the file it touches.
	 *
	 * Returns what was lit, so the caller can redraw the map while it fades.
	 */
	noteToolStarted(id: string, sessionID: string, args: Readonly<Record<string, unknown>>): Touched[] {
		const now = Date.now();
		const tool = this.names.get(id) ?? "tool";
		const subject = subjectOf(tool, args);
		const touched = this.controller.noteTouch(tool, args, now);
		const isOwn = this.isOwn(sessionID);

		this.names.delete(id);
		this.calls.set(id, { sessionID, tool, subject, startMs: now, isOwn });

		if (isOwn) {
			this.controller.state.activity.running.set(id, { id, tool, subject, startMs: now });

			return touched;
		}

		// A child session's call is the fleet's business.
		noteCall(this.controller.state.fleet, sessionID, tool, subject, now, touched[0]?.name);

		return touched;
	}

	/**
	 * Records how a tool call ended: the finished call in the session's own
	 * activity block, and — when a child agent's call failed and enough agents
	 * share the cause — the failure to call out.
	 */
	noteToolEnded(id: string, isOk: boolean, errorText?: string, note?: string): ToolOutcome | null {
		const call = this.calls.get(id);

		if (call === undefined) {
			return null;
		}

		this.calls.delete(id);

		if (call.isOwn) {
			this.controller.state.activity.running.delete(id);

			const finished = this.controller.state.activity.finished;

			finished.push({
				tool: call.tool,
				subject: call.subject,
				isOk,
				ms: Date.now() - call.startMs,
				...(note !== undefined && { note }),
			});

			// Only the last few are of interest; the pane has room for a handful.
			if (finished.length > KEPT_CALLS) {
				this.controller.state.activity.finished = finished.slice(-KEPT_CALLS);
			}

			return { tool: call.tool, sessionID: call.sessionID, isOwn: true, signature: null };
		}

		if (isOk || errorText === undefined || errorText === "") {
			return { tool: call.tool, sessionID: call.sessionID, isOwn: false, signature: null };
		}

		// What the call was aimed at is half of the cause: the path as the agent gave it, else the command's head.
		const signature = noteFailure(this.controller.state.fleet, call.sessionID, errorText, Date.now(), call.subject);

		return { tool: call.tool, sessionID: call.sessionID, isOwn: false, signature };
	}

	/** Counts a read that carried what the analysis already knows. */
	noteXray(isOwn: boolean): void {
		const activity = this.controller.state.activity;

		activity.xrays += 1;

		if (isOwn) {
			activity.xraysThisTurn += 1;
		}
	}

	/** Records the skill the turn began with, so the pane can name it. */
	noteSkill(sessionID: string, name: string): void {
		if (!this.isOwn(sessionID)) {
			return;
		}

		this.controller.state.activity.step = `/${name}`;
	}

	/** The pane's lines, at the width the host gave it. */
	drawPane(theme: Theme, width: number): Line[] {
		const snapshot = this.controller.state.snapshot;
		const columns = Math.max(20, width - 2);

		if (snapshot === null) {
			return paneView(
				theme,
				this.controller.state,
				{
					columns,
					rows: PANEL_ROWS,
					nowMs: Date.now(),
					estate: null,
					plan: planOf(PANEL_ROWS, "dock", {
						phases: 0,
						modules: 0,
						attention: 0,
						hasMap: false,
						headerRows: 3,
					}),
				},
				NO_ACTIONS,
			);
		}

		const counts = {
			phases: snapshot.brief?.phases.length ?? 0,
			modules: snapshot.modules.length,
			attention: snapshot.attention.length,
			hasMap: snapshot.estate !== null,
			headerRows: headerRowsOf(snapshot, columns),
			nextRows: nextRowsOf(snapshot, columns),
			legendRows: legendRowsOf(snapshot, columns),
		};
		const plan = planOf(PANEL_ROWS, "dock", counts);
		const estate = plan.estate > 0 ? this.controller.estateTiles(columns, plan.estate) : null;
		const frame: PaneFrame = {
			columns,
			rows: PANEL_ROWS,
			nowMs: Date.now(),
			estate: estate === null ? null : { cells: estate.cells, columns: estate.columns, rows: estate.rows, tiles: estate.tiles },
			plan,
		};

		return paneView(theme, this.controller.state, frame, NO_ACTIONS);
	}

	/** The review deck's lines, at the width and height the host gave it. */
	drawDeck(theme: Theme, width: number, rows: number): Line[] {
		const actions: DeckActions = {
			decide: (verdict) => this.controller.decide(verdict),
			undo: () => this.controller.undo(),
			prev: () => this.controller.prev(),
			next: () => this.controller.next(),
			source: () => void this.controller.toggleSource(),
			close: () => undefined,
		};

		return deckView(theme, this.controller.state.deck, Math.max(20, width - 2), Math.min(DECK_ROWS, rows), actions);
	}

	/** The path a session's work is rooted at. */
	get workspace(): string {
		return this.cwd;
	}
}
