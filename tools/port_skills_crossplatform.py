#!/usr/bin/env python3
"""Make the MiniMax Code port shell-neutral: one package for macOS, Linux and Windows.

The 2.1.0 port was written for one platform at a time. The runtime's shell follows the
operating system (bash on macOS and Linux, PowerShell on Windows), so a skill that
hard-codes one shell's commands fails on the other two.

This script rewrites the affected spots so that every OS-specific command is given in
both forms, labelled **POSIX** and **PowerShell**, and so the preamble in every skill
tells the agent to detect the shell once and pick the matching form.

It is idempotent: a second run reports "already applied" and changes nothing.

Run:  python tools/port_skills_crossplatform.py [--check]
Exit 0 when every rewrite is in place, 1 when one is missing.
"""
import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKILLS = os.path.join(ROOT, "MiniMaxCode", "code-modernization", "skills")

# The preamble every skill carries. The plugin root is <plugin> (a Skill body gets no
# placeholder substitution), and the shell is detected once.
OLD_PREAMBLE = (
    "**Plugin directory.** `<plugin>` is the installed plugin root, the directory that holds this skill's "
    "`skills/` folder. The `skill` tool reports this file's absolute path in its `Location:` line, so the "
    "plugin root is that path with `skills/<name>/SKILL.md` removed. Substitute that absolute path for "
    "`<plugin>` in every command below. Never put `~` inside a quoted command: PowerShell does not expand it "
    "and the script fails to open. **Shell.** This runtime runs PowerShell on Windows: commands below are "
    "PowerShell, and a POSIX equivalent is given in parentheses where the two differ."
)
NEW_PREAMBLE = (
    "**Plugin directory.** `<plugin>` is the installed plugin root, the directory that holds this skill's "
    "`skills/` folder. The `skill` tool reports this file's absolute path in its `Location:` line, so the "
    "plugin root is that path with `skills/<name>/SKILL.md` removed. Substitute that absolute path for "
    "`<plugin>` in every command below. Never put `~` inside a quoted path: bash expands it, PowerShell does "
    "not, so the file fails to open on Windows. **Shell.** This plugin runs on macOS, Linux and Windows. The "
    "runtime's shell follows the platform: bash on macOS and Linux, PowerShell on Windows. Detect it once, at "
    "the start (`uname -s` under bash, `$PSVersionTable.PSVersion` under PowerShell), and use the matching "
    "form of every command below. Where two forms are given they are labelled **POSIX** (macOS and Linux) and "
    "**PowerShell** (Windows). **Python.** Use `python3`; on Windows use `python` or `py -3` when `python3` is "
    "not on `PATH`."
)

