"""Unit tests for scripts/secret-scan.py. Run: python3 -I -m unittest discover -s scripts/test"""
import importlib.util, os, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("secret_scan", os.path.join(HERE, "..", "secret-scan.py"))
ss = importlib.util.module_from_spec(spec); spec.loader.exec_module(ss)

# Fixtures are assembled at runtime so this file itself never matches the scanner.
FAKE_AWS = "AKIA" + "ABCDEFGHIJKLMNOP"
FAKE_SK = "sk-" + "ant-" + "a1b2c3d4e5f6g7h8i9j0k1l2"
FAKE_ASSIGN = 'FIRECRAWL_API_KEY = "' + "fc0123456789abcdef0123456789" + '"'


class SecretScan(unittest.TestCase):
    def scan_text(self, text, name="f.ts"):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, name), "w") as fh:
                fh.write(text)
            return ss.scan(d)

    def test_detects_keys(self):
        for t in (FAKE_AWS, FAKE_SK, FAKE_ASSIGN, "-----BEGIN " + "RSA PRIVATE KEY-----"):
            self.assertTrue(self.scan_text(t + "\n"), t[:8])

    def test_clean_code_passes(self):
        ok = 'const key = await context.secrets.get("FIRECRAWL_API_KEY");\nconst token = "<token>";\n'
        self.assertEqual(self.scan_text(ok), [])

    def test_allow_marker_and_skips(self):
        self.assertEqual(self.scan_text(FAKE_AWS + "  # secret-scan: allow\n"), [])
        self.assertEqual(self.scan_text(FAKE_AWS + "\n", name="pnpm-lock.yaml"), [])

    def test_output_is_masked(self):
        hit = self.scan_text(FAKE_SK + "\n")[0]
        self.assertNotIn(FAKE_SK, hit[3])

    def test_skips_node_modules(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "node_modules"))
            with open(os.path.join(d, "node_modules", "x.js"), "w") as fh:
                fh.write(FAKE_AWS)
            self.assertEqual(ss.scan(d), [])

    def test_ignore_globs(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "spikes", "s5", "raw"))
            with open(os.path.join(d, "spikes", "s5", "raw", "page.html"), "w") as fh:
                fh.write(FAKE_AWS)
            self.assertEqual(ss.scan(d, ss.load_ignores()), [])
            self.assertTrue(ss.scan(d))


if __name__ == "__main__":
    unittest.main()
