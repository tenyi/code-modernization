/** @jsxImportSource @opentui/solid */
// The TUI part of the package: the modernization panel, the rule review deck
// and the sign-off dialog.
//
// The server plugin (`plugin/index.ts`) adds the `workflow` tool and the two
// hooks; this part runs in the terminal UI and adds the three surfaces the
// upstream plugin kept in its engine: a `session.panel` contribution for the
// pane, one for the review deck, one for the sign-off, and the status line
// under the prompt. The workspace reading and the drawing are in `tui/`; this
// file only binds them to OpenCode's TUI context.

import { Plugin, usePlugin } from "@opencode/plugin/tui";
import type { InputRenderable } from "@opentui/core";
import { createMemo, createSignal, Index, onCleanup, onMount, Show } from "solid-js";

import { signView } from "./tui/views/deck";
import { clip, kit, plainOf, spansOf, type Line, type Palette, type Rgb, type Theme } from "./tui/views/kit";
import { DECK_NAME, PANEL_NAME, PanelHost, readOptions, SIGN_NAME } from "./tui/host";
import { lineOf } from "./tui/fleet/fleet";
import { FLASH_MS } from "./tui/map/estate";
import { nextButtonsOf } from "./tui/views/pane";

/** What the TUI part needs from the session panel slot. */
type PanelProps = {
	readonly name: string;
	readonly sessionID: string;
	readonly width: number;
	readonly focused: boolean;
	readonly focus: () => void;
	readonly close: () => void;
};

/** The props every panel contribution gets from this plugin. */
type BoundProps = {
	readonly panel: PanelProps;
	readonly host: PanelHost;
	readonly revision: () => number;
	readonly refresh: () => Promise<void>;
};

/**
 * Takes input when the panel opens: the host leaves focus in the prompt
 * otherwise, so the panel's keys would type into it instead. The timeout lets
 * the host mount its pane node first.
 */
function usePanelFocus(panel: PanelProps, then?: () => void) {
	onMount(() => {
		const timer = setTimeout(() => {
			panel.focus();
			then?.();
		}, 0);

		onCleanup(() => clearTimeout(timer));
	});
}

/** The fallback palette, used only if a theme token is missing. */
const FALLBACK: Palette = {
	accent: { r: 0xf5, g: 0xa7, b: 0x42 },
	success: { r: 0x7f, g: 0xd1, b: 0x7a },
	error: { r: 0xff, g: 0x6b, b: 0x6b },
	warning: { r: 0xff, g: 0xc8, b: 0x57 },
	muted: { r: 0x8a, g: 0x8a, b: 0x8a },
	text: { r: 0xdd, g: 0xdd, b: 0xdd },
};

/** How often the map is redrawn while a lit tile fades, in milliseconds. */
const FLASH_TICK_MS = 250;

/**
 * The marker the x-ray's note ends with.
 *
 * The x-ray itself runs in the server plugin, which appends the note to the
 * tool's result; the panel counts the reads that carried one.
 */
const XRAY_MARKER = "[end x-ray]";

/** The tools that change the working copy, so the workspace is read again after them. */
const WRITE_TOOLS = new Set(["edit", "write", "patch", "apply_patch"]);

/** The id an event carries, when it has one. */
const idOf = (data: Record<string, unknown> | undefined): string | null =>
	typeof data?.id === "string" ? data.id : null;

/** A string field of an event's data. */
const strOf = (data: Record<string, unknown> | undefined, key: string): string | null =>
	typeof data?.[key] === "string" ? (data[key] as string) : null;

/** The arguments a tool call was made with. */
const argsOf = (data: Record<string, unknown> | undefined): Record<string, unknown> => {
	const input = data?.input;

	return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
};

/** What a failed tool call said. */
const errorOf = (data: Record<string, unknown> | undefined): string => {
	const error = data?.error;

	if (typeof error !== "object" || error === null) {
		return "";
	}

	const message = (error as { message?: unknown }).message;

	return typeof message === "string" ? message : "";
};

/** True when a tool's result carries the x-ray's note. */
const carriesXray = (content: unknown): boolean => {
	if (!Array.isArray(content)) {
		return false;
	}

	return content.some((part) => {
		const text = typeof part === "object" && part !== null ? (part as { text?: unknown }).text : undefined;

		return typeof text === "string" && text.includes(XRAY_MARKER);
	});
};

/** The payload of a prompt the user sent, with the skills it named. */
type PromptPayload = {
	text?: string;
	skills?: { id?: string; name?: string }[];
};

