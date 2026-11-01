#!/usr/bin/env python3
"""Hook (UserPromptSubmit): where the modernization stands, and the one step to take next.

    python3 status.py      # the hook's JSON arrives on stdin

Prints one JSON object for the runtime: {"additionalContext": "..."}. Prints nothing and exits 0
when the workspace holds no modernization to report. Standard library only; never fails the turn.

The artifacts are written by agents that read untrusted code, so every name, title and count that
comes out of them is treated as data: it is cut to one short plain line, and the note says so.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build_report as br  # noqa: E402  (same folder; the artifact names and the parsers live there)

ANALYSIS_DIR = "analysis"
MODERNIZED_DIR = "modernized"
MAX_SYSTEMS = 4
MAX_CHARS = 900

TRACK_LABELS = {"rewrite": "rewrite", "uplift": "same-stack uplift", "reimagine": "rebuild"}


def plain(text, limit=120):
    """One short line of plain text: no markdown, no newlines, nothing a value could forge."""
    out = re.sub(r"\s+", " ", str(text or "")).strip()
    return out[:limit]


def read_text(path, limit=400000):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read(limit)
    except OSError:
        return None


def read_json(path):
    text = read_text(path)
    if text is None:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def systems_of(workspace):
    """The folders under analysis/ that hold a modernization."""
    root = os.path.join(workspace, ANALYSIS_DIR)
    try:
        names = sorted(e.name for e in os.scandir(root) if e.is_dir())
    except OSError:
        return []
    out = []
    for name in names:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", name):
            continue
        folder = os.path.join(root, name)
        try:
            if not any(e.is_file() for e in os.scandir(folder)):
                continue
        except OSError:
            continue
        out.append(name)
    return out


def done_of(workspace, system):
    """Which stages have produced their artifact, the way the report counts them."""
    adir = os.path.join(workspace, ANALYSIS_DIR, system)
    names = set()
    try:
        names = {e.name for e in os.scandir(adir) if e.is_file()}
    except OSError:
        pass
    mmd = {n for n in names if n.endswith(".mmd")} - {"ARCHITECTURE.mmd"}
    mods = []
    for suffix in ("", "-uplifted", "-reimagined"):
        base = os.path.join(workspace, MODERNIZED_DIR, system + suffix)
        try:
            mods.append(any(e.is_dir(follow_symlinks=False) for e in os.scandir(base)))
        except OSError:
            mods.append(False)
    return {
        "preflight": "PREFLIGHT.md" in names,
        "assess": "ASSESSMENT.md" in names,
        "map": "topology.json" in names or "TOPOLOGY.html" in names or bool(mmd),
        "rules": "BUSINESS_RULES.md" in names,
        "brief": "MODERNIZATION_BRIEF.md" in names,
        "build": any(mods),
        "harden": "SECURITY_FINDINGS.md" in names,
    }


def glance_of(workspace, system):
    """The two facts the next step turns on: rules that a person still has to look at, and the proof."""
    adir = os.path.join(workspace, ANALYSIS_DIR, system)
    glance = {"rules": None, "proof": None}
    text = read_text(os.path.join(adir, "BUSINESS_RULES.md"))
    if text:
        cards = [b for b in br.parse_rules(text) if b["k"] == "rule"]
        if cards:
            reviews = read_json(os.path.join(adir, "RULE_REVIEWS.json"))
            reviews = reviews.get("reviews") if isinstance(reviews, dict) else None
            glance["rules"] = br.rule_facts(text, cards, reviews if isinstance(reviews, dict) else None)
    verification = read_json(os.path.join(adir, "VERIFICATION.json"))
    if verification is not None:
        view = br.proof_view(verification)
        if view:
            glance["proof"] = {"verdict": view.get("verdict", "")}
    return glance


def brief_state(workspace, system):
    """`approved` once a person signed the brief's approval block, else `waiting`."""
    text = read_text(os.path.join(workspace, ANALYSIS_DIR, system, "MODERNIZATION_BRIEF.md"))
    if not text:
        return None
    for line in text.split("\n"):
        m = re.match(r"^\s*Approved by\s*:\s*(.*)$", line, re.I)
        if m:
            who = m.group(1).strip()
            who = re.sub(r"^[*_`]+|[*_`]+$", "", who).strip()
            if who and set(who) != {"_"}:
                return "approved"
            return "waiting"
    return "waiting"


