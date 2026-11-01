import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/**
 * The panel's drawing kit: the few operations the pane needs, over pi's own
 * terminal UI.
 *
 * The upstream plugin draws its pane with its engine's element tree; pi has no
 * such tree, so the port draws lines of styled text instead. The *content* is
 * the upstream's — same blocks, same rows, same words — only the drawing
 * differs.
 */

export type Theme = {
	/** A semantic colour by pi's theme token name (`accent`, `success`, `error`, `warning`, `muted`, `text`). */
	fg: (token: ThemeToken, text: string) => string;
	/** A concrete colour, as `0x00RRGGBB`: the estate map's own palette. */
	fgColor: (color: number, text: string) => string;
	/** A background colour, as `0x00RRGGBB`: the estate map's cells. */
	bg: (color: number, text: string) => string;
	bold: (text: string) => string;
	dim: (text: string) => string;
};

export type ThemeToken = "accent" | "success" | "error" | "warning" | "muted" | "text";

/** The upstream's own palette, mapped onto pi's theme tokens. */
export const HEAD: ThemeToken = "accent";
export const GOOD: ThemeToken = "success";
export const BAD: ThemeToken = "error";
export const WARN: ThemeToken = "warning";
export const ACCENT: ThemeToken = "accent";
/** The upstream's dim text is pi's muted token. */
export const MUTED: ThemeToken = "muted";

export type Line = { text: string };

/** A line of the pane: already styled, but cut to the width it is drawn at. */
export const line = (text: string): Line => ({ text });

/** A block of text wrapped to `width`, each row styled the same way. */
export function wrap(text: string, width: number, style: (value: string) => string): Line[] {
	if (text === "") return [];

	return wrapTextWithAnsi(text, Math.max(1, width)).map((row) => line(style(row)));
}

/** One line, cut to `width` so it never spills out of the panel. */
export function clip(text: string, width: number): string {
	return truncateToWidth(text, Math.max(0, width));
}

/** `text` padded to `width` visible columns. */
export function pad(text: string, width: number): string {
	const used = visibleWidth(text)

	return used >= width ? text : text + " ".repeat(width - used);
}

/**
 * A section title with a rule between it and its right-hand note, the way the
 * upstream pane draws its blocks.
 */
export function rule(title: string, width: number, right = ""): Line {
	const fill = Math.max(1, width - title.length - right.length - 2)

	return line(`${title} ${"─".repeat(fill)} ${right}`);
}
