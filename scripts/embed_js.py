#!/usr/bin/env python3
"""Embed reviewed JavaScript sources without invoking a not-yet-built qjsc."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUFFER_SOURCES = ("src/js/internal/errors.js", "src/js/internal/encoding.js", "src/js/node/buffer.js")


def generate(root=ROOT):
    source = "(() => {\n'use strict';\n" + "\n".join(
        (root / name).read_text(encoding="utf-8") for name in BUFFER_SOURCES) + "\n})()\n"
    lines = ["/* Generated from src/js; no runtime filesystem dependency. */",
             "static const char qjs_buffer_source[] ="]
    lines.extend(json.dumps(line, ensure_ascii=True) for line in source.splitlines(keepends=True))
    return "\n".join(lines) + ";\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    content = generate()
    if not args.output.exists() or args.output.read_text(encoding="utf-8") != content:
        with args.output.open("w", encoding="utf-8", newline="\n") as output:
            output.write(content)


if __name__ == "__main__":
    main()
