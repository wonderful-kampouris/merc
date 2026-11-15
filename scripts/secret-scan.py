#!/usr/bin/env python3
"""Repo secret scan (REQ-OPS-005). Exit 1 if anything that looks like a key is found.

usage: python3 -I scripts/secret-scan.py [--root DIR]
A line can opt out with the marker `secret-scan: allow` (use sparingly, for fixtures).
"""
import fnmatch, os, re, sys

RULES = [
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY")),
    ("aws-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("openai-anthropic-key", re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_\-]{20,}")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}")),
    ("slack-token", re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}")),
    ("google-key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")),
    ("url-credentials", re.compile(r"https?://[^/\s:@]+:[^/\s@]{6,}@")),
    ("assigned-secret", re.compile(
        r"(?i)\b[\w-]*(?:api[_-]?key|secret|token|password|passwd)[\w-]*[\"']?\s*[:=]\s*[\"']([A-Za-z0-9_\-+/=.]{20,})[\"']")),
]
SKIP_DIRS = {".git", "node_modules", "dist", ".cache", ".next", "__pycache__", ".venv", ".turbo", "coverage"}
SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".mp3", ".wav", ".mp4", ".woff", ".woff2",
            ".ttf", ".lock"}
SKIP_FILES = {"pnpm-lock.yaml", "package-lock.json", "yarn.lock"}
ALLOW = "secret-scan: allow"
PLACEHOLDER = re.compile(r"(?i)(x{6,}|<[^>]+>|\$\{|example|placeholder|changeme|dummy|redacted|your[_-])")


IGNORE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secret-scan-ignore.txt")


def load_ignores(path=IGNORE_FILE):
    if not os.path.exists(path):
        return []
    with open(path) as fh:
        return [l.strip() for l in fh if l.strip() and not l.startswith("#")]


def scan(root, ignores=()):
    hits = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f in SKIP_FILES or os.path.splitext(f)[1].lower() in SKIP_EXT:
                continue
            p = os.path.join(dirpath, f)
            if any(fnmatch.fnmatch(os.path.relpath(p, root), g) for g in ignores):
                continue
            try:
                if os.path.getsize(p) > 2_000_000:
                    continue
                with open(p, encoding="utf-8", errors="strict") as fh:
                    lines = fh.readlines()
            except (UnicodeDecodeError, OSError):
                continue
            for n, line in enumerate(lines, 1):
                if ALLOW in line:
                    continue
                for name, rx in RULES:
                    m = rx.search(line)
                    if m and not PLACEHOLDER.search(m.group(0)):
                        hits.append((os.path.relpath(p, root), n, name, mask(m.group(0))))
    return hits


def mask(s):
    return s[:4] + "…" + f"({len(s)} chars)"


def main(argv):
    root = argv[argv.index("--root") + 1] if "--root" in argv else os.getcwd()
    hits = scan(root, load_ignores())
    for path, n, rule, m in hits:
        print(f"{path}:{n}: {rule}: {m}")
    print(f"secret-scan: {len(hits)} finding(s) under {root}")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
