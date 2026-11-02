"""Render the topology viewer from the packaged template and untrusted JSON."""
import json
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python render_topology.py <analysis-directory>')
    out_dir = Path(sys.argv[1])
    template = Path(__file__).resolve().parent.parent / 'assets' / 'topology-viewer.html'
    text = template.read_text(encoding='utf-8')
    marker = '/*__TOPOLOGY_DATA__*/ null'
    if marker not in text:
        raise SystemExit(f'Injection marker not found in {template}')
    data = json.dumps(json.loads((out_dir / 'topology.json').read_text(encoding='utf-8')))
    # HTML 的 script 結束標籤即使出現在 JSON 字串內仍會被瀏覽器解析。
    data = data.replace('<', r'\u003c').replace('>', r'\u003e').replace('&', r'\u0026')
    output = out_dir / 'TOPOLOGY.html'
    output.write_text(text.replace(marker, '/*__TOPOLOGY_DATA__*/ ' + data), encoding='utf-8')
    print(f'wrote {output}')


if __name__ == '__main__':
    main()
