#!/usr/bin/env python3
"""Render the interactive topology map for one system.

    python3 render_topology.py <system> [--workspace DIR]

Reads <workspace>/analysis/<system>/topology.json and writes
<workspace>/analysis/<system>/TOPOLOGY.html, the self-contained viewer this
plugin ships in assets/topology-viewer.html. The template and the data are
found relative to this file, so the command needs no path to the plugin.

topology.json comes from analyzed source, so it is untrusted: names come from
file names and observations from code an agent read. The data lands in a
<script> block, which the HTML parser closes on the literal bytes "</script>"
whatever the JS string context, and json.dumps does not escape "<". Escape it
to kill the breakout.

Exit 0 on success, 1 when the system folder, the data or the template is
missing, 2 for a system name that is not a folder name. Standard library only.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(os.path.dirname(HERE), "assets", "topology-viewer.html")
MARKER = "/*__TOPOLOGY_DATA__*/ null"
DATA_NAME = "topology.json"
OUT_NAME = "TOPOLOGY.html"


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def render(data_dir):
    """Write the viewer for one analysis folder. Returns the path written."""
    data_path = os.path.join(data_dir, DATA_NAME)
    if not os.path.isfile(data_path):
        raise OSError("%s not found: build the map first (modernize-map)" % data_path)
    with open(TEMPLATE, encoding="utf-8") as fh:
        tpl = fh.read()
    if MARKER not in tpl:
        raise OSError("injection marker not found in %s" % TEMPLATE)
    data = json.dumps(read_json(data_path))
    data = data.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    out = os.path.join(data_dir, OUT_NAME)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(tpl.replace(MARKER, "/*__TOPOLOGY_DATA__*/ " + data))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render the interactive topology map for one system.")
    ap.add_argument("system", help="the system's folder name under analysis/")
    ap.add_argument("--workspace", default=".", help="the project root holding analysis/ (default: current folder)")
    args = ap.parse_args(argv)
    if not args.system or args.system in (".", "..") or os.sep in args.system or "/" in args.system:
        print("render_topology.py: the system must be a folder name under analysis/, not a path", file=sys.stderr)
        return 2
    if not os.path.isfile(TEMPLATE):
        print("render_topology.py: the viewer template is missing: %s" % TEMPLATE, file=sys.stderr)
        return 1
    data_dir = os.path.join(args.workspace, "analysis", args.system)
    try:
        out = render(data_dir)
    except OSError as err:
        print("render_topology.py: %s" % err, file=sys.stderr)
        return 1
    except ValueError as err:
        print("render_topology.py: %s is not valid JSON: %s" % (DATA_NAME, err), file=sys.stderr)
        return 1
    print("wrote %s" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