/** The prompt an inbox event carries, when it carries one. */
const promptOf = (data: Record<string, unknown> | undefined): PromptPayload | null => {
	const item = data?.item;

	if (typeof item !== "object" || item === null) {
		return null;
	}

	const payload = (item as { payload?: unknown }).payload;

	if (typeof payload !== "object" || payload === null) {
		return null;
	}

	return payload as PromptPayload;
};

/**
 * The step a prompt names, when it names one in its text.
 *
 * The upstream matched the command it was given in the prompt; OpenCode's
 * mention is `@modernize-…`.
 */
const stepOf = (text: string): string | null => /@?(modernize-[a-z-]+)\b/.exec(text)?.[1] ?? null;

const rgbOf = (value: unknown): Rgb | undefined => {
	if (value === null || typeof value !== "object") return undefined;

	const color = value as { toInts?: () => [number, number, number, number] };

	if (typeof color.toInts !== "function") return undefined;

	const [r, g, b] = color.toInts();

	return { r, g, b };
};

/** The theme the panel draws with, from the TUI's resolved semantic tokens. */
function paletteOf(context: { theme: unknown }): Palette {
	const pick = (fallback: Rgb, ...values: unknown[]): Rgb => {
		for (const value of values) {
			const rgb = rgbOf(value);

			if (rgb !== undefined) return rgb;
		}

		return fallback;
	};

	const theme = (context.theme ?? {}) as Record<string, any>;

	return {
		accent: pick(FALLBACK.accent, theme?.hue?.accent?.[400], theme?.text?.action?.primary?.base),
		success: pick(FALLBACK.success, theme?.text?.feedback?.success?.base, theme?.syntax?.string),
		error: pick(FALLBACK.error, theme?.text?.feedback?.error?.base, theme?.syntax?.keyword),
		warning: pick(FALLBACK.warning, theme?.text?.feedback?.warning?.base),
		muted: pick(FALLBACK.muted, theme?.text?.muted),
		text: pick(FALLBACK.text, theme?.text?.base),
	};
}

/** One drawn line, as an OpenTUI text node with styled spans. */
function DrawnLine(props: { line: Line }) {
	return (
		<text wrapMode="none">
			<Index each={spansOf(props.line.text)}>
				{(span) => (
					<span
						style={{
							fg: span().fg,
							bg: span().bg,
							bold: span().bold === true,
							dim: span().dim === true,
						}}
					>
						{span().text}
					</span>
				)}
			</Index>
		</text>
	);
}

/** A block of drawn lines. */
function Lines(props: { lines: Line[] }) {
	return (
		<Index each={props.lines}>{(entry) => <DrawnLine line={entry()} />}</Index>
	);
}

/** A scrollable block of drawn lines. */
function ScrollingLines(props: { lines: Line[]; focused: boolean }) {
	return (
		<scrollbox width="100%" height="100%" focused={props.focused}>
			<Lines lines={props.lines} />
		</scrollbox>
	);
}

/** The pane: where the work stands, what needs a person, and the next step. */
function PanePanel(props: BoundProps) {
	const context = usePlugin();
	const theme: Theme = kit(paletteOf(context));
	const width = () => Math.max(24, props.panel.width);

	usePanelFocus(props.panel);

	const lines = createMemo(() => {
		props.revision();
		props.host.syncFleet(context, props.panel.sessionID);

		return props.host.drawPane(theme, width());
	});

	const choose = (index: number) => {
		const snapshot = props.host.controller.state.snapshot;

		if (snapshot === null) return;

		const label = nextButtonsOf(snapshot, props.host.controller.state)[index];

		if (label === "show next step") {
			const next = snapshot.next;

			if (next !== null) {
				void context.ui.dialog.alert({ title: "Next step", message: next.text });
			}

			return;
		}

		if (label === "sign the brief") {
			props.host.controller.openSign();
			context.ui.panel.open(SIGN_NAME);

			return;
		}

		if (label === "review rules") {
			props.host.controller.openDeck("flagged", "");
			context.ui.panel.open(DECK_NAME);

			return;
		}

		if (label === "stop the run") {
			void context.client.session
				.interrupt({ sessionID: props.panel.sessionID })
				.then((result) => {
					context.ui.toast.show({
						message: result.interrupted ? "The run was stopped." : "There was no run to stop.",
						variant: result.interrupted ? "success" : "info",
					});
				});
		}
	};

	context.keymap.layer(() => ({
		mode: "global",
		priority: 20,
		commands: [
			{ id: "modernize.panel.escape", bind: "escape", run: () => props.panel.close() },
			{ id: "modernize.panel.one", bind: "1", run: () => choose(0) },
			{ id: "modernize.panel.two", bind: "2", run: () => choose(1) },
			{ id: "modernize.panel.three", bind: "3", run: () => choose(2) },
			{ id: "modernize.panel.four", bind: "4", run: () => choose(3) },
			{ id: "modernize.panel.refresh", bind: "r", run: () => void props.refresh() },
		],
	}));

	return (
		<box flexDirection="column" width="100%" height="100%">
			<ScrollingLines lines={lines()} focused={props.panel.focused} />
		</box>
	);
}