# (skill directory, old text, new text). The old text must appear exactly once.
EDITS = [
    (
        "*",
        "(`readlink legacy/$system`, or `Get-Item legacy/$system | Select-Object -ExpandProperty Target` in PowerShell)",
        "(POSIX: `readlink legacy/$system`; PowerShell: `(Get-Item legacy/$system).Target`)",
    ),
    (
        "modernize-assess",
        "List the subdirectories first (`Get-ChildItem -Directory <parent-dir> | Select-Object -ExpandProperty Name` "
        "in PowerShell; `ls -d <parent-dir>/*/ | xargs -n1 basename` in bash), tell the",
        "List the subdirectories first (POSIX: `ls -d <parent-dir>/*/ | xargs -n1 basename`; PowerShell: "
        "`Get-ChildItem -Directory <parent-dir> | Select-Object -ExpandProperty Name`), tell the",
    ),
    (
        "modernize-assess",
        "Per system: SLOC and dominant language (`cloc --csv`, else `scc`, else `find` +\n"
        "`wc -l`; in PowerShell, `Get-ChildItem -Recurse -File legacy/$system | Measure-Object -Line`), file count,",
        "Per system: SLOC and dominant language (`cloc --csv`, else `scc`, else POSIX: "
        "`find legacy/$system -type f -exec wc -l {} +`; PowerShell: "
        "`Get-ChildItem -Recurse -File legacy/$system | Measure-Object -Line`), file count,",
    ),
    (
        "modernize-assess",
        "Run `scc legacy/$system` and `scc --by-file -s complexity legacy/$system | Select-Object -First 25` "
        "(PowerShell; `| head -25` in bash) (the most",
        "Run `scc legacy/$system` and `scc --by-file -s complexity legacy/$system | head -25` (POSIX) or "
        "`scc --by-file -s complexity legacy/$system | Select-Object -First 25` (PowerShell) (the most",
    ),
    (
        "modernize-assess",
        "without that, `find` + `wc -l` by extension (in PowerShell, "
        "`Get-ChildItem -Recurse -File -Include *.<ext> legacy/$system | Measure-Object -Line`) and rank",
        "without that, count the lines per extension yourself (POSIX: "
        "`find legacy/$system -type f -name '*.<ext>' -exec wc -l {} +`; PowerShell: "
        "`Get-ChildItem -Recurse -File -Include *.<ext> legacy/$system | Measure-Object -Line`) and rank",
    ),
    (
        "modernize-transform",
        "(`Get-Content <legacy file> | Select-Object -Skip <start-1> -First <count>` against the same range of the\n"
        "target file, in two columns).",
        "(read the same range out of both files with the `read` tool — `offset` and `limit`, the same on every "
        "platform — and put the legacy lines and the target lines next to each other in the table; POSIX: "
        "`sed -n '<start>,<end>p' <legacy file>`; PowerShell: "
        "`Get-Content <legacy file> | Select-Object -Skip <start-1> -First <count>`).",
    ),
    (
        "modernize-verify",
        "either way: `<test command> 2>&1 | Tee-Object -FilePath analysis/$system/equivalence/<suite>.test-output.txt` "
        "in PowerShell (in bash: `<test command> 2>&1 | tee analysis/$system/equivalence/<suite>.test-output.txt`).",
        "either way: `<test command> 2>&1 | tee analysis/$system/equivalence/<suite>.test-output.txt` (POSIX) or "
        "`<test command> 2>&1 | Tee-Object -FilePath analysis/$system/equivalence/<suite>.test-output.txt` "
        "(PowerShell).",
    ),
    (
        "modernize-preflight",
        "- Say where `legacy/$system` points (`readlink legacy/$system`, or \"a directory in this workspace\") in one line",
        "- Say where `legacy/$system` points (POSIX: `readlink legacy/$system`; PowerShell: "
        "`(Get-Item legacy/$system).Target`; or \"a directory in this workspace\") in one line",
    ),
    (
        "modernize-preflight",
        "Check availability (`command -v`), version and what degrades without it:",
        "Check availability (POSIX: `command -v <tool>`; PowerShell: `Get-Command <tool>`), version and what "
        "degrades without it:",
    ),
]


def skill_files():
    out = []
    for name in sorted(os.listdir(SKILLS)):
        path = os.path.join(SKILLS, name, "SKILL.md")
        if os.path.isfile(path):
            out.append((name, path))
    return out


def apply(check_only):
    problems = []
    changed = 0
    for name, path in skill_files():
        # newline="" keeps the line endings the file already has: the rewrite must not
        # turn a CRLF tree into an LF one (or the other way round).
        with open(path, encoding="utf-8", newline="") as fh:
            text = fh.read()

        if OLD_PREAMBLE in text:
            if check_only:
                problems.append("%s: the old single-platform preamble is still there" % name)
            else:
                text = text.replace(OLD_PREAMBLE, NEW_PREAMBLE)
                changed += 1
        elif NEW_PREAMBLE not in text:
            problems.append("%s: no preamble at all" % name)

        for skill, old, new in EDITS:
            if skill not in ("*", name):
                continue
            if old in text:
                if check_only:
                    problems.append("%s: the rewrite is not applied: %s" % (name, old[:60]))
                else:
                    text = text.replace(old, new)
                    changed += 1
            elif new not in text and skill != "*":
                # A skill that never had this line (and never needs it) is fine; a skill
                # that should have it and does not is not.
                problems.append("%s: neither the old nor the new text was found: %s" % (name, old[:60]))

        if not check_only:
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(text)

    if problems:
        print("port_skills_crossplatform: %d problem(s)" % len(problems))
        for p in problems:
            print("  " + p)
        return 1
    if check_only:
        print("port_skills_crossplatform: every skill is shell-neutral")
    else:
        print("port_skills_crossplatform: applied %d rewrite(s)" % changed)
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="report what is missing, change nothing")
    args = ap.parse_args()
    if not os.path.isdir(SKILLS):
        print("port_skills_crossplatform: no skills under %s" % SKILLS, file=sys.stderr)
        return 1
    return apply(args.check)


if __name__ == "__main__":
    sys.exit(main())
