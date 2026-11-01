#!/usr/bin/env python3
"""Render the modernization panels: the progress pane, the rule review deck and the sign-off card.

    python3 render_panel.py progress --system billing
    python3 render_panel.py review   --system billing [--scope flagged|p0|all]
    python3 render_panel.py signoff  --system billing
    python3 render_panel.py all      --system billing

Writes self-contained HTML into <workspace>/analysis/<system>/:

    PANEL.html        the live progress pane: where the work stands, the proof, the fleet
    REVIEW_DECK.html  the flagged rule cards, with what a person has already decided
    SIGNOFF.html      the proof verdict and the sign-off block

The upstream plugin draws the same three surfaces inside its terminal (a pane beside the
transcript, a review deck and a sign-off dialog). A plugin here cannot draw in the terminal, so
the panels are pages: the same facts, read from the same artifacts, written where the report is
written. Every page is a snapshot of the moment it was rendered.

The artifacts come from untrusted code, so nothing here trusts them: text travels as escaped
JSON, the page builds its DOM with textContent, and a Content-Security-Policy pins the only
script that may run. Standard library only.
"""
import argparse
import base64
import datetime
import hashlib
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # the package is read-only at runtime: never drop a __pycache__ into it

import build_report as br  # noqa: E402  (same folder: the artifact names and the parsers live there)
import fleet  # noqa: E402  (same folder: the agents this session has seen)

PANEL_NAMES = {"progress": "PANEL.html", "review": "REVIEW_DECK.html", "signoff": "SIGNOFF.html"}
PROOF_MARKS = {"PROVEN": "ok", "PARTLY PROVEN": "warn", "NOT PROVEN": "bad"}


def files_of(folder):
    try:
        return {e.name for e in os.scandir(folder) if e.is_file()}
    except OSError:
        return set()


def folders_of(folder):
    try:
        return sorted(e.name for e in os.scandir(folder) if e.is_dir(follow_symlinks=False))
    except OSError:
        return []


def collect(workspace, system):
    """Everything the three panels show, read from the artifacts that exist."""
    src = br.Source(workspace, system)
    adir, mdir = src.adir, src.mdir

    preflight = src.read(os.path.join(adir, "PREFLIGHT.md"), "PREFLIGHT.md")
    assessment = src.read(os.path.join(adir, "ASSESSMENT.md"), "ASSESSMENT.md")
    rules_text = src.read(os.path.join(adir, "BUSINESS_RULES.md"), "BUSINESS_RULES.md")
    brief = src.read(os.path.join(adir, "MODERNIZATION_BRIEF.md"), "MODERNIZATION_BRIEF.md")
    security = src.read(os.path.join(adir, "SECURITY_FINDINGS.md"), "SECURITY_FINDINGS.md")
    delta = src.read(os.path.join(adir, "DELTA_CATALOG.md"), "DELTA_CATALOG.md")

    reviews, _ = src.json(os.path.join(adir, "RULE_REVIEWS.json"), "RULE_REVIEWS.json")
    reviews = reviews.get("reviews") if isinstance(reviews, dict) else None
    reviews = reviews if isinstance(reviews, dict) else {}
    cards = [b for b in br.parse_rules(rules_text) if b["k"] == "rule"] if rules_text else []

    glance = {"rules": None, "security": None, "baseline": None, "topology": None, "equivalence": None, "proof": None}
    if cards:
        glance["rules"] = br.rule_facts(rules_text, cards, reviews)

    verification, seen = src.json(os.path.join(adir, "VERIFICATION.json"), "VERIFICATION.json")
    proof = br.proof_view(verification) if seen else None
    if proof:
        glance["proof"] = {"verdict": proof.get("verdict", ""), "headline": proof.get("headline", ""),
                            "counts": proof.get("counts", {}), "problems": proof.get("problems", [])[:6],
                            "modules": [{"name": m.get("name", ""), "verdict": m.get("verdict", "")} for m in proof.get("modules", [])[:40]]}
    elif seen:
        glance["proof"] = {"verdict": "NOT PROVEN", "headline": "VERIFICATION.json could not be used, so nothing is proven.",
                            "counts": {}, "problems": [], "modules": []}
    signoff = (proof or {}).get("signoff") or {}
    legacy = (proof or {}).get("legacy") or {}

    topo, _ = src.json(os.path.join(adir, "topology.json"), "topology.json")
    glance["topology"] = br.topology_facts(topo)

    mods = [os.path.join(mdir, system + s) for s in ("", "-uplifted", "-reimagined")]
    built = []
    for path in mods:
        for name in folders_of(path):
            built.append(name)
    done = {
        "preflight": preflight is not None,
        "assess": assessment is not None,
        "map": topo is not None or os.path.isfile(os.path.join(adir, "TOPOLOGY.html")),
        "rules": rules_text is not None,
        "brief": brief is not None,
        "build": any(br.nonempty_dir(p) for p in mods),
        "harden": security is not None,
    }
    glance["steps"] = [{"key": k, "label": label, "done": bool(done[k])} for k, label in br.STEPS]
    glance["next"] = br.next_step(system, done, glance)

    tracks = {"rewrite": [mods[0]], "same-stack uplift": [os.path.join(adir, "DELTA_CATALOG.md"), os.path.join(adir, "PLAYBOOK.md"), mods[1]],
              "reimagine": [os.path.join(adir, "AI_NATIVE_SPEC.md"), os.path.join(adir, "REIMAGINED_ARCHITECTURE.md"), mods[2]]}
    ranked = sorted(((br.newest(p), k) for k, p in tracks.items() if br.newest(p)), reverse=True)
    glance["track"] = {"label": ranked[0][1]} if ranked else None

    # The estate: what was built, and what the proof says about it.
    verdicts = {m["name"]: m["verdict"] for m in (glance["proof"] or {}).get("modules", [])}
    estate = []
    for name in built:
        estate.append({"name": name, "verdict": verdicts.get(name, ""), "state": verdicts.get(name, "") or "built"})
    for name, verdict in verdicts.items():
        if name not in [e["name"] for e in estate]:
            estate.append({"name": name, "verdict": verdict, "state": verdict})

    if not src.found and not built:
        return None  # nothing of this system on disk yet: there is no panel to draw

    # The rule cards, with what a person has already decided about them.
    deck = []
    for card in cards:
        review = reviews.get(card["id"])
        verdict = str(review.get("verdict", "")).strip() if isinstance(review, dict) else ""
        # The confidence is a badge in the deck, so it is cut from the body.
        body = re.sub(r"(?im)^[ \t>*-]*\**Confidence\**[ \t]*:.*\n?", "", card["body"]).strip()
        deck.append({"id": card["id"], "title": card["title"], "p": card["p"], "cat": card["cat"], "conf": card["conf"],
                     "cites": card["cites"], "defect": card["defect"], "body": body, "verdict": verdict})

    return {
        "system": system,
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "glance": glance,
        "stages": glance["steps"],
        "doneCount": sum(1 for s in glance["steps"] if s["done"]),
        "stageCount": len(glance["steps"]),
        "modules": estate,
        "moduleCount": len(built),
        "deck": deck,
        "deckStats": glance["rules"] or {},
        "reviews": reviews,
        "signoff": signoff,
        "legacy": legacy,
        "fleet": fleet.summary(fleet.read_state(workspace)),
        "notes": src.notes,
    }