/** The rule review deck: one rule at a time, with the three verdicts. */
function ReviewPanel(props: BoundProps) {
	const context = usePlugin();
	const theme: Theme = kit(paletteOf(context));
	const width = () => Math.max(24, props.panel.width);

	usePanelFocus(props.panel);

	const lines = createMemo(() => {
		props.revision();

		return props.host.drawDeck(theme, width(), 34);
	});

	const save = () => {
		const saved = props.host.controller.saveDeck();

		context.ui.toast.show({ message: saved.message, variant: saved.written ? "success" : "error" });
		props.panel.close();
	};

	const step = (action: () => void) => {
		action();
		void props.refresh();
	};

	context.keymap.layer(() => ({
		mode: "global",
		priority: 21,
		commands: [
			{
				id: "modernize.review.confirmed",
				bind: "1",
				run: () => step(() => props.host.controller.decide("confirmed")),
			},
			{
				id: "modernize.review.wrong",
				bind: "2",
				run: () => step(() => props.host.controller.decide("wrong")),
			},
			{
				id: "modernize.review.discuss",
				bind: "3",
				run: () => step(() => props.host.controller.decide("discuss")),
			},
			{
				id: "modernize.review.prev",
				bind: "4",
				run: () => step(() => props.host.controller.prev()),
			},
			{
				id: "modernize.review.next",
				bind: "5",
				run: () => step(() => props.host.controller.next()),
			},
			{
				id: "modernize.review.source",
				bind: "6",
				run: () => step(() => void props.host.controller.toggleSource()),
			},
			{
				id: "modernize.review.undo",
				bind: "7",
				run: () => step(() => props.host.controller.undo()),
			},
			{
				id: "modernize.review.save",
				bind: "0",
				run: save,
			},
			{
				id: "modernize.review.escape",
				bind: "escape",
				run: save,
			},
		],
	}));

	return (
		<box flexDirection="column" width="100%" height="100%">
			<ScrollingLines lines={lines()} focused={props.panel.focused} />
		</box>
	);
}

/** The sign-off: the name that goes in the brief, and what the approval covers. */
function SignPanel(props: BoundProps) {
	const context = usePlugin();
	const theme: Theme = kit(paletteOf(context));
	const width = () => Math.max(30, props.panel.width);
	const [name, setName] = createSignal(props.host.controller.state.sign.name);
	const covers = () => props.host.controller.state.sign.covers;
	let nameInput: InputRenderable | undefined;

	usePanelFocus(props.panel, () => nameInput?.focus());

	const lines = createMemo(() => {
		props.revision();

		const snapshot = props.host.controller.state.snapshot;
		const system = snapshot?.system ?? "the system";

		return signView(theme, props.host.controller.state.sign, system, snapshot?.brief?.openQuestions ?? 0, width(), {
			name: () => undefined,
			covers: () => undefined,
			sign: () => undefined,
			cancel: () => undefined,
		}).filter((entry) => !plainOf(entry.text).startsWith("Approved by:"));
	});

	const toggle = () => {
		props.host.controller.state.sign.covers = covers() === "phase-1" ? "full" : "phase-1";
		void props.refresh();
	};

	const signNow = (value = name()) => {
		const result = props.host.controller.sign(value, covers());

		context.ui.toast.show({ message: result.message, variant: result.written ? "success" : "error" });

		if (result.written) props.panel.close();
	};

	context.keymap.layer(() => ({
		mode: "global",
		priority: 21,
		commands: [
			{
				id: "modernize.sign.covers",
				bind: "ctrl+t",
				run: toggle,
			},
			{
				id: "modernize.sign.escape",
				bind: "escape",
				run: () => props.panel.close(),
			},
		],
	}));

	return (
		<box flexDirection="column" width="100%" height="100%">
			<Lines lines={lines()} />
			<box height={1} />
			<input
				ref={(value) => (nameInput = value)}
				focused={props.panel.focused}
				placeholder="Your name"
				value={name()}
				onInput={(value: string) => {
					setName(value);
					props.host.controller.state.sign.name = value;
				}}
				onSubmit={() => signNow()}
			/>
		</box>
	);
}

