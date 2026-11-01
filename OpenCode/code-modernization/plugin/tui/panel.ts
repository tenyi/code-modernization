import * as fs from "node:fs";
import * as path from "node:path";

import { paint, tilesOf, type TouchKind } from "./map/estate";
import { join, relTo } from "./paths";
import { nodeFs } from "./reader/node-fs";
import { oneLineOf, readSnapshot, REVIEWS_FILE } from "./reader/progress";
import { unitOfPath, type EstateUnit } from "./reader/estate-model";
import { parseLedger } from "./review/ledger";
import { decide, ledgerJson, nextUnreviewed, queueOf, undecide, type DeckScope } from "./review/deck";
import { signBrief } from "./sign";
import { newState, type Options, type State } from "./state";

/**
 * The panel's controller: what the workspace looks like right now, and what
 * happens when a person presses a key in it.
 *
 * The upstream plugin keeps this in its engine's host; the OpenCode TUI has
 * no workspace reader of its own, so the port keeps it here and the TUI part
 * binds it to the terminal UI.
 */

/** How often the panel re-reads the workspace while nothing else happens. */
const POLL_MS = 20_000;

/** How long a fleet row is kept after it ended. */
const KEEP_MS = 30 * 60_000;

/** The maximum size of a file the panel reads. */
const MAX_READ = 4_000_000;

/** What a touch lit: the tile, and the unit's name for the fleet's row. */
export type Touched = {
  /** The estate unit's id — the tile that was lit. */
  id: string;
  /** The unit's name, as the fleet's row shows it. */
  name: string;
  /** Read or write. */
  kind: TouchKind;
};

/**
 * The touch a tool makes: a read lights its tile cool, a write warm.
 *
 * The tool names are OpenCode's own; the upstream's `Read`/`Edit`/`Write` are
 * the same tools under other names.
 */
const touchKindOf = (tool: string): TouchKind | undefined => {
  if (tool === 'read') return 'read';
  if (tool === 'edit' || tool === 'write' || tool === 'patch' || tool === 'apply_patch') return 'write';

  return undefined;
};

/** The files a tool call names, as it named them. */
const filesOf = (args: Readonly<Record<string, unknown>>): string[] => {
  const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
  const file = str('filePath') ?? str('file_path') ?? str('path');

  if (file !== undefined) {
    return [file];
  }

  // A patch names its files in its own lines.
  const patch = str('patchText') ?? str('patch');

  if (patch === undefined) {
    return [];
  }

  const out: string[] = [];

  for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
    const name = match[1];

    if (name !== undefined) {
      out.push(name.trim());
    }
  }

  return out;
};

export type PanelOptions = {
	/** The workspace root. */
	cwd: string;
	/** The panel's settings. */
	options: Options;
};

export class Panel {
	readonly state: State;
	private readonly cwd: string;
	private readonly fs: ReturnType<typeof nodeFs>;
	private timer: NodeJS.Timeout | null = null;

	constructor(params: PanelOptions) {
		this.cwd = params.cwd;
		this.fs = nodeFs(params.cwd);
		this.state = newState({});
		this.state.cwd = params.cwd;
		this.state.options = params.options;
	}

	/** The one line the status bar and the panel's title show. */
	oneLine(): string {
		const snapshot = this.state.snapshot;

		if (snapshot === null) {
			return "";
		}

		const next = snapshot.next;

		return `${oneLineOf(snapshot)}${next !== null && !next.isByHand ? ` · next: ${next.text}` : ""}`;
	}

	/** Re-reads the workspace. Never throws: a panel that cannot read shows why. */
	async refresh(): Promise<void> {
		try {
			const snapshot = await readSnapshot(this.fs, this.state.cache, {
				system: this.state.options.system === "" ? undefined : this.state.options.system,
				commandPrefix: this.state.options.commandPrefix,
				nowMs: Date.now(),
				legacyDir: this.state.options.legacyDir,
				track: this.state.options.track,
			});

			this.state.snapshot = snapshot;
			this.state.readError = null;
			this.pruneFleet();
		} catch (error) {
			this.state.snapshot = null;
			this.state.readError = (error as Error).message;
		}
	}

