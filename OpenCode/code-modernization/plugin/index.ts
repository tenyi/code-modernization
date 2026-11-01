// The package's plugin: the two hooks the upstream plugin ran from hooks/hooks.json (x-ray and the
// progress line), the root variable the skills resolve their scripts and assets with, and the
// `workflow` tool (the upstream's scripted fan-outs, bound to child sessions here).
//
//   1. X-ray          — after a completed `read`, scripts/xray.py adds what the analysis already
//                       knows about the file, as context only the model sees.
//   2. Progress line  — at every prompt admission, scripts/status.py says where the modernization
//                       stands and the one step to take next; the text is kept as a session
//                       instruction entry (OpenCode has no SessionStart hook: the first prompt
//                       covers session start).
//   3. Package root   — every shell command gets CODE_MODERNIZATION_ROOT in its environment.
//   4. Workflow       — `workflow({name, args})` runs one of workflows/*.js; each `agent()` call
//                       is one child session with the package's agent and the script's schema.
//
// All four fail open: no python3, a timeout (5 s, as upstream), malformed output, a workflow
// registration error — the turn continues untouched.

import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"

import { registerWorkflowTool, type WorkflowPluginContext } from "./workflow/tool"

const PLUGIN_DIR = fileURLToPath(new URL(".", import.meta.url))
const PKG_ROOT = dirname(PLUGIN_DIR) // plugin/ -> package root
const SCRIPTS = join(PKG_ROOT, "scripts")
const WORKFLOWS = join(PKG_ROOT, "workflows")
const TIMEOUT_MS = 5000
const ENTRY_KEY = "code-modernization"

export default Plugin.define({
  id: "code-modernization",
  async setup(ctx) {
    // The session's working directory, where analysis/ and legacy/ live. A hook event carries the
    // sessionID; ask the session for its directory, fall back to where this plugin was loaded.
    async function sessionDirectory(sessionID: string): Promise<string> {
      try {
        const session = await ctx.session.get({ sessionID })
        if (session?.location?.directory) return session.location.directory
      } catch {
        // fall through
      }
      return ctx.location.directory
    }

    // Run a package script with a JSON payload on stdin, collecting its stdout. Never throws.
    function runScript(script: string, payload: unknown, cwd: string): Promise<string> {
      return new Promise((resolve) => {
        const python = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"]
        let finished = false
        const done = (out: string) => {
          if (finished) return
          finished = true
          resolve(out)
        }
        const attempt = (index: number) => {
          if (index >= python.length) return done("")
          let child
          try {
            child = spawn(python[index], [join(SCRIPTS, script)], {
              cwd,
              stdio: ["pipe", "pipe", "ignore"],
            })
          } catch {
            done("")
            return
          }
          let out = ""
          const timer = setTimeout(() => {
            try {
              child.kill()
            } catch {
              // already gone
            }
            done("")
          }, TIMEOUT_MS)
          child.stdout.on("data", (data) => {
            out += data
          })
          child.on("error", () => {
            clearTimeout(timer)
            attempt(index + 1) // e.g. python3 missing: try python
          })
          child.on("close", () => {
            clearTimeout(timer)
            done(out)
          })
          try {
            child.stdin.end(JSON.stringify(payload))
          } catch {
            clearTimeout(timer)
            try {
              child.kill()
            } catch {
              // already gone
            }
            done("")
          }
        }
        attempt(0)
      })
    }

    // {"hookSpecificOutput": {"additionalContext": "..."}} or nothing.
    function additionalContext(stdout: string): string {
      try {
        const parsed = JSON.parse(stdout)
        const text = parsed?.hookSpecificOutput?.additionalContext
        return typeof text === "string" ? text : ""
      } catch {
        return ""
      }
    }

    // The script reads three keys: `path`, `offset`, `limit`. OpenCode's `read` tool sends
    // `path` (relative to the project root) plus those two, so the names line up today; the
    // arguments are narrowed to what the script reads anyway, so a tool that names the file
    // `filePath` still gets an x-ray. The script is the master's, byte for byte.
    function readInputOf(input: unknown): Record<string, unknown> {
      const args = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
      const file = typeof args.filePath === "string" ? args.filePath : typeof args.path === "string" ? args.path : undefined
      const offset = typeof args.offset === "number" ? args.offset : undefined
      const limit = typeof args.limit === "number" ? args.limit : undefined

      return {
        ...(file !== undefined ? { path: file } : {}),
        ...(offset !== undefined ? { offset } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }
    }

    // 1 — X-ray: PostToolUse on `read`, upstream.
    await ctx.tool.hook("execute.after", async (event) => {
      if (event.tool !== "read" || event.status !== "completed") return
      try {
        const cwd = await sessionDirectory(event.sessionID)
        const notes = additionalContext(await runScript("xray.py", { tool_input: readInputOf(event.input), cwd }, cwd))
        if (!notes) return
        const content = event.result.content
        const prior =
          typeof content === "string"
            ? [{ type: "text" as const, text: content }]
            : [...(content ?? [])]
        event.result = { ...event.result, content: [...prior, { type: "text" as const, text: notes }] }
      } catch {
        // fail open
      }
    })

    // 2 — Progress line: UserPromptSubmit (+ SessionStart) upstream.
    await ctx.session.hook("prompt", async (event) => {
      try {
        const cwd = await sessionDirectory(event.sessionID)
        const payload = { cwd, prompt: event.prompt.text, hook_event_name: "UserPromptSubmit" }
        const text = additionalContext(await runScript("status.py", payload, cwd))
        if (text) {
          await ctx.session.instructions.entry.put({ sessionID: event.sessionID, key: ENTRY_KEY, value: text })
        } else {
          // No analysis here (or nothing to say): drop a stale line from an earlier prompt.
          await ctx.session.instructions.entry.remove({ sessionID: event.sessionID, key: ENTRY_KEY })
        }
      } catch {
        // fail open
      }
    })

    // 3 — Package root for every shell command, so the skills can run
    // `python3 "$CODE_MODERNIZATION_ROOT/scripts/<script>.py" …`.
    await ctx.shell.hook("create.before", (event) => {
      event.env.CODE_MODERNIZATION_ROOT = PKG_ROOT
    })

    // 4 — The scripted fan-outs: the upstream's `workflows/*.js`, run with
    // OpenCode's child sessions as their agents. A registration failure must
    // not take the two hooks above down with it.
    try {
      await registerWorkflowTool(ctx as unknown as WorkflowPluginContext, { scriptsDir: WORKFLOWS })
    } catch {
      // fail open: the procedures still run, in batches, without the tool
    }
  },
})
