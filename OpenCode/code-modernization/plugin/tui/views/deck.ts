import type { ReviewVerdict } from "../reader/progress";
import { tallyOf } from "../review/deck";
import type { DeckState, SignState } from "../state";
import { BAD, clip, GOOD, HEAD, line, MUTED, WARN, wrap, type Line, type Theme, type ThemeToken } from "./kit";

/**
 * The rule review deck and the sign-off dialog.
 *
 * The upstream draws both in the band above the prompt, with buttons. The
 * OpenCode TUI has a session panel slot instead, so the port draws the review
 * deck there and gives it its own key handling.
 */

export type DeckActions = {
	decide: (verdict: ReviewVerdict) => void;
	undo: () => void;
	prev: () => void;
	next: () => void;
	source: () => void;
	close: () => void;
};

const SCOPE_WORDS = { flagged: "high-priority rules a person should check", p0: "all high-priority rules", all: "all rules" };
const SCOPE_SHORT = { flagged: "flagged", p0: "high-priority", all: "all" };

const VERDICT_COLORS: Record<ReviewVerdict, "success" | "error" | "warning"> = {
	confirmed: "success",
	wrong: "error",
	discuss: "warning",
};

/** The deck's key hints, split at hint boundaries when the panel is too narrow for one row. */
function keyLinesOf(theme: Theme, labels: readonly string[], width: number): Line[] {
	const rows: string[] = [];
	let current = "";

	for (const label of labels) {
		const next = current === "" ? label : `${current}  ${label}`;

		if (current !== "" && next.length > width) {
			rows.push(current);
			current = label;
		} else {
			current = next;
		}
	}

	if (current !== "") rows.push(current);

	return rows.map((row) => line(theme.fg(HEAD, row)));
}

/** `text` word-wrapped to `width` cells, at most `maxLines` rows, the last ending in an ellipsis when cut. */
export function wrapLines(text: string, width: number, maxLines: number): string[] {
	const out: string[] = [];
	const limit = Math.max(8, width);
	let current = "";

	const push = (value: string) => {
		out.push(value);
	};

	for (const word of text.split(/\s+/).filter((part) => part !== "")) {
		let rest = word;

		while (rest.length > limit) {
			if (current !== "") {
				push(current);
				current = "";
			}

			push(rest.slice(0, limit));
			rest = rest.slice(limit);
		}

		if (current === "") {
			current = rest;
		} else if (current.length + 1 + rest.length <= limit) {
			current = `${current} ${rest}`;
		} else {
			push(current);
			current = rest;
		}
	}

	if (current !== "") {
		push(current);
	}

	if (out.length <= maxLines) {
		return out;
	}

	const kept = out.slice(0, Math.max(1, maxLines));
	const last = kept[kept.length - 1] ?? "";

	kept[kept.length - 1] = `${last.slice(0, Math.max(0, limit - 1))}…`;

	return kept;
}

/**
 * The review deck's body: one rule card, its verdict, and the keys.
 */
