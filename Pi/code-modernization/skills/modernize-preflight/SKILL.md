---
name: modernize-preflight
description: Run this first — checks the environment, records where the code lives, and says what to fix before anything else runs
---

**Invocation.** This skill is `/skill:modernize-preflight`. Pi advertises it by name and description; when the task matches, read this file (`SKILL.md`) and follow it. The user can also run `/skill:modernize-preflight <args>`.
**Package files.** The scripts and assets of this package live at `$CODE_MODERNIZATION_ROOT` (the `code-modernization` extension exports it; when it is empty, it is the parent directory of this skill's folder). Run them from the workspace with `python3 "$CODE_MODERNIZATION_ROOT/scripts/<script>.py" …`.
**Arguments.** `<system> [target-stack] [--source <path>]`
Bound as: `$system`, `$target_stack`.
**Argument source.** The arguments arrive in the user's message (the text after the skill name, or a sentence naming the system). When one is missing: ask once with `ask_user`, or infer it from `analysis/` and state the assumption in one line. Never guess silently.

Check whether this environment can analyze — and eventually modernize — the
system `$system`, and tell the user exactly what to fix before the other
steps run into it. Modernization runs fail late and confusingly when this is
skipped: metrics silently degrade without analysis tools, tests can't run
without a build toolchain, and dependency maps come out wrong when half the
source isn't in the tree.

Run every check even when an early one fails — the point is one complete
readiness report, not the first error.

Every step of this product writes only to `analysis/$system/` and `modernized/`, and never edits the legacy
source under `legacy/$system/`.

## Where the code lives

The code is `legacy/$system`: a copy, or a symlink to where it really lives (how a large repository stays
put). Nothing is ever copied for you.

- If the arguments carry `--source <path>` (a directory, absolute or relative), check that it exists and is
  not the filesystem root or the user's home directory, then, only if `legacy/$system` does not exist yet, create
  the link: `mkdir -p legacy && ln -s <absolute path> legacy/$system` (on Windows a junction: `cmd /c mklink /J
  legacy\$system <absolute path>`). If `legacy/$system` already exists and points elsewhere, say so and change
  nothing.
- Say where `legacy/$system` points (`readlink legacy/$system`, or "a directory in this workspace") in one line
  before you start.
- If `$target_stack` starts with `--`, it is a flag, not a stack.

Never modify anything under `legacy/$system`.

## Check 0 — Ask the human (these answers are not in the source)

The most expensive modernization mistakes are things a person who knows the
system answers in seconds. Ask **only** the five questions below — add none —
and accept "don't know" for any of them.

**Ask with the `ask_user` tool (a questionnaire), never in chat text.** It takes
at most four questions per call: ask 1–4 in one call and 5 in a second. Give
each question its own options, one of them "Don't know", and let the person
type an answer instead. Do not print the questions in your reply and do not
answer them yourself. While the questionnaire is open, run the other checks — none of
them needs the answers.

1. **Scope** — Is this code the complete system, or one slice of a larger
   codebase? If a slice: what *outside* it depends on code *inside* it, and is
   breaking those consumers acceptable? (Check 6 verifies the crossing from the
   source; the answer says whether it *matters*.)
2. **Build & test locally** — Can this environment restore, build, and run the
   tests? Roughly how long does the full CI pipeline take?
3. **Bespoke build infrastructure** — Is there organization-specific build or
   dependency machinery (an internal package feed, a code generator, a wrapper
   around the standard build tool) a newcomer would not guess? Where is it
   documented?
4. **Prior attempts** — Has anyone tried to modernize this before? What went wrong?
5. **Off limits** — Is anything in this code not allowed to change in this
   pass (a component another team owns, a frozen branch, generated code)?

Write each question in a section of `PREFLIGHT.md` called **Answers**, with the
person's answer **verbatim** under it — never paraphrase away a caveat. If a
question has no answer (the tool is unavailable, as in a headless run, or the
person skips it), write **an open item the human must fill in** under it. All
five always appear.

## Check 1 — Detect the stack

Fingerprint `legacy/$system` from file extensions and manifests: languages, build
system, deployment and config descriptors. Report what you found and the rough
file split.

## Check 2 — Analysis tooling

Check availability (`command -v`), version and what degrades without it:

| Tool | Used by | Without it |
|---|---|---|
| `scc` (or `cloc`) | assess | LOC and complexity fall back to `find` + `wc`; the COCOMO index gets coarser |
| `python3` (3.8 or newer; on Windows it may be `python` or `py -3`: use whichever runs Python 3 wherever a step says `python3`) | map, extract-rules, verify, report | the dependency scripts, the shard builder, the proof scripts and the HTML report can't run |
| `lizard` | assess --portfolio | complexity is estimated from decision-keyword counts |

Give the platform's install one-liner for anything missing.

## Check 3 — Build toolchain (prove it on THIS code, not just presence)

**3a — Read the build definition first.** Something already builds this system.
Find the CI or pipeline definition (`azure-pipelines.yml`, `Jenkinsfile`,
`.github/workflows/`, `.gitlab-ci.yml`, build JCL procs, a `Makefile`) and the
build configuration above or beside the source (`Directory.Build.props` and
`nuget.config`; a parent POM, `settings.xml` or `.mvn/`; a private-registry
`.npmrc` or `pip.conf`; a root `build/`, `eng/` or `scripts/`). It is the most
honest record of the pinned toolchain, where dependencies really come from and
what a naive build skips. Quote the pinned version and the dependency source,
and flag anything bespoke: a homegrown binary-resolution scheme is what a
transformation must not discover halfway through.

**3b — Smoke test, escalating.** Find the compiler or interpreter for the
detected stack (GnuCOBOL `cobc`, a JDK with Maven or Gradle, `cc`/`make`,
`dotnet`, ...), then prove it works on this code:

- **Level 1, any stack:** syntax-compile one representative file
  (`cobc -fsyntax-only`, `javac`, `gcc -fsyntax-only`). Catches missing
  copybooks and includes, dialect flags, fixed versus free format.
- **Level 2, any stack with a build system:** restore and build ONE whole small
  project the way 3a says CI does. A one-file compile misses private feeds,
  code generation, shared props and pinned SDKs — where large codebases hide
  their surprises.

A failed smoke test is the most valuable output of this step: report the
actual error and diagnose it (missing copybook or include path, missing dialect
flag, a dependency the standard feed cannot resolve). Level 2 being *impossible*
(no build system, a mainframe stack with no local runtime) is a fact, not a
failure: equivalence then falls back to recorded traces.

If `$target_stack` was given, prove it with a throwaway project, not a version
string: in a scratch directory outside `legacy/$system` (`mktemp -d`), create the
smallest project the stack allows, restore, build, run one passing test with its
real package manager and test framework, then delete it. A target that cannot
build here is a finding.

## Check 4 — Source completeness

The map is only as good as what is in the tree. Look for the stack's equivalents of:

- **Referenced-but-missing includes** — copybooks, headers, imports that resolve
  nowhere. Count them and list the top names.
- **Deployment and config descriptors** — JCL, CICS CSD, `web.xml` or route
  configs, cron and scheduler definitions. Without them, entry points and the
  code-to-storage join are guesswork.
- **Data definitions** — DDL, schemas, record layouts, ORM mappings.
- **Binary-only artifacts** — load modules, jars, DLLs with no source. Flag them now.

## Check 5 — Optional context

- **Production telemetry** — is an APM MCP server connected, or are batch logs
  and runtime exports available? (Enables the runtime overlay in assess.)
- **Version control** — is `legacy/$system` under git with real history? (Change
  frequency sharpens risk ranking.)

## Check 6 — Scope boundary (is `$system` the whole world, or a slice?)

Every downstream step assumes `legacy/$system` *is* the system. When it is one
directory inside a larger repository — a monorepo module, one solution folder, a
subsystem sharing includes with siblings — that assumption is the most dangerous
in the run, and nothing else checks it. Resolve any symlink, then look for a
repository, solution or reactor root above `legacy/$system`, and for manifests or
includes inside it that reach outside. If either is true, report both directions:

- **Outbound** — things inside that depend on source outside (project or module
  references, shared includes, a parent build file). The map and the delta
  catalog only see what is under `legacy/$system`, so each one is a dependency they will
  silently miss. List them.
- **Inbound** — things outside that depend on things inside: the **blast
  radius**. An in-place migration of a node with outside consumers breaks each of
  them. Grep the sibling manifests for references into `legacy/$system`, list the nodes
  they use, and say plainly that each needs an explicit decision *before* any
  in-place change: keep it buildable for old and new consumers during the
  transition, widen the scope to include the consumers, or schedule the break.

If `$system` is a standalone repository, one line saying so is the whole check.

## Check 7 — Is the source protected from edits?

Every step is written never to edit `legacy/$system`, but that is only a convention until something enforces it.
This check is **read-only**: never edit a permission file and never suggest loosening a rule.

Pi keeps its settings at user level, in the agent directory
(`~/.pi/agent`, unless `PI_AGENT_DIR` points elsewhere): `settings.json` holds them. Pi has no
path-based permission file of its own — a write rule is an **extension**, loaded from
`~/.pi/agent/extensions/` (or the project's `.pi/extensions/`).

Look for a rule that blocks writes under `legacy/`: an extension with a `tool_call` handler for
`write` and `edit` whose path list covers the tree (`legacy/**` or the absolute
`/absolute/path/to/legacy/**`). **If `legacy/$system` is a symlink, the rule must also cover the
link's real target** (`/absolute/path/to/target/**`): a path pattern matches the link's path, not its
target's. A rule that only blocks `read` does not count. Report only which file holds the rule and
the rule itself; a user extension can hold credentials, so quote nothing else.

Also check the session's tool set: `/tools` shows it. The `write` and `edit` tools must be active for
the steps to work, so their absence is not a protection either; the protection has to come from the
rule above. Report a missing rule first and say so plainly.

The status is ✅ or ⚠️, never ❌, and changes no step's verdict:

- **✅** — a matching write rule exists (for the link and its target, when it is a link). Name the file
  and the rule. If the rule is broader than `legacy/` (it covers the whole workspace), say that it also
  blocks `analysis/` and `modernized/`, where the steps write.
- **⚠️** — no matching rule, or the target of a symlink is not covered. Say so in one line, tell the
  person how to add one, and record it as an open item the human must fill in: this check never fails
  the step. Print this snippet for the user's `protected-paths` extension, adding the target's own
  pattern when `legacy/$system` is a symlink:

  ```ts
  const protectedPaths = ["legacy/**", "/absolute/path/to/target/**"];
  ```

  (pi ships an example of this shape — `protected-paths.ts` — in its extension examples.)

Say this on either status, so a green row is not read as a guarantee: such a rule covers the file
tools, not a script that opens the files itself. The hard guarantee is the operating system: a
read-only mount, or a sandbox that blocks shell writes.

## Report

Write `analysis/$system/PREFLIGHT.md`. **Lead with the Answers section and the
Check 6 finding** — downstream steps (`brief` above all) read those two.
Then a table, one row per check, status ✅ / ⚠️ / ❌, what was found and the fix
for anything not green, then a **Ready / Ready-with-gaps / Not ready** verdict per
step:

- `assess`, `map`, `extract-rules` — Checks 1–2 mostly green and few missing includes.
- `brief` — needs only the discovery artifacts (plus `DELTA_CATALOG.md` for a
  same-stack uplift); no tooling.
- `transform`, `reimagine` — also need Check 3 green for the **target** stack. A
  red legacy toolchain is Ready-with-gaps, not Not-ready: equivalence falls back
  to recorded traces instead of dual execution (normal for code with no local
  runtime).
- `harden` — Check 2 plus any stack-specific SAST tooling found.
- `uplift` — Check 3 green for the **target** version, plus, when `$target_stack`
  looks like a version bump: (a) is the **source** runtime also here? Both present
  means a true dual run; target-only means equivalence degrades to recorded
  outputs (say which). (b) Is the ecosystem's **migration tool** installed
  (`upgrade-assistant`, OpenRewrite, `pyupgrade`, `ng`)? Missing is
  Ready-with-gaps: the delta catalog is then derived from reading the code only. (c) Did Check 6
  find **inbound consumers**? That is Ready-with-gaps — no plan exists yet to
  record a decision in — but the gap that matters most: name the shared nodes and
  say `brief` must give each an explicit transition decision, and `uplift` will
  not migrate a shared node in place without one.

Print the table in the session too. End with the single most important fix if
anything is red, and the next step: `/skill:modernize-assess $system`.
