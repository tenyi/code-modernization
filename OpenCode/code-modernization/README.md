# Code Modernization (OpenCode)

Point the agent at a legacy codebase and get four things: an understanding of what it is and what it
does, a plan you approve, the modernized code, and **proof that the new code behaves like the old**.
It works with any language and any kind of move: a newer version of the same technology, a rewrite in
another one, or a rebuild on a new architecture.

This is the OpenCode V2 port of the upstream
[Claude Code plugin](https://github.com/anthropics/claude-plugins-official). See
*What changed in the port* at the end.

## Install

The package is a plain directory; nothing is copied into OpenCode. Two config entries load the
skills and the plugin — point them at wherever you keep this package (absolute paths are the
simplest; note that `skills` paths resolve from the directory OpenCode runs in, while `plugins`
paths resolve from the config file itself):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "skills": ["/path/to/code-modernization/skills"],
  "plugins": ["/path/to/code-modernization/plugin"]
}
```

The eight agents are loaded by file location, not by config: copy or symlink the files in `agents/`
into `~/.config/opencode/agents/` (all projects) or a project's `.opencode/agents/` (that project
only). Each becomes a subagent named after the file, e.g. `business-rules-extractor`. A project
install in one line:

```sh
mkdir -p .opencode/agents && ln -s /path/to/code-modernization/agents/*.md .opencode/agents/
```

(See `OpenCode/README.md` in the porting repository for a worked install and a verification pass.)

Requirements: `python3` on `PATH` (the report, the proof and the rule renderer are Python). Without
it the skills still run, but the artifacts they generate are not produced — the agent says so in one
line instead of failing.

## Start here

Open a folder for the work and ask the agent to start the modernization, e.g.

> Use @modernize to work out what this legacy system does and what to do with it.

It asks what you want to do with your code (a couple of short pop-ups), finds the code, writes your
answers down once, shows the road ahead, and gives you the exact next step. Every later step reads
what you said, so nothing is asked twice. **Not sure what you want?** Choose *Understand it first*:
you get the assessment, the map, the business rules and a plan, and no code is rebuilt.

To go step by step instead, name the system and follow the "next step" line each skill ends with:

```
@modernize-preflight billing --source /work/billing
@modernize-status billing      # where am I, and what is next
```

Mentioning `@<skill>` in a message loads that skill with the text that follows as its arguments;
the agent can also load any of them with the `skill` tool by id (`modernize-preflight` and friends).

`<name>` is a short label of your choice (letters, digits, `-`, `_`). `--source` makes a link at
`legacy/<name>` and copies nothing, so a huge repository stays where it is. **Nothing edits your
legacy source.** Steps write only to `analysis/<name>/` and `modernized/` (a build check writes build
output where your build normally does), and each refreshes `analysis/<name>/REPORT.html`: one page,
with everything found so far, that you can open or share. A few steps need someone who knows how the
system is built and run, so bring an engineer for the first questions.

## The path

Each step stands alone, so you can stop and review after any of them.

| Step | Skill | What you get |
| --- | --- | --- |
| 0 | `modernize` | Say what you want. Writes `INTENT.md`; every later step reads it. |
| 1 | `modernize-preflight <name> [target-stack] [--source <path>]` | Is the environment ready? Asks five questions only a person can answer (is this the whole system or a slice, can it build and test here, is there custom build tooling, has anyone tried before, is anything off limits), proves a build works on this code, and finds missing source. |
| 2 | `modernize-assess <name>` | What am I dealing with: inventory, complexity, debt, security, and a recommended pattern. |
| 3 | `modernize-map <name>` | The structure: dependencies, data flow, entry points and business flows, as an interactive map. |
| 4 | `modernize-extract-rules <name>` | The business rules as testable Given/When/Then cards with `file:line` citations, each re-checked by a second agent. |
| 4b | `modernize-review <name>` | A person confirms or corrects the rules that look wrong. Your answers reach the plan and the build. |
| 5 | `modernize-brief <name> [target-stack]` | The phased plan a steering committee approves. **Nothing is built until you approve it.** |
| 6 | `modernize-uplift`, `modernize-transform` or `modernize-reimagine` | The build (see below). |
| 7 | `modernize-verify <name>` | **The proof.** An independent re-check with one verdict per module. |
| 8 | `modernize-harden <name>` | A security scan of the legacy system with a reviewed patch you apply yourself. |

`modernize-assess --portfolio <parent-dir>` surveys many systems and ranks them on one page.
`modernize-status <name>` says where you are and gives the exact next step.

**A person decides at six points**, and the plugin never decides them for you: the five preflight
answers, the rules that look wrong (`review`), approving the brief, accepting any difference the proof
finds, signing the proof, and applying the security patch.

## How it proves the result

Modernization fails quietly: the new code passes the tests someone wrote, and differs on the inputs
nobody thought of. So the proof is built from evidence a script can check, not from the model's
opinion. `modernize-verify` runs after a build, ideally in a fresh session, and re-does the work
instead of trusting the notes the build left behind:

- **The tests, run again from clean.** Build output is deleted, the full suite runs, and the counts
  come from the runner's own result files or a saved log. A run that executed no tests, or skipped
  them, is a failure, and a count the command merely typed in does not count.
- **Old and new on the same inputs.** Where the legacy code can run, both run on the same inputs and
  a script compares every byte. Only fields that must vary (timestamps, generated ids) are masked,
  floating-point output can be compared within a declared tolerance, and every masked field is listed
  in the result. A difference a person accepts is recorded with the reason.
- **Inputs nobody used.** It invents at least ten new inputs (boundaries, empty, huge, unusual order,
  and malformed records when you asked for exact behavior, quirks included) and compares again, so a
  suite that only passes on the cases the model chose is caught.
- **Tests that can fail.** A deliberate one-line break must turn tests red (the canary), and the
  comparison itself is checked by changing one byte of an output.
- **Every critical rule is backed by a test that ran.** Each P0 business rule must be named by a test
  that executed and passed. A rule named only by a skipped or pending test is listed as "named, not
  run", and a test folder that holds no code of its own is listed as tooling and gets no verdict.
- **The source is untouched**, checked by file times without running anything inside the analyzed tree.

Each module gets one verdict, computed by `scripts/proof_pack.py` from those files with rules written
into the output: **PROVEN**, **PARTLY PROVEN** (with what is missing) or **NOT PROVEN** (nothing ran,
something differs, a test fails). If the old system cannot run where you work (a mainframe program, a
system that only runs in production), the old behavior can only be checked against recorded outputs,
and the best verdict is PARTLY PROVEN: the page says so plainly. Anything a person must decide (open
questions, exit criteria, the sign-off) is listed as waiting for a person and is never ticked for
you. Every verdict is computed again from current evidence each time; none is carried over from an
earlier run.

## Choose how to build (the plan recommends one)

| If you want | Run | What happens |
| --- | --- | --- |
| The same technology on a newer version (.NET Framework to .NET 8, Java 8 to 17, Spring Boot 2 to 3) | `modernize-uplift <name> [source-version] [target-version]` | Keeps your code and fixes only what the new version breaks, driven by a catalog of the breaking changes this code actually hits. One pilot unit first with its lessons written down, then batches. The proof is the same test suite run on both versions. |
| A new technology, one module at a time, while the old system keeps running | `modernize-transform <name> [module] [target-stack]` | A plan you approve, tests that pin the old behavior, an idiomatic rewrite, and proof: old and new run on the same inputs and a script compares them. |
| A rebuild on a new architecture | `modernize-reimagine <name> [target-vision]` | A spec mined from the code, an architecture that is reviewed and approved, then services scaffolded with executable acceptance tests. |

A version move keeps your code, so it can skip `extract-rules` and `review`: `preflight`, `assess`,
`uplift`, `verify` is a complete path, and `map` and `brief` add the unit order and an approved phased
plan for a large system. If the delta catalog shows an "uplift" would rewrite most of the code, the
step says so and points to `transform`. Rehost (move as is) and Replace (buy a product) change no
code, so no build step applies; the analysis is still useful for both.

## What to expect

Steps run as subagents working for you, and the heavy ones run many at once. Rough times on systems
of tens of thousands of lines: preflight 3 to 4 minutes, assess 5 to 8, map 5 to 15, extract-rules 5
to 15, brief about 5. Building one module takes 15 to 30 minutes, an uplift pilot about 15. The
heaviest step, `extract-rules`, starts 50 to 200 subagents in these runs, and every fan-out step says
how many it will start; `extract-rules` asks before a big run. On systems in the millions of lines,
work one module or unit at a time. The size index in `assess` is a relative measure for ranking
systems, never a schedule or a cost.

## Words you will see

| Word | Plain meaning |
| --- | --- |
| Subagent | A separate worker that does one job (read one module, check one rule) and reports back. Steps start many of them at once. |
| Business rule card | One thing the system does, written as Given / When / Then with the file and line it comes from, so a person can check it. |
| P0 | A rule that would defeat the system's purpose or be costly or irreversible if it were wrong. Everything else is P1 or P2. |
| Brief | The written plan, phase by phase. You approve it; nothing is built before that. |
| Uplift / transform / reimagine | Newer version of the same technology / rewrite in another technology / rebuild on a new architecture. |
| Pilot | The first small unit built end to end, so its lessons are written down before the rest is attempted. |
| Canary | A deliberate one-line break in the new code that must make tests fail, proving the tests can fail. |
| Delta catalog | The list of things the newer version breaks that this code actually uses. |

## Set it up so it runs smoothly

The steps never edit your code, by convention. OpenCode asks for approval before it writes by
default, so keep the legacy source out of reach with a rule of the runtime rather than a promise: a
`deny` on the `edit` action (the action covering the file tools) for everything under `legacy/`, in
the `permissions` array of your `opencode.json(c)`. The steps never loosen a rule, and a `deny` is
always enforced. `preflight` checks for that rule and tells you how to add one:

```json
{ "action": "edit", "resource": "/absolute/path/to/legacy/**", "effect": "deny" }
```

During the build steps, also keep `shell` on the `ask` effect so each command the build runs is
approved: `{ "action": "shell", "resource": "*", "effect": "ask" }`.

`analysis/` and `modernized/` should be committed; the rest of `analysis/` may hold secrets and
working notes, so `analysis/.gitignore` is worth keeping.

## The plugin

| Hook | What it does |
| --- | --- |
| After a completed `read` (`tool` hook) | X-ray: when the agent reads a legacy file, what the analysis already knows about it (callers, data it touches, the rules citing it) rides along as context only the model sees. |
| At every prompt admission (`session` prompt hook) | The progress line: where the modernization stands and the one next step, kept as a session instruction entry. |

Both are plain `python3` scripts under `scripts/`, run by `plugin/index.ts`. They fail open: if
`python3` is missing or an artifact is malformed, the turn continues untouched. The plugin also
exports the package's own directory to every shell command as `CODE_MODERNIZATION_ROOT`, which is how
the skills find `scripts/` and `assets/`.

## What changed in the port

The procedure, the gates, the artifacts and the proof are the upstream ones. The runtime mapping is
not:

| Upstream (Claude Code) | Here (OpenCode V2) |
| --- | --- |
| 13 commands | 13 Skills, loaded with the `skill` tool by id (`modernize-…`), or mentioned as `@modernize-…` in a message; the arguments come from your message instead of a command line. |
| Upstream question pop-ups | the built-in `question` tool. |
| `Task` / `Agent` subagent types | the built-in `subagent` tool with `agent: "<name>"`, running the eight agents in `agents/`. |
| Scripted `Workflow` fan-outs (rule mining, portfolio survey, delta catalog, uplift migration, scaffolding, security scan) | the same fan-outs, written as procedure in the skills: the agent starts the subagents with `subagent` calls, in batches, and merges their JSON results the way the workflows merged them. |
| Live TUI progress pane, review deck and sign-off dialog | the HTML report (`analysis/<system>/REPORT.html`), the interactive map (`TOPOLOGY.html`), the `question` pop-ups, and the two hooks above. |
| Plugin settings (`userConfig`) | the workspace artifacts and your `opencode.json(c)` rules; no plugin settings panel. |
| Usage telemetry (whole counts only, on by default) | removed. Nothing is sent anywhere, by this plugin, ever. |
| `.claude/settings.json`, `CLAUDE.md` | `opencode.json(c)`, `AGENTS.md`. |

Everything the upstream README promised about the *result* — the assessment, the map, the rule cards
with citations, the approved plan, the per-module verdicts, the one-page report — is unchanged.

## License

Apache 2.0, as upstream. See `LICENSE`.
