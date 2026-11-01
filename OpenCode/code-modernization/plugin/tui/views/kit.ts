/**
 * The panel's drawing kit: the few operations the pane needs, over ANSI text.
 *
 * The upstream plugin draws its pane with its engine's element tree; the
 * OpenCode TUI has its own, so this port draws lines of styled text and the
 * TUI part converts each line to OpenTUI spans. The *content* is the
 * upstream's — same blocks, same rows, same words — only the drawing differs.
 */

/** The semantic colours the views ask for, resolved by the TUI part. */
export type ThemeToken = "accent" | "success" | "error" | "warning" | "muted" | "text";

export type Rgb = { r: number; g: number; b: number };

export type Palette = Record<ThemeToken, Rgb>;

export type Theme = {
	/** A semantic colour by the panel's token name. */
	fg: (token: ThemeToken, text: string) => string;
	/** A concrete colour, as `0x00RRGGBB`: the estate map's own palette. */
	fgColor: (color: number, text: string) => string;
	/** A background colour, as `0x00RRGGBB`: the estate map's cells. */
	bg: (color: number, text: string) => string;
	bold: (text: string) => string;
	dim: (text: string) => string;
};

/** The upstream's own palette, mapped onto the panel's semantic tokens. */
export const HEAD: ThemeToken = "accent";
export const GOOD: ThemeToken = "success";
export const BAD: ThemeToken = "error";
export const WARN: ThemeToken = "warning";
export const ACCENT: ThemeToken = "accent";
export const MUTED: ThemeToken = "muted";

export type Line = { text: string };

/** A line of the pane: already styled, but cut to the width it is drawn at. */
export const line = (text: string): Line => ({ text });

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

const sgr = (code: string, text: string): string => `${ESC}${code}m${text}${RESET}`;

const fgCodeOf = (rgb: Rgb): string => `38;2;${rgb.r};${rgb.g};${rgb.b}`;
const bgCodeOf = (rgb: Rgb): string => `48;2;${rgb.r};${rgb.g};${rgb.b}`;

/** The kit the views draw with, over a resolved palette. */
export function kit(palette: Palette): Theme {
	const rgbOf = (color: number): Rgb => ({
		r: (color >> 16) & 0xff,
		g: (color >> 8) & 0xff,
		b: color & 0xff,
	});

	return {
		fg: (token, text) => sgr(fgCodeOf(palette[token]), text),
		fgColor: (color, text) => sgr(fgCodeOf(rgbOf(color)), text),
		bg: (color, text) => sgr(bgCodeOf(rgbOf(color)), text),
		bold: (text) => sgr("1", text),
		dim: (text) => sgr("2", text),
	};
}

/** A span of one drawn line, after the ANSI codes are read. */
export type Span = { text: string; fg?: string; bg?: string; bold?: boolean; dim?: boolean };

const hex2 = (value: number): string => value.toString(16).padStart(2, "0");
const hexOf = (rgb: Rgb): string => `#${hex2(rgb.r)}${hex2(rgb.g)}${hex2(rgb.b)}`;

