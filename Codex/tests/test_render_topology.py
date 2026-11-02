import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'code-modernization' / 'scripts' / 'render_topology.py'


class TopologyRenderTests(unittest.TestCase):
    def test_unicode_path_and_untrusted_script_data(self):
        with tempfile.TemporaryDirectory(prefix='modernize 測試 ') as folder:
            out = Path(folder)
            (out / 'topology.json').write_text(json.dumps({'name': '中文 </script><script>alert(1)</script>'}, ensure_ascii=False), encoding='utf-8')
            result = subprocess.run([sys.executable, str(SCRIPT), str(out)], capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(result.returncode, 0, result.stderr)
            html = (out / 'TOPOLOGY.html').read_text(encoding='utf-8')
            self.assertIn(r'\u003c/script\u003e', html)
            self.assertNotIn('中文 </script><script>alert(1)</script>', html)
            self.assertNotIn('/*__TOPOLOGY_DATA__*/ null', html)

    def test_missing_input_fails_without_creating_viewer(self):
        with tempfile.TemporaryDirectory() as folder:
            result = subprocess.run([sys.executable, str(SCRIPT), folder], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((Path(folder) / 'TOPOLOGY.html').exists())


if __name__ == '__main__':
    unittest.main()
