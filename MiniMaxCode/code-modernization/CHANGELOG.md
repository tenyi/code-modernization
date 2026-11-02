# Changelog

## 2.2.0 — MiniMax Code port, one package for macOS, Linux and Windows

The 2.1.0 port assumed the runtime's shell is PowerShell. It is not: mcode runs bash on
macOS and Linux, so the skills that named PowerShell commands failed there. One package now
runs on all three platforms.

- **Every shell-specific command ships in both forms.** The affected commands (listing a
  folder, counting lines, the side-by-side diff, the test output capture, the symlink,
  `readlink`, tool availability) are labelled **POSIX** (macOS and Linux) and **PowerShell**
  (Windows) on the same line, and each skill's preamble tells the agent to detect the shell
  once (`uname -s` or `$PSVersionTable.PSVersion`) and use the matching form.
- **The side-by-side diff needs no shell at all.** The range is read with the `read` tool
  (`offset`, `limit`), which is the same everywhere; the shell forms are only an alternative.
- **`tests/test_portability.py` now enforces it.** A command that appears in one shell's form
  only fails the tree, as do a `${PLUGIN_ROOT}` placeholder, a tilde path, bash-only syntax and
  a `<plugin>` reference that points at nothing.
- `tools/port_skills_crossplatform.py` in the repository root applies the rewrite and can
  check the tree (`--check`).

## 2.1.0 — MiniMax Code port, runtime fixes

The 2.0.0 port was complete on paper but not runnable on this runtime. These are the fixes.

- **A Skill body gets no placeholder substitution.** `${PLUGIN_ROOT}` is replaced in a
  subagent's system prompt and in a Hook command, never in a Skill body, so every
  `python3 "${PLUGIN_ROOT}/scripts/..."` in the skills opened a path that did not exist.
  The skills now name the plugin root `<plugin>` and say how to resolve it, and
  `tests/test_portability.py` fails the tree if a placeholder comes back.
- **The skills run on PowerShell.** Upstream assumed bash: a heredoc that rendered the
  topology map, a process substitution in the side-by-side diff, a `${scope:-flagged}`
  default and a `tee` that PowerShell has no command for. The topology render moved into
  `scripts/render_topology.py`, the rest got their PowerShell equivalents, and the POSIX
  form is kept in parentheses where the two differ.
- **`scripts/render_topology.py`** is back: the map is rendered by a script that finds the
  template next to itself, so it needs no path to the plugin.
- **The three hook scripts tolerate a UTF-8 BOM.** A Windows shell that pipes JSON into a
  script adds one, and the scripts swallow their exceptions, so the hooks would have gone
  silently dead instead of failing loudly. They now read stdin as `utf-8-sig`.

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
