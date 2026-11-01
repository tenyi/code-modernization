#!/usr/bin/env python3
"""The fleet: the subagents this session has seen, kept from the runtime's own events.

    python3 fleet.py     # the hook's JSON arrives on stdin

The runtime reports when a subagent starts (`SubagentStart`), when it stops
(`SubagentStop`) and what each `task` call of the root agent did (`PostToolUse`). That is
what this file keeps, so the progress panel can show which agents are still running, what
they were last doing, and whether several of them failed the same way.

The upstream plugin builds the same view from its own function-hook events
(`hooks/fleet/fleet.ts`). The events differ, so the mapping is not one to one:

    upstream                         here
    ------------                     ----
    tool.call / turn.complete        SubagentStart / SubagentStop
    the tool a call made             the agent's last message (one line, cut)
    an error a tool returned         a failure-shaped last message, or a failed task call
    the fleet in plugin data         <workspace>/analysis/.fleet.json

One file, written atomically and trimmed on every write. Prints nothing and exits 0: a hook
must never break the turn, and a broken panel must never break the work.
"""
import json
import os
import re
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_NAME = ".fleet.json"
VERSION = 1
MAX_AGENTS = 200
MAX_CALLS = 200
MAX_ERRORS = 80
MAX_TEXT = 240
# A shared failure is called out once this many agents hit it. The bar rises with the fleet,
# so three of five is a pattern and three of five hundred is not.
SIGNATURE_THRESHOLD = 3
SIGNATURE_RATIO = 0.05
FAILURE_WORDS = re.compile(r"(?i)\b(error|failed|failure|exception|traceback|panic|fatal)\b")


def now():
    return time.time()


def one_line(text, limit=MAX_TEXT):
    """One short line: no newlines, no control characters, cut to a length."""
    out = re.sub(r"[\x00-\x1f\x7f]+", " ", str(text or ""))
    out = re.sub(r"\s+", " ", out).strip()
    return out[:limit]


def state_path(workspace):
    return os.path.join(workspace, "analysis", STATE_NAME)


