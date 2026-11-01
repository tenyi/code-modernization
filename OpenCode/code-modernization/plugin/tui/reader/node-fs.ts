import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ReaderFs } from "./fs";

/**
 * The file access the reader needs, over node's own file system.
 *
 * The upstream plugin binds the same interface to its engine's file system;
 * this is the OpenCode binding of it, so every reader above works unchanged.
 *
 * Two rules the upstream's engine also holds to: a path outside the
 * workspace is still readable (the legacy tree may be a link to somewhere
 * else), but a link is never followed when listing — a legacy tree that is a
 * link shows as one entry, not as the tree it points at.
 */

/** The kind of an entry, as the reader names it. */
export type EntryKind = "file" | "dir" | "other";

/** The file system of one workspace. */
export function nodeFs(cwd: string): ReaderFs {
	const resolve = (target: string): string => (path.isAbsolute(target) ? target : path.join(cwd, target));

	const statOf = async (target: string) => {
		const stat = await fs.lstat(resolve(target));

		return {
			kind: (stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other") as EntryKind,
			size: stat.size,
			mtimeMs: stat.mtimeMs,
		};
	};

	return {
		async read(target: string): Promise<string> {
			return fs.readFile(resolve(target), "utf-8");
		},

		async list(target: string) {
			const entries = await fs.readdir(resolve(target), { withFileTypes: true });

			return Promise.all(
				entries.map(async (entry) => {
					const full = path.join(resolve(target), entry.name);

					if (entry.isDirectory()) {
						return { name: entry.name, kind: "dir" as const, size: 0 };
					}

					if (entry.isFile()) {
						const stat = await fs.lstat(full);

						return { name: entry.name, kind: "file" as const, size: stat.size };
					}

					// A symbolic link is `other`, whatever it leads to: the reader decides.
					let size = 0;

					try {
						size = (await fs.lstat(full)).size;
					} catch {
						size = 0;
					}

					return { name: entry.name, kind: "other" as const, size, isLink: true };
				}),
			);
		},

		async exists(target: string): Promise<boolean> {
			try {
				await fs.lstat(resolve(target));

				return true;
			} catch {
				return false;
			}
		},

		async stat(target: string) {
			return statOf(target);
		},
	};
}
