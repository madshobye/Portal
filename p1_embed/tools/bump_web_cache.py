#!/usr/bin/env python3
import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "web"
VERSION_FILE = WEB_DIR / "web-version.js"
VERSION_PATTERN = re.compile(r'WEB_UI_VERSION\s*=\s*"([^"]+)"')


def read_current_version():
    match = VERSION_PATTERN.search(VERSION_FILE.read_text())
    if not match:
        raise SystemExit(f"Could not find WEB_UI_VERSION in {VERSION_FILE}")
    return match.group(1)


def web_files():
    yield VERSION_FILE
    yield WEB_DIR / "index.html"
    for path in sorted(WEB_DIR.glob("*.js")):
        if path == VERSION_FILE:
            continue
        yield path


def main():
    parser = argparse.ArgumentParser(description="Bump the XOBIT web cache version in one consistent pass.")
    parser.add_argument("version", help="Next version string, e.g. 0.1.87-ui754")
    parser.add_argument("--dry-run", action="store_true", help="Show files that would change without writing.")
    args = parser.parse_args()

    current = read_current_version()
    if args.version == current:
        print(f"web cache already at {current}")
        return 0

    changed = []
    for path in web_files():
        if not path.exists():
            continue
        text = path.read_text()
        if current not in text:
            continue
        changed.append(path)
        if not args.dry_run:
            path.write_text(text.replace(current, args.version))

    action = "would update" if args.dry_run else "updated"
    print(f"{action} web cache {current} -> {args.version}")
    for path in changed:
        print(path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
