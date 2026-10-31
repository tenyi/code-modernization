# Changelog

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