/** The one line under the prompt: where the work stands. */
function StatusLine(props: { host: PanelHost; revision: () => number }) {
	const text = () => {
		props.revision();

		return props.host.controller.oneLine();
	};

	return (
		<Show when={text() !== ""}>
			<text>{clip(text(), 80)}</text>
		</Show>
	);
}

export default Plugin.define({
	id: "code-modernization.tui",
	async setup(context) {
		const location = context.location ?? context.data.location.default();
		const cwd = location.directory;
		const host = new PanelHost(cwd, readOptions(cwd, context.options as Record<string, unknown>));
		const [revision, setRevision] = createSignal(0);
		const bump = () => setRevision((value) => value + 1);
		const refresh = async () => {
			await host.refresh();
			bump();
		};

		await refresh();
		host.controller.start(bump);

		let scheduled: ReturnType<typeof setTimeout> | null = null;
		const schedule = () => {
			if (scheduled !== null) return;

			scheduled = setTimeout(() => {
				scheduled = null;
				void refresh();
			}, 400);
		};

		// The map's lit tile fades over a few seconds, so it is redrawn while it does.
		let flashTimer: ReturnType<typeof setInterval> | null = null;
		let flashUntil = 0;

		const flash = () => {
			flashUntil = Date.now() + FLASH_MS;

			if (flashTimer !== null) return;

			const timer = setInterval(() => {
				bump();

				if (Date.now() >= flashUntil) {
					clearInterval(timer);
					flashTimer = null;
				}
			}, FLASH_TICK_MS);

			flashTimer = timer;
		};

		/** The session the panel is about: the route's, or the open panel's. */
		const currentSession = (): string | null => {
			const route = context.ui.router.current();

			if (route.type === "session") {
				return route.sessionID;
			}

			return context.ui.panel.current()?.sessionID ?? null;
		};

		const stopListen = context.data.listen((event) => {
			const type = event.details.type;
			const data = event.details.data as Record<string, unknown> | undefined;
			const session = currentSession();

			if (session !== null) {
				host.syncFleet(context, session);
			}

			host.noteExecution(type, data);

			// The tool calls: the session's own go to the activity block, a child
			// agent's go to the fleet. Every call lights the tile it touches.
			if (type === "session.tool.input.started") {
				const id = idOf(data);
				const name = strOf(data, "name");
				const sessionID = strOf(data, "sessionID");

				if (id !== null && name !== null && sessionID !== null && host.isOurs(sessionID)) {
					host.noteToolName(id, name);
				}
			} else if (type === "session.tool.called") {
				const id = idOf(data);
				const sessionID = strOf(data, "sessionID");

				if (id !== null && sessionID !== null && host.isOurs(sessionID)) {
					const touched = host.noteToolStarted(id, sessionID, argsOf(data));

					if (touched.length > 0) {
						flash();
					}
				}
			} else if (type === "session.tool.success") {
				const id = idOf(data);

				if (id !== null) {
					const xray = carriesXray(data?.content);
					const outcome = host.noteToolEnded(id, true, undefined, xray ? "x-ray" : undefined);

					if (outcome !== null) {
						if (xray) {
							host.noteXray(outcome.isOwn);
						}

						// A write may have changed the working copy: the next read lists it afresh.
						if (WRITE_TOOLS.has(outcome.tool)) {
							schedule();
						}
					}
				}
			} else if (type === "session.tool.failed") {
				const id = idOf(data);

				if (id !== null) {
					const outcome = host.noteToolEnded(id, false, errorOf(data));

					if (outcome?.signature != null) {
						context.ui.toast.show({
							message: `Fleet: ${lineOf(outcome.signature)}`,
							variant: "warning",
							duration: 9000,
						});
					}
				}
			} else if (type === "session.skill.activated") {
				const sessionID = strOf(data, "sessionID");
				const name = strOf(data, "name");

				if (sessionID !== null && name !== null) {
					host.noteSkill(sessionID, name);
				}
			} else if (type === "session.inbox.enqueued") {
				// The prompt that starts a turn names the step, as a skill attachment
				// or as the mention in its text.
				const sessionID = strOf(data, "sessionID");
				const payload = promptOf(data);

				if (sessionID !== null && payload !== null) {
					const skill = payload.skills?.[0]?.name;
					const mention = skill ?? stepOf(payload.text ?? "");

					if (mention !== null) {
						host.noteSkill(sessionID, mention);
					}
				}
			}

			// Token and step deltas are far too frequent to redraw a whole panel for.
			const isRelevant =
				type === "session.execution.started" ||
				type === "session.execution.succeeded" ||
				type === "session.execution.failed" ||
				type === "session.execution.interrupted" ||
				type === "session.idle" ||
				type === "session.created" ||
				type === "session.deleted" ||
				type === "session.tool.input.started" ||
				type === "session.tool.called" ||
				type === "session.tool.success" ||
				type === "session.tool.failed" ||
				type === "session.skill.activated" ||
				type === "session.inbox.enqueued" ||
				type === "filesystem.changed";

			if (!isRelevant) return;

			bump();

			if (type === "session.execution.succeeded" || type === "session.execution.failed" || type === "session.execution.interrupted" || type === "session.idle" || type === "filesystem.changed") {
				schedule();
			}
		});

		const unregisterPane = context.ui.slot({
			append: "session.panel",
			render: (panel: PanelProps) => (
				<Show when={panel.name === PANEL_NAME}>
					<PanePanel panel={panel} host={host} revision={revision} refresh={refresh} />
				</Show>
			),
		});

		const unregisterDeck = context.ui.slot({
			append: "session.panel",
			render: (panel: PanelProps) => (
				<Show when={panel.name === DECK_NAME}>
					<ReviewPanel panel={panel} host={host} revision={revision} refresh={refresh} />
				</Show>
			),
		});

		const unregisterSign = context.ui.slot({
			append: "session.panel",
			render: (panel: PanelProps) => (
				<Show when={panel.name === SIGN_NAME}>
					<SignPanel panel={panel} host={host} revision={revision} refresh={refresh} />
				</Show>
			),
		});

		const unregisterStatus = context.ui.slot({
			append: "prompt.footer.status",
			render: () => <StatusLine host={host} revision={revision} />,
		});

		const openPanel = async (name: string) => {
			await refresh();

			if (!context.ui.panel.open(name)) {
				context.ui.toast.show({ message: "Open a session first: the panel belongs to one.", variant: "info" });
			}
		};

		context.keymap.layer(() => ({
			mode: "global",
			priority: 10,
			commands: [
				{
					id: "modernize.panel",
					title: "Show the modernization panel",
					group: "Modernization",
					slash: { name: "modernize-panel" },
					palette: true,
					run: () => openPanel(PANEL_NAME),
				},
				{
					id: "modernize.review",
					title: "Review the business rules that need a person",
					group: "Modernization",
					slash: { name: "modernize-review-pane", arguments: true },
					palette: true,
					run: async (input?: string) => {
						await refresh();

						const words = (input ?? "").trim().split(/\s+/).filter((word) => word !== "");
						const first = (words[0] ?? "").toLowerCase();
						const isScope = first === "flagged" || first === "p0" || first === "all";
						const scope = isScope ? first : "flagged";
						const filter = (isScope ? words.slice(1) : words).join(" ");

						host.controller.openDeck(scope as "flagged" | "p0" | "all", filter);

						if (host.controller.state.deck.queue.length === 0) {
							context.ui.toast.show({ message: "There are no rules to review among those.", variant: "info" });

							return;
						}

						if (!context.ui.panel.open(DECK_NAME)) {
							context.ui.toast.show({ message: "Open a session first: the review belongs to one.", variant: "info" });
						}
					},
				},
				{
					id: "modernize.sign",
					title: "Sign the modernization brief",
					group: "Modernization",
					slash: { name: "modernize-sign", arguments: true },
					palette: true,
					run: async (input?: string) => {
						await refresh();

						const given = (input ?? "").trim();

						if (given === "") {
							host.controller.openSign();
							await openPanel(SIGN_NAME);

							return;
						}

						const result = host.controller.sign(given, host.controller.state.sign.covers);

						context.ui.toast.show({ message: result.message, variant: result.written ? "success" : "error" });
					},
				},
			],
		}));

		return () => {
			host.controller.stop();
			stopListen();
			unregisterPane();
			unregisterDeck();
			unregisterSign();
			unregisterStatus();

			if (scheduled !== null) {
				clearTimeout(scheduled);
				scheduled = null;
			}

			if (flashTimer !== null) {
				clearInterval(flashTimer);
				flashTimer = null;
			}
		};
	},
});
