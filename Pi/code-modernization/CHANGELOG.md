# Changelog

## 2.1.0 — pi port

The package now targets pi. The procedure, the gates, the artifacts and the proof are the upstream
ones; the runtime mapping changed again.

- The package is a pi package: `package.json` with a `pi` manifest, `skills/` (13 Agent Skills),
  `agents/` (8 subagent definitions), `scripts/`, `assets/` and `extensions/`.
- The 13 skills are discovered by pi as Agent Skills and run as `/skill:<name>`; the arguments arrive
  in the message instead of on a command line. Each skill says where its package files live.
- pi has no subagent primitive and no questionnaire tool, so `extensions/code-modernization.ts`
  supplies the three pieces the procedures need:
  - `task`: one call is one specialist agent, running in its own pi process with an isolated context
    and the agent's own tool allowlist. Pi runs the calls of one response in parallel, which is how
    the fan-outs keep their shape.
  - `ask_user`: the questionnaire (one to four questions, two to four options each, free text
    allowed). In a headless run it fails cleanly and the skills fall back to their defaults.
  - the two hooks: x-ray notes after a `read`, and the progress line with the one next step on every
    user prompt and at session start.
- The extension exports `$CODE_MODERNIZATION_ROOT`, so the skills reach `scripts/` and `assets/`
  without a hard-coded path.
- The subagents moved to the pi agent frontmatter contract (`name`, `description`, `tools`), with
  pi's native tool names (`find` replaces `glob`).
- Telemetry stays removed. This package sends nothing anywhere.

## 2.0.0 — MiniMax Code port

The plugin now targets MiniMax Code. The procedure, the gates, the artifacts and the proof are the
upstream ones; the runtime mapping changed.

- 13 slash commands became 13 Skills under `skills/`, loaded with the `skill` tool as
  `code-modernization:<name>`. Arguments arrive in the message instead of on a command line.
- `AskUserQuestion` became the `ask_user` questionnaire tool.
- The eight specialist subagents moved to `agents/` with the MiniMax subagent frontmatter contract
  and lowercase native tool names.
- The scripted `Workflow` fan-outs (rule mining, portfolio survey, delta catalog, uplift migration,
  service scaffolding, security scan) are now procedure inside the skills: the agent starts the
  subagents with `task`, in batches of at most eight, and merges their JSON results the way the
  workflows merged them.
- The live TUI pane, the review deck and the sign-off dialog are gone — MiniMax Code has no
  equivalent. The HTML report, the interactive map, the `ask_user` pop-ups and two hooks replace them:
  - `PostToolUse` on `read`: x-ray notes about the file that was just read, lifted from the analysis.
  - `UserPromptSubmit` and `SessionStart`: the progress line and the one next step.
- Telemetry was removed. This plugin sends nothing anywhere.
- `scripts/` kept the upstream Python tools and gained `xray.py` and `status.py` for the hooks.
- Package layout follows the MiniMax Plugin V1 format: `.minimax-plugin/plugin.json`, `skills/`,
  `agents/`, `hooks/`, `scripts/`, `assets/`.

## 1.0.0 — Upstream

The original Claude Code plugin release: the assessment, the map, the rule cards, the approved brief,
the three build paths, the proof, the security scan and the one-page report.