export function deckView(theme: Theme, deck: DeckState, columns: number, maxRows: number, actions: DeckActions): Line[] {
	const width = Math.max(30, columns - 2);
	const rule = deck.queue[deck.index];
	const tally = tallyOf(deck.queue, deck.ledger);

	if (rule === undefined) {
		return [
			line(theme.bold("Rule review")),
			...wrappedOf(
				theme,
				`Nothing to review among ${SCOPE_WORDS[deck.scope]}${deck.filter !== "" ? ` matching "${deck.filter}"` : ""}. Try /modernize-review-pane all.`,
				width,
				MUTED,
			),
			line(theme.fg(HEAD, "[0] close")),
		];
	}

	const verdict = deck.ledger[rule.id];
	const first = rule.citations[0];
	const shownSource = deck.isSourceShown && deck.source !== null && deck.source.ruleId === rule.id ? deck.source : null;

	const meta = [
		rule.domain,
		rule.category !== undefined && rule.category.toLowerCase() === rule.domain?.toLowerCase() ? undefined : rule.category,
		rule.confidence !== undefined ? `confidence ${rule.confidence}` : undefined,
		first !== undefined ? `${first.path.split("/").pop()}:${first.from}${first.to !== first.from ? `-${first.to}` : ""}` : undefined,
	].filter((part): part is string => part !== undefined && part !== "");

	const keys = keyLinesOf(
		theme,
		[
			"[1] confirm",
			"[2] wrong",
			"[3] discuss",
			"[4] back",
			"[5] skip",
			`[6] ${deck.isSourceShown ? "hide source" : "source"}`,
			...(verdict !== undefined ? ["[7] undo"] : []),
			"[0] close",
		],
		width,
	);

	const verdictLine =
		verdict !== undefined
			? line(theme.fg(VERDICT_COLORS[verdict.verdict], theme.bold(`Your verdict: ${verdict.verdict} (${verdict.at.slice(0, 10)})`)))
			: line(theme.fg(MUTED, "Is this rule right? No verdict yet."));

	// The reviewer's own words, when they gave any (the review command records them): one line, cut short.
	const noteLine = verdict?.note !== undefined ? line(theme.fg(MUTED, "Note: ") + clip(verdict.note, width - 6)) : null;

	const noteRows = noteLine === null ? 0 : 1;

	const headline = flowLinesOf(
		theme,
		[
			{ text: "Rule review", bold: true },
			{ text: `${deck.index + 1} of ${tally.total}`, bold: true },
			{ text: `${tally.confirmed} confirmed`, token: GOOD },
			{ text: `${tally.wrong} wrong`, token: BAD },
			{ text: `${tally.discuss} to discuss`, token: WARN },
			{ text: `${tally.open} open`, token: MUTED },
			{ text: width < 96 ? SCOPE_SHORT[deck.scope] : SCOPE_WORDS[deck.scope], token: MUTED },
			...(deck.filter !== "" ? [{ text: `"${deck.filter}"`, token: MUTED }] : []),
		],
		width,
	);

	// With the source open the code gets the room: the rule in one line, no blank rows, and as many
	// cited lines as the band holds. Six rows are spoken for: title, meta, statement, path, verdict,
	// keys; the headline may take more than one.
	if (shownSource !== null) {
		const codeRows = Math.max(3, Math.min(24, maxRows - (6 + headline.length + keys.length) - noteRows));
		const gist = rule.statement !== "" ? rule.statement : (rule.then ?? rule.given ?? "");
		const out: Line[] = [
			...headline,
			line(theme.bold(clip(`${rule.id.startsWith("R-") ? rule.priority : rule.id} · ${rule.title}`, width))),
			line(theme.fg(MUTED, clip(meta.join(" · "), width))),
			line(clip(wrapLines(gist, width, 1)[0] ?? "", width)),
			line(theme.fg(MUTED, `${shownSource.path}:${shownSource.startLine}`)),
		];

		for (const row of shownSource.text.split("\n").slice(0, codeRows)) {
			out.push(line(theme.fg(MUTED, clip(row, width))));
		}

		out.push(verdictLine);

		if (noteLine !== null) out.push(noteLine);

		out.push(...keys);

		return out;
	}

	// Rows that are always there: header, blank, title, meta, blank, [body], blank, verdict, keys.
	const fixed = 7 + keys.length + (headline.length - 1);
	// One row of slack: a band exactly full still scrolls on some layouts.
	const isTight = maxRows < 16;
	const room = Math.max(1, maxRows - (isTight ? fixed - 3 : fixed) - 1 - noteRows);
	const prose = Math.max(1, room);

	// Share the prose rows: flags one row each, the statement up to two, the rest split over Given/When/Then.
	const flagRows = (rule.defect !== undefined ? 1 : 0) + (rule.sme !== undefined ? 1 : 0);
	const statementRows = rule.statement !== "" ? Math.min(2, Math.max(0, prose - flagRows - 3)) : 0;
	const parts = [rule.given, rule.when, rule.then].filter((part) => part !== undefined).length;
	const each = parts > 0 ? Math.max(1, Math.floor((prose - flagRows - statementRows) / parts)) : 0;

	type Row = { text: string; color?: "warning" | "accent"; label?: string };
	const rows: Row[] = [];

	for (const row of wrapLines(rule.statement, width, statementRows)) {
		rows.push({ text: row });
	}

	const block = (label: string, text: string | undefined) => {
		if (text === undefined) return;

		wrapLines(`${label} ${text}`, width, each).forEach((row, index) => {
			rows.push(index === 0 ? { label, text: row.slice(label.length + 1) } : { text: row });
		});
	};

	block("Given", rule.given);
	block("When", rule.when);
	block("Then", rule.then);

	if (rule.defect !== undefined) {
		rows.push({ text: wrapLines(`! Suspected defect: ${rule.defect}`, width, 1)[0] ?? "", color: "warning" });
	}

	if (rule.sme !== undefined) {
		rows.push({ text: wrapLines(`? For an SME: ${rule.sme}`, width, 1)[0] ?? "", color: "accent" });
	}

	const out: Line[] = [
		...headline,
		line(theme.bold(clip(`${rule.id.startsWith("R-") ? rule.priority : rule.id} · ${rule.title}`, width))),
		line(theme.fg(MUTED, clip(meta.join(" · "), width))),
	];

	for (const row of rows.slice(0, prose)) {
		out.push(
			line(
				(row.label !== undefined ? theme.fg(HEAD, theme.bold(`${row.label} `)) : "") +
					(row.color !== undefined ? theme.fg(row.color, row.text) : row.text),
			),
		);
	}

	out.push(verdictLine);

	if (noteLine !== null) out.push(noteLine);

	out.push(...keys);

	return out;
}

