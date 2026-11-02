#!/usr/bin/env python3
"""Check that the skill instructions stay runnable on every platform Antigravity runs on.

The package ships one toolkit for macOS, Linux and Windows. The runtime's shell follows the
operating system (bash on macOS and Linux, PowerShell on Windows), so a skill that hard-codes
one shell's commands fails on the other two. Five things break that:

  1. A ${SKILL_ROOT} or ${PLUGIN_ROOT} placeholder in prose. The skills name the root <plugin>
     instead, and the agent resolves it from the absolute path the skill tool reports.
  2. A tilde inside a quoted path. PowerShell expands ~ in a bare path but not inside a
     double-quoted string, so "~/.gemini/..." becomes a relative path with a literal ~.
  3. A bash heredoc (<<'EOF') or a bash process substitution (<(...)). Both are parse
     errors in PowerShell, so the whole command fails before it runs.
  4. A bash parameter expansion (${var:-default}). PowerShell reads it as a literal
     string, so the command runs with the wrong argument.
  5. A command that only one shell understands. Every such command has to be given in both
     forms, labelled POSIX and PowerShell/Windows, so the agent can pick the one that
     matches the shell it detected.

Run:  python tests/test_portability.py
Exit 0 when every check passes, 1 otherwise.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKILLS = os.path.join(ROOT, "skills")
AGENTS = os.path.join(ROOT, "agents")
HOOKS = os.path.join(ROOT, "hooks.json")
HOOKS_SUB = os.path.join(ROOT, "hooks", "hooks.json")

# Placeholders that must not appear in skill bodies
PLACEHOLDER = re.compile(r"\$\{PLUGIN_ROOT\}|\$\{SKILL_ROOT\}")
# A tilde path inside double quotes (fails in PowerShell)
QUOTED_TILDE = re.compile(r'"~[/\\]')
# A bash heredoc. `<<<` (the untrusted-content marker) is not a heredoc.
HEREDOC = re.compile(r"(?<!<)<<-?\s*['\"]?[A-Za-z_]")
# A bash process substitution
SUBSTITUTION = re.compile(
    r"<\(\s*(?:sed|cat|diff|sort|head|tail|awk|grep|wc|paste|comm|tee|printf|echo"
    r"|cut|tr|uniq|rev|tac|basename|dirname|realpath|readlink|find|ls)\b"
)
# A bash parameter expansion with a default value.
PARAM_DEFAULT = re.compile(r"\$\{[A-Za-z_][A-Za-z0-9_]*:-")
# The plugin-relative path a skill command points at.
PLUGIN_REF = re.compile(r"<plugin>(/[A-Za-z0-9._/-]+)")
# The preamble that tells the agent how to resolve <plugin>.
PREAMBLE_MARK = "Never put `~` inside a quoted path"
# The preamble that tells the agent how to pick a shell.
SHELL_MARK = ("macOS", "Linux", "Windows", "Detect")

# A command only bash understands.
POSIX_ONLY = (
    re.compile(r"\|\s*head\b"), re.compile(r"\|\s*tee\b"), re.compile(r"\bxargs\b"),
    re.compile(r"\breadlink\b"), re.compile(r"\bcommand\s+-v\b"),
    re.compile(r"\bls\s+-d\b"),
)
# A command only PowerShell understands.
POWERSHELL_ONLY = (
    re.compile(r"\bGet-ChildItem\b"), re.compile(r"\bSelect-Object\b"), re.compile(r"\bMeasure-Object\b"),
    re.compile(r"\bTee-Object\b"), re.compile(r"\bGet-Content\b"), re.compile(r"\bGet-Item\b"),
    re.compile(r"\bSet-Content\b"), re.compile(r"\bGet-Command\b"),
)
# The label each side carries.
POSIX_LABEL = re.compile(r"\*\*POSIX\*\*|\(POSIX\)|POSIX:")
POWERSHELL_LABEL = re.compile(r"\*\*PowerShell\*\*|\(PowerShell\)|PowerShell:")
WINDOWS_LABEL = re.compile(r"\*\*PowerShell\*\*|\(PowerShell\)|PowerShell:|\*\*Windows\*\*|\(Windows\)|Windows:")

SUPPORTED_EVENTS = {
    "PreToolUse", "PermissionRequest", "PostToolUse", "SessionStart", "SessionEnd",
    "UserPromptSubmit", "SubagentStart", "SubagentStop", "Stop", "PreCompact", "PostCompact",
    "PreInvocation", "PostInvocation"
}


def skill_files():
    if not os.path.isdir(SKILLS):
        return []
    out = []
    for name in sorted(os.listdir(SKILLS)):
        path = os.path.join(SKILLS, name, "SKILL.md")
        if os.path.isfile(path):
            out.append(path)
    return out


def agent_files():
    if not os.path.isdir(AGENTS):
        return []
    return [os.path.join(AGENTS, n) for n in sorted(os.listdir(AGENTS)) if n.endswith(".md")]


def backticked(paragraph):
    return re.findall(r"`([^`]+)`", paragraph)


def check_shell_pairing(path, text, problems):
    name = os.path.relpath(path, ROOT).replace(os.sep, "/")
    for lineno, line in enumerate(text.splitlines(), 1):
        snippets = backticked(line)
        posix = [s for s in snippets if any(p.search(s) for p in POSIX_ONLY)]
        shell = [s for s in snippets if any(p.search(s) for p in POWERSHELL_ONLY)]
        if not posix and not shell:
            continue
        if posix and not WINDOWS_LABEL.search(line):
            problems.append("%s:%d has a POSIX command but no Windows form on the same line: %s"
                            % (name, lineno, posix[0][:70]))
        if shell and not POSIX_LABEL.search(line):
            problems.append("%s:%d has a PowerShell command but no POSIX form on the same line: %s"
                            % (name, lineno, shell[0][:70]))


def check_skills(problems):
    files = skill_files()
    if not files:
        problems.append("no skills found under %s" % SKILLS)
        return
    for path in files:
        name = os.path.relpath(path, ROOT).replace(os.sep, "/")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        for lineno, line in enumerate(text.splitlines(), 1):
            if PLACEHOLDER.search(line):
                problems.append("%s:%d uses a placeholder: a Skill body gets no "
                                "substitution; name the root <plugin>" % (name, lineno))
            if QUOTED_TILDE.search(line):
                problems.append("%s:%d uses a quoted tilde path: %s" % (name, lineno, line.strip()[:110]))
            if HEREDOC.search(line):
                problems.append("%s:%d uses a bash heredoc: %s" % (name, lineno, line.strip()[:110]))
            if SUBSTITUTION.search(line):
                problems.append("%s:%d uses a bash process substitution: %s" % (name, lineno, line.strip()[:110]))
            if PARAM_DEFAULT.search(line):
                problems.append("%s:%d uses a bash parameter expansion: %s" % (name, lineno, line.strip()[:110]))
        refs = PLUGIN_REF.findall(text)
        for ref in refs:
            target = os.path.join(ROOT, ref.lstrip("/").replace("/", os.sep))
            if not os.path.isfile(target):
                problems.append("%s points at a file that is not in the package: <plugin>%s" % (name, ref))
        if refs and PREAMBLE_MARK not in text:
            problems.append("%s references <plugin> but does not say how to resolve it" % name)
        if not all(mark in text for mark in SHELL_MARK):
            problems.append("%s does not say how the shell is picked per platform "
                            "(macOS, Linux, Windows, Detect)" % name)
        check_shell_pairing(path, text, problems)


def check_agents(problems):
    for path in agent_files():
        name = os.path.relpath(path, ROOT).replace(os.sep, "/")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        for lineno, line in enumerate(text.splitlines(), 1):
            if HEREDOC.search(line):
                problems.append("%s:%d uses a bash heredoc: %s" % (name, lineno, line.strip()[:110]))
            if PARAM_DEFAULT.search(line):
                problems.append("%s:%d uses a bash parameter expansion: %s" % (name, lineno, line.strip()[:110]))


def check_hooks(path, problems):
    if not os.path.isfile(path):
        problems.append("%s is missing" % path)
        return
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except ValueError as err:
        problems.append("%s is not valid JSON: %s" % (path, err))
        return
    events = doc.get("hooks")
    if not isinstance(events, dict):
        problems.append("%s has no hooks object" % path)
        return
    for event, entries in events.items():
        if event not in SUPPORTED_EVENTS:
            problems.append("%s uses an unsupported event: %s" % (path, event))
        for entry in entries if isinstance(entries, list) else []:
            handlers = entry.get("hooks") if isinstance(entry, dict) else None
            for handler in handlers if isinstance(handlers, list) else []:
                if handler.get("type") != "command":
                    problems.append("%s has a non-command handler on %s" % (path, event))
                if not handler.get("command"):
                    problems.append("%s has an empty command on %s" % (path, event))
                timeout = handler.get("timeout", 5)
                if not isinstance(timeout, int) or not 1 <= timeout <= 10:
                    problems.append("%s has an out-of-range timeout on %s: %r" % (path, event, timeout))
                if not handler.get("commandWindows"):
                    problems.append("%s has no commandWindows on %s" % (path, event))


def check_manifest(problems):
    manifest = os.path.join(ROOT, "plugin.json")
    if not os.path.isfile(manifest):
        problems.append("plugin.json is missing")
        return
    try:
        with open(manifest, encoding="utf-8") as fh:
            doc = json.load(fh)
    except ValueError as err:
        problems.append("plugin.json is not valid JSON: %s" % err)
        return
    if not doc.get("name"):
        problems.append("plugin.json missing name field")
    if "disabled" not in doc:
        problems.append("plugin.json missing disabled field")


def main():
    problems = []
    check_skills(problems)
    check_agents(problems)
    check_hooks(HOOKS, problems)
    check_hooks(HOOKS_SUB, problems)
    check_manifest(problems)
    if problems:
        print("test_portability: %d problem(s)" % len(problems))
        for p in problems:
            print("  " + p)
        return 1
    print("test_portability: %d skills, %d agents checked; no placeholders, no bash-only syntax, "
          "every shell-specific command offers both a POSIX and a PowerShell form" % (len(skill_files()), len(agent_files())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