	/** The estate map's tiles, for the pane's map block. */
	estateTiles(columns: number, rows: number): { cells: { glyph: string; fg: number; bg: number }[]; columns: number; rows: number; tiles: ReturnType<typeof tilesOf> } | null {
		const snapshot = this.state.snapshot;

		if (snapshot === null) {
			return null;
		}

		const tiles = tilesOf(snapshot, columns, rows);

		if (tiles.length === 0) {
			return null;
		}

		const painted = paint(tiles, columns, rows, this.state.touches, Date.now());

		return { cells: painted.cells, columns, rows, tiles };
	}

	/**
	 * Lights the tile of a file that was read or written.
	 *
	 * The upstream lights the estate tile under the file, so the map shows
	 * where the work is happening; the same is done here, from the tool's own
	 * path. Returns what was lit, so the caller can redraw while it fades.
	 */
	noteTouch(tool: string, args: Readonly<Record<string, unknown>> | undefined, nowMs: number): Touched[] {
		const snapshot = this.state.snapshot;

		if (snapshot === null || snapshot.estate === null || args === undefined) {
			return [];
		}

		const kind = touchKindOf(tool);

		if (kind === undefined) {
			return [];
		}

		const out: Touched[] = [];

		for (const file of filesOf(args)) {
			const unit = this.unitOfTouch(file);

			if (unit === null) {
				continue;
			}

			const held = this.state.touches.get(unit.id);

			// A write outranks a read that is still fading.
			if (held !== undefined && held.kind === 'write' && kind === 'read' && nowMs - held.atMs < 1200) {
				continue;
			}

			this.state.touches.set(unit.id, { atMs: nowMs, kind });
			out.push({ id: unit.id, name: unit.name, kind });
		}

		return out;
	}

	/**
	 * The estate unit a touched file belongs to, or null when the file is
	 * outside the legacy tree the map draws.
	 */
	private unitOfTouch(file: string): EstateUnit | null {
		const snapshot = this.state.snapshot;

		if (snapshot === null || snapshot.estate === null) {
			return null;
		}

		// The path is relative to the workspace; the estate's units are
		// relative to the system's own directory under it.
		const relative = relTo(this.cwd, path.isAbsolute(file) ? file : path.join(this.cwd, file));

		if (relative === null) {
			return null;
		}

		const prefix = `${this.state.options.legacyDir}/${snapshot.system}/`;
		const inside = relative.startsWith(prefix) ? relative.slice(prefix.length) : relative;

		return unitOfPath(snapshot.estate, snapshot.topology, inside);
	}

	// ------------------------------------------------------------- the deck

	/** Opens the rule review deck on the rules a person should look at. */
	openDeck(scope: DeckScope, filter: string): void {
		const snapshot = this.state.snapshot;

		if (snapshot === null || snapshot.rules === null) {
			return;
		}

		const queue = queueOf(snapshot.rules, scope, filter);
		const ledger = this.readLedger(snapshot.system);

		this.state.deck = {
			...this.state.deck,
			isOpen: true,
			scope,
			filter,
			queue,
			index: nextUnreviewed(queue, ledger, 0),
			ledger,
			edits: new Map(),
			source: null,
			isSourceShown: false,
		};
	}

	/** The verdicts this session has recorded, over what the file holds. */
	private readLedger(system: string) {
		const snapshot = this.state.snapshot;
		const onDisk = parseLedger(this.readText(join("analysis", system, REVIEWS_FILE)));

		const merged = { ...onDisk };

		for (const [id, edit] of this.state.deck.edits) {
			if (edit === null) {
				delete merged[id];
			} else {
				const note = edit.note ?? onDisk[id]?.note;

				merged[id] = { ...edit, ...(note !== undefined && { note }) };
			}
		}

		return merged;
	}

	/** Records a verdict on the rule in view. */
	decide(verdict: "confirmed" | "wrong" | "discuss"): void {
		const deck = this.state.deck;
		const rule = deck.queue[deck.index];

		if (rule === undefined) {
			return;
		}

		const ledger = decide(deck.ledger, rule, verdict, new Date().toISOString());

		deck.ledger = ledger;
		deck.edits.set(rule.id, ledger[rule.id] ?? null);
		deck.index = nextUnreviewed(deck.queue, ledger, deck.index);
	}

	/** Takes the verdict on the rule in view back. */
	undo(): void {
		const deck = this.state.deck;
		const rule = deck.queue[deck.index];

		if (rule === undefined || deck.ledger[rule.id] === undefined) {
			return;
		}

		const ledger = undecide(deck.ledger, rule.id);

		deck.ledger = ledger;
		deck.edits.set(rule.id, null);
	}