def read_state(workspace):
    """The kept state, or an empty one. A malformed file is replaced, never trusted."""
    empty = {"version": VERSION, "updated": 0, "agents": [], "calls": [], "errors": []}
    try:
        with open(state_path(workspace), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return empty
    if not isinstance(data, dict) or data.get("version") != VERSION:
        return empty
    for key in ("agents", "calls", "errors"):
        if not isinstance(data.get(key), list):
            data[key] = []
    return data


def write_state(workspace, state):
    """Write the state beside the analysis folder, atomically. Returns why it refused, or None."""
    path = state_path(workspace)
    folder = os.path.dirname(path)
    try:
        os.makedirs(folder, exist_ok=True)
    except OSError as err:
        return "could not create %s (%s)" % (folder, err.__class__.__name__)
    try:
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=".fleet-", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(json.dumps(state, ensure_ascii=False).encode("utf-8"))
            os.replace(tmp, path)
        except BaseException:
            if os.path.lexists(tmp):
                os.unlink(tmp)
            raise
    except OSError as err:
        return "could not write %s (%s)" % (path, err.__class__.__name__)
    return None


def prune(state):
    """Keep the file small: the newest rows only, the totals still counted."""
    state["agents"] = state["agents"][-MAX_AGENTS:]
    state["calls"] = state["calls"][-MAX_CALLS:]
    state["errors"] = state["errors"][-MAX_ERRORS:]
    return state


def find_agent(state, agent_id):
    for row in state["agents"]:
        if row.get("id") == agent_id:
            return row
    return None


def note_start(state, payload, at):
    """A subagent starts: a row appears, running."""
    agent_id = one_line(payload.get("agent_id"), 120)
    if not agent_id:
        return
    row = find_agent(state, agent_id)
    if row is None:
        row = {"id": agent_id, "type": "", "start": at, "end": None, "state": "running", "last": "", "errors": 0}
        state["agents"].append(row)
    row["state"] = "running"
    row["end"] = None
    kind = one_line(payload.get("agent_type"), 80)
    if kind:
        row["type"] = kind


def note_stop(state, payload, at):
    """A subagent stops: the row is finished, and what it said last is kept."""
    agent_id = one_line(payload.get("agent_id"), 120)
    if not agent_id:
        return
    row = find_agent(state, agent_id)
    if row is None:
        row = {"id": agent_id, "type": one_line(payload.get("agent_type"), 80), "start": at, "end": at,
               "state": "done", "last": "", "errors": 0}
        state["agents"].append(row)
    row["end"] = at
    last = one_line(payload.get("last_assistant_message"))
    if last:
        row["last"] = last
    failed = bool(FAILURE_WORDS.search(last))
    row["state"] = "failed" if failed else "done"
    if failed:
        row["errors"] = int(row.get("errors", 0)) + 1
        state["errors"].append({"t": at, "agent": agent_id, "text": last})


def response_text(response):
    """The tool's answer, as one line of text."""
    if isinstance(response, str):
        return response
    if isinstance(response, dict):
        for key in ("error", "stderr", "message", "content", "result", "output", "text"):
            value = response.get(key)
            if isinstance(value, str) and value.strip():
                return value
            if isinstance(value, list) and value:
                parts = [v.get("text", "") if isinstance(v, dict) else str(v) for v in value]
                text = " ".join(p for p in parts if p)
                if text.strip():
                    return text
        return ""
    if response is None:
        return ""
    return str(response)


def note_call(state, payload, at):
    """The root agent's own `task` call: which specialist it started, and how it went."""
    tool_input = payload.get("tool_input")
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    agent = one_line(tool_input.get("agent_name"), 120)
    subject = one_line(tool_input.get("description"), 160)
    response = payload.get("tool_response")
    text = response_text(response)
    failed = bool(payload.get("is_error")) or bool(FAILURE_WORDS.search(text[:200]))
    state["calls"].append({"t": at, "agent": agent, "subject": subject, "ok": not failed})
    if failed:
        state["errors"].append({"t": at, "agent": agent, "text": one_line(text) or "the task call failed"})


def signature_of(text):
    """The shape of a failure, with the noisy parts removed, so two agents that hit the
    same bug are recognised as one incident."""
    out = one_line(text, 400).lower()
    out = re.sub(r"(/[\w.\-]+)+", " <path> ", out)
    out = re.sub(r"\b\d+\b", " <n> ", out)
    out = re.sub(r"[0-9a-f]{8,}", " <hex> ", out)
    out = re.sub(r"\s+", " ", out).strip()
    return out[:160]


def summary(state, at=None):
    """What the panel shows: the agents, their state, and the failures they share."""
    at = at if at is not None else now()
    agents = []
    for row in state.get("agents", []):
        if not isinstance(row, dict):
            continue
        end = row.get("end")
        agents.append({
            "id": one_line(row.get("id"), 120),
            "type": one_line(row.get("type"), 80),
            "state": row.get("state") if row.get("state") in ("running", "done", "failed") else "done",
            "age": max(0, int((at if not end else end) - (row.get("start") or at))),
            "since": max(0, int(at - (row.get("start") or at))),
            "last": one_line(row.get("last"), MAX_TEXT),
            "errors": int(row.get("errors", 0) or 0),
        })
    running = [a for a in agents if a["state"] == "running"]
    failed = [a for a in agents if a["state"] == "failed"]
    seen = len(agents)

    groups = {}
    for item in state.get("errors", []):
        if not isinstance(item, dict):
            continue
        text = one_line(item.get("text"))
        if not text:
            continue
        key = signature_of(text)
        group = groups.setdefault(key, {"text": text, "agents": [], "first": item.get("t") or at, "last": item.get("t") or at})
        agent = one_line(item.get("agent"), 120)
        if agent and agent not in group["agents"]:
            group["agents"].append(agent)
        group["first"] = min(group["first"], item.get("t") or at)
        group["last"] = max(group["last"], item.get("t") or at)
    threshold = max(SIGNATURE_THRESHOLD, int(seen * SIGNATURE_RATIO + 0.999))
    signatures = [{"text": g["text"], "agents": g["agents"], "count": len(g["agents"]),
                   "first": g["first"], "last": g["last"], "shared": len(g["agents"]) >= threshold}
                  for g in groups.values() if len(g["agents"]) > 1]
    signatures.sort(key=lambda s: (-s["count"], -s["last"]))

    calls = [c for c in state.get("calls", []) if isinstance(c, dict)]
    return {
        "agents": agents,
        "running": len(running),
        "done": len(agents) - len(running),
        "failed": len(failed),
        "seen": seen,
        "calls": len(calls),
        "failedCalls": sum(1 for c in calls if not c.get("ok", True)),
        "threshold": threshold,
        "signatures": signatures[:8],
        "updated": state.get("updated") or 0,
    }


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}

    workspace = payload.get("cwd") or os.environ.get("MINIMAX_PROJECT_DIR") or os.getcwd()
    if not isinstance(workspace, str) or not workspace:
        return 0
    workspace = os.path.abspath(workspace)

    event = payload.get("hook_event_name")
    state = read_state(workspace)
    at = now()
    if event == "SubagentStart":
        note_start(state, payload, at)
    elif event == "SubagentStop":
        note_stop(state, payload, at)
    elif event == "PostToolUse":
        if payload.get("tool_name") in ("task", "Task"):
            note_call(state, payload, at)
        else:
            return 0
    else:
        return 0

    state["updated"] = at
    prune(state)
    write_state(workspace, state)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # a hook must never break the turn
        sys.exit(0)
