import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { AgentAnswer, AgentOptions, JsonSchema, WorkflowHost } from "./runtime";

/**
 * Loading a workflow script and running it.
 *
 * The upstream's scripts are JavaScript with two parts: a `meta` export that
 * describes the script, and a body that runs and returns its result. The
 * runtime they expect is small — the host functions below — so the port
 * evaluates the body with those in scope and keeps the script's own text.
 */

/** What a workflow script describes itself as. */
export type WorkflowMeta = {
	name: string;
	description: string;
	whenToUse: string;
	phases?: { title: string; detail: string }[];
};

/** A workflow script that has been read. */
export type WorkflowScript = {
	meta: WorkflowMeta;
	/** The body, with the `meta` export taken out. */
	body: string;
	/** The file the script came from. */
	path: string;
};

/**
 * The `export const meta = {…}` block, and the body that follows it.
 *
 * The block is found by its braces, not by a regular expression over its
 * contents, so a description with a brace in it does not cut the script.
 */
export function splitScript(source: string): { meta: WorkflowMeta; body: string } {
	const marker = source.match(/export\s+const\s+meta\s*=\s*\{/);

	if (marker === null || marker.index === undefined) {
		throw new Error("The workflow script has no `export const meta = {…}` block.");
	}

	const open = source.indexOf("{", marker.index);
	let depth = 0;
	let close = -1;

	for (let index = open; index < source.length; index += 1) {
		const char = source[index];

		if (char === "{") {
			depth += 1;
		} else if (char === "}") {
			depth -= 1;

			if (depth === 0) {
				close = index;
				break;
			}
		}
	}

	if (close < 0) {
		throw new Error("The workflow script's `meta` block is not closed.");
	}

	const literal = source.slice(open, close + 1);
	const meta = readMeta(literal);
	const body = source.slice(close + 1);

	return { meta, body };
}

/** The `meta` object, read from the script's own text. */
function readMeta(literal: string): WorkflowMeta {
	// The literal is JavaScript, not JSON: its keys are bare and its strings
	// are single-quoted. It is read as an object literal, which is what it is.
	const read = new Function(`"use strict"; return (${literal});`)() as Partial<WorkflowMeta>;

	return {
		name: typeof read.name === "string" ? read.name : "",
		description: typeof read.description === "string" ? read.description : "",
		whenToUse: typeof read.whenToUse === "string" ? read.whenToUse : "",
		...(Array.isArray(read.phases) ? { phases: read.phases } : {}),
	};
}

/** Reads a workflow script from disk. */
export async function readScript(file: string): Promise<WorkflowScript> {
	let source: string;

	try {
		source = await fs.readFile(file, "utf-8");
	} catch {
		throw new Error(`The workflow script ${path.basename(file)} could not be read.`);
	}

	const { meta, body } = splitScript(source);

	return { meta, body, path: file };
}

/** The workflow scripts a package ships, by name. */
export async function listScripts(dir: string): Promise<{ name: string; file: string }[]> {
	try {
		const entries = await fs.readdir(dir);

		return entries
			.filter((entry) => entry.endsWith(".js"))
			.map((entry) => ({ name: entry.replace(/\.js$/, ""), file: path.join(dir, entry) }))
			.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

/**
 * Runs a script's body with the host in scope, and returns what it returns.
 *
 * The body is an async function body: it may `await`, and it `return`s its
 * result. The scripts are written that way, so they are run that way.
 */
export async function runScript(
	script: WorkflowScript,
	args: unknown,
	host: WorkflowHost,
): Promise<unknown> {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
		...names: string[]
	) => (...values: unknown[]) => Promise<unknown>;

	const body = new AsyncFunction("args", "agent", "parallel", "pipeline", "log", "budget", script.body);

	return body(args, host.agent, host.parallel, host.pipeline, host.log, host.budget);
}

/** The schema a script's answers are checked against. */
export type { JsonSchema };