export type SignActions = {
	name: (value: string) => void;
	covers: (value: "phase-1" | "full") => void;
	sign: () => void;
	cancel: () => void;
};

/** One piece of a flowed line: its text, and how it is drawn. */
type Segment = { readonly text: string; readonly token?: ThemeToken; readonly bold?: boolean };

/** Segments flowed onto as many rows as the width needs, split between segments rather than inside one. */
function flowLinesOf(theme: Theme, segments: readonly Segment[], width: number): Line[] {
	const rows: Segment[][] = [];
	let row: Segment[] = [];
	let used = 0;

	for (const segment of segments) {
		if (segment.text === "") continue;

		const separator: Segment = { text: " · ", token: MUTED };
		const needed = segment.text.length + (row.length === 0 ? 0 : separator.text.length);

		if (row.length > 0 && used + needed > width) {
			rows.push(row);
			row = [segment];
			used = segment.text.length;
		} else {
			if (row.length > 0) row.push(separator);
			row.push(segment);
			used += needed;
		}
	}

	if (row.length > 0) rows.push(row);

	return rows.map((parts) =>
		line(
			parts
				.map((part) =>
					part.token !== undefined ? theme.fg(part.token, part.text) : part.bold === true ? theme.bold(part.text) : part.text,
				)
				.join(""),
		),
	);
}

/** One styled paragraph, wrapped to the panel's width. */
function wrappedOf(theme: Theme, text: string, width: number, color: ThemeToken): Line[] {
	return wrap(text, width, (row) => theme.fg(color, row));
}

/** The sign-off dialog: a person's name, what the approval covers, and the button that writes it. */
export function signView(theme: Theme, sign: SignState, system: string, openQuestions: number, columns: number, actions: SignActions): Line[] {
	const width = Math.max(30, columns);

	const out: Line[] = [
		line(theme.bold("Sign the brief")),
		...wrappedOf(
			theme,
			`Records who approved the plan in analysis/${system}/MODERNIZATION_BRIEF.md, and how much of it. Nothing is built until it is signed.`,
			width,
			MUTED,
		),
	];

	if (openQuestions > 0) {
		out.push(
			...wrappedOf(
				theme,
				`${openQuestions} open question${openQuestions === 1 ? "" : "s"} in the brief ${openQuestions === 1 ? "is" : "are"} still unticked.`,
				width,
				WARN,
			),
		);
	}

	out.push(line(theme.fg("text", `Approved by: ${sign.name}`)));

	const covers = [
		`${sign.covers === "phase-1" ? "◉" : "○"} Phase 1 only`,
		`${sign.covers === "full" ? "◉" : "○"} Full plan`,
	];

	if (width < 46) {
		out.push(line(theme.fg(MUTED, "Covers:")));

		for (const choice of covers) {
			out.push(line(theme.fg(HEAD, `  ${choice}`)));
		}
	} else {
		out.push(line(theme.fg(MUTED, "Covers: ") + theme.fg(HEAD, covers.join("   "))));
	}

	if (sign.error !== null) {
		out.push(...wrappedOf(theme, sign.error, width, BAD));
	}

	out.push(...keyLinesOf(theme, ["[enter] sign", "[ctrl+t] toggle covers", "[esc] cancel"], width));

	return out;
}