	/** Moves to the previous rule. */
	prev(): void {
		const deck = this.state.deck;

		if (deck.queue.length === 0) {
			return;
		}

		deck.index = (deck.index - 1 + deck.queue.length) % deck.queue.length;
	}

	/** Moves to the next rule. */
	next(): void {
		const deck = this.state.deck;

		if (deck.queue.length === 0) {
			return;
		}

		deck.index = (deck.index + 1) % deck.queue.length;
	}

	/** Shows or hides the cited source of the rule in view. */
	async toggleSource(): Promise<void> {
		const deck = this.state.deck;
		const rule = deck.queue[deck.index];

		if (rule === undefined) {
			return;
		}

		if (deck.isSourceShown) {
			deck.isSourceShown = false;
			deck.source = null;

			return;
		}

		const citation = rule.citations[0];

		if (citation === undefined) {
			return;
		}

		const snapshot = this.state.snapshot;

		if (snapshot === null) {
			return;
		}

		const legacyRoot = join(this.state.options.legacyDir, snapshot.system);
		const full = join(legacyRoot, citation.path);
		const text = this.readText(full);
		const lines = text.split("\n");
		const start = Math.max(1, citation.from - 2);
		const end = Math.min(lines.length, citation.to + 2);
		const body = lines.slice(start - 1, end).join("\n");

		deck.source = { ruleId: rule.id, path: citation.path, startLine: start, text: body };
		deck.isSourceShown = true;
	}

	/** Writes the ledger the deck holds back to the workspace. */
	saveDeck(): { written: boolean; message: string } {
		const snapshot = this.state.snapshot;

		if (snapshot === null) {
			return { written: false, message: "No system is being followed." };
		}

		const system = snapshot.system;
		const dir = path.join(this.cwd, "analysis", system);

		try {
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, REVIEWS_FILE), ledgerJson(system, this.state.deck.ledger), "utf-8");
		} catch (error) {
			return { written: false, message: `The ledger could not be written: ${(error as Error).message}` };
		}

		return { written: true, message: `Rule reviews written to analysis/${system}/${REVIEWS_FILE}.` };
	}

	// ------------------------------------------------------------- the sign

	/** Opens the sign-off dialog for the brief. */
	openSign(): void {
		this.state.sign = { isOpen: true, name: this.state.sign.name, covers: this.state.sign.covers, error: null };
	}

	/** Writes the person's name into the brief's approval block. */
	sign(name: string, covers: "phase-1" | "full"): { written: boolean; message: string } {
		const snapshot = this.state.snapshot;

		if (snapshot === null) {
			return { written: false, message: "No system is being followed." };
		}

		const file = path.join(this.cwd, "analysis", snapshot.system, "MODERNIZATION_BRIEF.md");
		const text = this.readText(file);

		if (text === "") {
			return { written: false, message: `There is no brief at analysis/${snapshot.system}/MODERNIZATION_BRIEF.md to sign.` };
		}

		const signed = signBrief(text, name, new Date().toISOString().slice(0, 10), covers);

		if (signed === null) {
			return { written: false, message: "The brief has no `Approved by:` line to fill in." };
		}

		try {
			fs.writeFileSync(file, signed, "utf-8");
		} catch (error) {
			return { written: false, message: `The brief could not be written: ${(error as Error).message}` };
		}

		this.state.sign.isOpen = false;

		return { written: true, message: `Brief signed by ${name} (${covers === "full" ? "full plan" : "Phase 1 only"}).` };
	}

	// -------------------------------------------------------------- helpers

	/** A file's text, or the empty string when it cannot be read. */
	private readText(target: string): string {
		try {
			const full = path.isAbsolute(target) ? target : path.join(this.cwd, target);

			return fs.readFileSync(full, "utf-8").slice(0, MAX_READ);
		} catch {
			return "";
		}
	}

	/** Starts the panel's polling. */
	start(onTick: () => void): void {
		this.stop();
		this.timer = setInterval(() => {
			void this.refresh().then(onTick);
		}, POLL_MS);
		this.timer.unref?.();
	}

	/** Stops the panel's polling. */
	stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/** Forgets the agents that ended long ago, keeping the registry bounded. */
	pruneFleet(): void {
		const now = Date.now();

		for (const [id, row] of this.state.fleet.agents) {
			if ((row.isDone || now - row.lastMs > KEEP_MS) && this.state.fleet.agents.size > 1500) {
				this.state.fleet.agents.delete(id);
				this.state.fleet.unitHits.delete(id);
			}
		}
	}
}

