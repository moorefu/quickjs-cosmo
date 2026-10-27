#!/usr/bin/env python3
"""Generate immutable runtime identity constants from the current input locks."""
import argparse
import json
from pathlib import Path

from node_contract import ROOT, read_json


def generate(root=ROOT):
    versions = read_json(root / "versions.json")
    node = read_json(root / "compat/node-baseline.json")
    values = {"QJS_COSMO_QUICKJS_VERSION": versions["quickjs"]["version"],
              "QJS_COSMO_QUICKJS_COMMIT": versions["quickjs"]["commit"],
              "QJS_COSMO_VERSION": versions["cosmopolitan"]["version"],
              "QJS_COSMO_COMMIT": versions["cosmopolitan"]["commit"],
              "QJS_COSMO_NODE_TARGET": node["version"]}
    return "/* Generated from locked inputs. */\n" + "\n".join(
        "#define " + key + " " + json.dumps(value, ensure_ascii=True) for key, value in values.items()) + "\n"


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