def script_json(data):
    """JSON that can sit inside a <script> element: no <, > or & appears in it."""
    return json.dumps(data, ensure_ascii=True, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def render(data):
    """The page: the template with its data and its policy filled in."""
    with open(os.path.join(ASSETS, "panel-template.html"), encoding="utf-8") as fh:
        template = fh.read().replace("\r\n", "\n")
    app = re.search(r'<script id="app">(.*?)</script>', template, re.S).group(1)
    sha = lambda text: "'sha256-%s'" % base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode()  # noqa: E731
    policy = "default-src 'none'; script-src %s; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" % sha(app)
    fill = {"CSP": policy, "DATA": script_json(data)}
    return re.sub(r"@@(CSP|DATA)@@", lambda m: fill[m.group(1)], template)


def write_atomic(path, data):
    """Write `data` to a temp file beside `path`, then rename it over `path`."""
    folder = os.path.dirname(path)
    for p in (path, folder):
        if os.path.islink(p):
            return "refusing to write through a symbolic link: %s" % p
    try:
        os.makedirs(folder, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=".panel-", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            umask = os.umask(0)
            os.umask(umask)
            os.chmod(tmp, 0o666 & ~umask)
            os.replace(tmp, path)
        except BaseException:
            if os.path.lexists(tmp):
                os.unlink(tmp)
            raise
    except OSError as err:
        return "could not write %s (%s)" % (path, err.__class__.__name__)
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render the modernization panels for one system.")
    ap.add_argument("kind", choices=sorted(PANEL_NAMES) + ["all"], help="which panel to render")
    ap.add_argument("--system", required=True, help="the system's folder name under analysis/")
    ap.add_argument("--workspace", default=".", help="the project root holding analysis/ and modernized/")
    ap.add_argument("--scope", default="flagged", choices=["flagged", "p0", "all"], help="which rule cards the review deck shows")
    args = ap.parse_args(argv)

    if not args.system or args.system in (".", "..") or re.search(r"[\\/\x00]", args.system):
        print("render_panel.py: the system must be a folder name under analysis/, not a path", file=sys.stderr)
        return 2

    workspace = os.path.abspath(args.workspace)
    try:
        data = collect(workspace, args.system)
    except OSError as err:
        print("render_panel.py: %s" % err, file=sys.stderr)
        return 1
    if data is None:
        print("render_panel.py: nothing found for %r under %s (analysis/ or modernized/)" % (args.system, workspace), file=sys.stderr)
        return 1

    kinds = list(PANEL_NAMES) if args.kind == "all" else [args.kind]
    written = []
    for kind in kinds:
        page = dict(data)
        page["kind"] = kind
        page["scope"] = args.scope
        path = os.path.join(workspace, "analysis", args.system, PANEL_NAMES[kind])
        try:
            refused = write_atomic(path, render(page).encode("utf-8"))
        except OSError as err:
            refused = "could not write %s (%s)" % (path, err.__class__.__name__)
        if refused:
            print("render_panel.py: %s" % refused, file=sys.stderr)
            return 1
        written.append(path)

    for path in written:
        print("%s: %d KB" % (path, os.path.getsize(path) >> 10))
    return 0


if __name__ == "__main__":
    sys.exit(main())