def track_of(workspace, system):
    """The track the newest artifact belongs to."""
    adir = os.path.join(workspace, ANALYSIS_DIR, system)
    tracks = {
        "rewrite": [os.path.join(workspace, MODERNIZED_DIR, system)],
        "uplift": [os.path.join(adir, "DELTA_CATALOG.md"), os.path.join(adir, "PLAYBOOK.md"),
                   os.path.join(workspace, MODERNIZED_DIR, system + "-uplifted")],
        "reimagine": [os.path.join(adir, "AI_NATIVE_SPEC.md"), os.path.join(adir, "REIMAGINED_ARCHITECTURE.md"),
                      os.path.join(workspace, MODERNIZED_DIR, system + "-reimagined")],
    }
    ranked = sorted(((br.newest(p), k) for k, p in tracks.items() if br.newest(p)), reverse=True)
    return ranked[0][1] if ranked else "rewrite"


def modules_of(workspace, system):
    """How many service or module folders were built."""
    count = 0
    for suffix in ("", "-uplifted", "-reimagined"):
        base = os.path.join(workspace, MODERNIZED_DIR, system + suffix)
        try:
            count += sum(1 for e in os.scandir(base) if e.is_dir(follow_symlinks=False))
        except OSError:
            continue
    return count


def line_of(workspace, system):
    """One line: where this modernization stands."""
    done = done_of(workspace, system)
    glance = glance_of(workspace, system)
    track = track_of(workspace, system)
    parts = ["code-modernization", system, TRACK_LABELS.get(track, track)]

    countable = [k for k in ("preflight", "assess", "map", "rules", "brief")]
    finished = sum(1 for k in countable if done[k])
    parts.append("analysis %d/%d" % (finished, len(countable)))

    state = brief_state(workspace, system)
    if state is not None:
        parts.append("brief approved" if state == "approved" else "brief waiting for approval")

    built = modules_of(workspace, system)
    if built > 0:
        parts.append("%d module%s built" % (built, "" if built == 1 else "s"))

    rules = glance.get("rules") or {}
    flagged = rules.get("defects") or 0
    reviews = rules.get("reviews") or {}
    if flagged or reviews:
        parts.append("%d rule%s need a person's eye" % (flagged, "" if flagged == 1 else "s"))

    proof = glance.get("proof") or {}
    if proof.get("verdict"):
        parts.append("proof %s" % plain(proof["verdict"], 24))

    nxt = br.next_step(system, done, glance)
    steps = [" · ".join(parts)]

    if nxt:
        command = plain(nxt.get("command", ""), 120)
        steps.append("Next step: %s — %s" % (command, plain(nxt.get("why", ""), 160)))

    report = os.path.join(workspace, ANALYSIS_DIR, system, "REPORT.html")
    if os.path.isfile(report):
        steps.append("Report: %s/%s/REPORT.html" % (ANALYSIS_DIR, system))

    return "\n".join(steps)


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    workspace_paths = payload.get("workspacePaths")
    workspace = (
        (workspace_paths[0] if isinstance(workspace_paths, list) and workspace_paths else None)
        or payload.get("cwd")
        or os.environ.get("WORKSPACE")
        or os.getcwd()
    )
    if not isinstance(workspace, str) or not workspace:
        return 0
    workspace = os.path.abspath(workspace)

    systems = systems_of(workspace)
    if not systems:
        return 0

    prompt = payload.get("prompt") if isinstance(payload.get("prompt"), str) else ""
    named = [s for s in systems if s and s in prompt]
    chosen = named[0] if named else (systems[0] if len(systems) == 1 else None)

    if chosen is None:
        lines = ["code-modernization: %d system%s under analysis/." % (len(systems), "" if len(systems) == 1 else "s")]
        for name in systems[:MAX_SYSTEMS]:
            lines.append("- %s" % line_of(workspace, name).splitlines()[0])
        text = "\n".join(lines)
    else:
        text = line_of(workspace, chosen)

    text = text[:MAX_CHARS]
    event = payload.get("hook_event_name")
    if event == "SessionStart":
        out = {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text}}
    else:
        out = {"additionalContext": text}
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # a hook must never break the turn
        sys.exit(0)