const ANSI = /\x1b\[([0-9;]*)m/g;

/** The text of a line with its style codes taken out. */
export function plainOf(text: string): string {
	return text.replace(ANSI, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Whether a code point takes two terminal columns. */
const isWide = (code: number): boolean =>
	(code >= 0x1100 && code <= 0x115f) ||
	(code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
	(code >= 0xac00 && code <= 0xd7a3) ||
	(code >= 0xf900 && code <= 0xfaff) ||
	(code >= 0xfe10 && code <= 0xfe19) ||
	(code >= 0xfe30 && code <= 0xfe6f) ||
	(code >= 0xff00 && code <= 0xff60) ||
	(code >= 0xffe0 && code <= 0xffe6) ||
	(code >= 0x1f300 && code <= 0x1f64f) ||
	(code >= 0x1f900 && code <= 0x1f9ff) ||
	(code >= 0x20000 && code <= 0x3fffd);

/** The terminal columns a styled line takes. */
export function visibleWidth(text: string): number {
	let width = 0;

	for (const char of plainOf(text)) {
		width += isWide(char.codePointAt(0) ?? 0) ? 2 : 1;
	}

	return width;
}

/** One line, cut to `width` columns so it never spills out of the panel. */
export function clip(text: string, width: number): string {
	if (width <= 0) return "";

	const limit = Math.max(0, width);
	let out = "";
	let used = 0;
	let isCut = false;

	for (let index = 0; index < text.length; ) {
		if (text[index] === "\x1b") {
			ANSI.lastIndex = index;
			const match = ANSI.exec(text);

			if (match !== null && match.index === index) {
				out += match[0];
				index += match[0].length;
				continue;
			}
		}

		const char = String.fromCodePoint(text.codePointAt(index) ?? 0);
		const size = isWide(char.codePointAt(0) ?? 0) ? 2 : 1;

		if (used + size > limit) {
			isCut = true;
			break;
		}

		out += char;
		used += size;
		index += char.length;
	}

	return isCut ? `${out}${RESET}` : out;
}

/** `text` padded to `width` visible columns. */
export function pad(text: string, width: number): string {
	const used = visibleWidth(text);

	return used >= width ? text : text + " ".repeat(width - used);
}

/** `text` word-wrapped to `width` columns. */
function wrapPlain(text: string, width: number): string[] {
	if (text === "") return [];

	const limit = Math.max(1, width);
	const out: string[] = [];
	let current = "";

	const push = (value: string) => {
		out.push(value);
	};

	for (const word of text.split(/\s+/).filter((part) => part !== "")) {
		let rest = word;

		while (visibleWidth(rest) > limit) {
			if (current !== "") {
				push(current);
				current = "";
			}

			// A word longer than the row is cut, not pushed past the edge.
			const cut = clip(rest, limit);
			push(cut);
			rest = rest.slice(plainOf(cut).length);
		}

		if (current === "") {
			current = rest;
		} else if (visibleWidth(`${current} ${rest}`) <= limit) {
			current = `${current} ${rest}`;
		} else {
			push(current);
			current = rest;
		}
	}

	if (current !== "") {
		push(current);
	}

	return out;
}

/** A block of text wrapped to `width`, each row styled the same way. */
export function wrap(text: string, width: number, style: (value: string) => string): Line[] {
	if (text === "") return [];

	return wrapPlain(text, Math.max(1, width)).map((row) => line(style(row)));
}

/**
 * A section title with a rule between it and its right-hand note, the way the
 * upstream pane draws its blocks.
 */
export function rule(title: string, width: number, right = ""): Line {
	const fill = Math.max(1, width - title.length - right.length - 2);

	return line(`${title} ${"─".repeat(fill)} ${right}`);
}

/**
 * Splits one drawn line into spans the terminal UI can render.
 *
 * The kit emits truecolour SGR codes (and bold/dim); this reads them back.
 * Nested styles are honoured as far as SGR allows: a reset returns to the
 * terminal's default, which is what every styled segment here ends with.
 */
export function spansOf(text: string): Span[] {
	const spans: Span[] = [];

	let fg: string | undefined;
	let bg: string | undefined;
	let bold = false;
	let dim = false;
	let buffer = "";

	const flush = () => {
		if (buffer === "") return;

		spans.push({
			text: buffer,
			...(fg !== undefined ? { fg } : {}),
			...(bg !== undefined ? { bg } : {}),
			...(bold ? { bold: true } : {}),
			...(dim ? { dim: true } : {}),
		});
		buffer = "";
	};

	const apply = (params: string[]) => {
		for (let index = 0; index < params.length; index += 1) {
			const code = Number(params[index]);

			if (code === 0) {
				flush();
				fg = undefined;
				bg = undefined;
				bold = false;
				dim = false;
			} else if (code === 1) {
				bold = true;
			} else if (code === 2) {
				dim = true;
			} else if (code === 22) {
				bold = false;
				dim = false;
			} else if (code === 39) {
				fg = undefined;
			} else if (code === 49) {
				bg = undefined;
			} else if (code === 38 && params[index + 1] === "2") {
				fg = hexOf({ r: Number(params[index + 2]), g: Number(params[index + 3]), b: Number(params[index + 4]) });
				index += 4;
			} else if (code === 48 && params[index + 1] === "2") {
				bg = hexOf({ r: Number(params[index + 2]), g: Number(params[index + 3]), b: Number(params[index + 4]) });
				index += 4;
			}
		}
	};

	for (let index = 0; index < text.length; ) {
		if (text[index] === "\x1b") {
			ANSI.lastIndex = index;
			const match = ANSI.exec(text);

			if (match !== null && match.index === index) {
				flush();
				apply((match[1] ?? "").split(";").filter((part) => part !== ""));
				index += match[0].length;
				continue;
			}
		}

		buffer += text[index];
		index += 1;
	}

	flush();

	return spans.length > 0 ? spans : [{ text: "" }];
}
