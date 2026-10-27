#!/usr/bin/env python3
"""Check declarations with the pinned, official QuickJS TypeScript developer tool."""
import argparse
from pathlib import PurePosixPath
import shutil
import subprocess
import tarfile

from host_runtime import host_info
from node_contract import ROOT, read_json
from prepare_native import fetch, sha256, source_name, write_member


def prepare_tool(root=ROOT, offline=False):
    lock = read_json(root / "compat/dev-tools.json")["typescript"]
    archive = root / ".cache/dev-tools" / lock["archive"]
    research = root / ".cache/optional-tools-research" / lock["archive"]
    if not archive.exists() and research.is_file() and sha256(research) == lock["sha256"]:
        archive.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(research, archive)
    fetch(lock["url"], archive, lock["sha256"], offline)
    destination = root / "toolchains" / lock["root"]
    if not destination.resolve().is_relative_to(root.resolve()):
        raise ValueError("TypeScript tool output escapes checkout")
    seen = set()
    # The official filename ends in .tar.xz, but this pinned artifact is gzip.
    with tarfile.open(archive, "r:*") as bundle:
        for member in bundle:
            name = source_name(member.name, lock["root"])
            parts = PurePosixPath(name).parts
            selected = name in {"lib/tsc", "readme.txt"} or (
                len(parts) == 2 and name.startswith("lib/lib.") and name.endswith(".d.ts"))
            if not selected:
                continue
            if name in seen:
                raise ValueError("Duplicate TypeScript tool entry: " + name)
            seen.add(name)
            target = destination / name
            if not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError("TypeScript tool entry escapes extraction root")
            write_member(bundle, member, target)
    if not {"lib/tsc", "lib/lib.es2022.d.ts", "lib/lib.es5.d.ts"}.issubset(seen):
        raise ValueError("Incomplete TypeScript developer tool")
    compiler = destination / "lib/tsc"
    compiler.chmod(0o755)
    return compiler, lock


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    host = host_info()
    if host["system"] != "linux" or host["execution_arch"] != "x86_64":
        parser.error("This optional developer tool runs on Linux x86_64; use WSL on Windows")
    compiler, lock = prepare_tool(offline=args.offline)
    version = subprocess.run([str(compiler), "--version"], check=True, capture_output=True,
                             text=True, encoding="utf-8", timeout=30).stdout.strip()
    if version != "Version " + lock["version"]:
        raise ValueError("TypeScript compiler version mismatch")
    files = sorted((ROOT / "types").rglob("*.d.ts")) + sorted((ROOT / "tests/types").rglob("*.ts"))
    if not files:
        raise ValueError("Missing declaration checks")
    for libraries in ("es2022", "es2022,dom"):
        subprocess.run([str(compiler), "--noEmit", "--strict", "--target", "es2022", "--lib", libraries,
                        *map(str, files)], cwd=ROOT, check=True, timeout=120)
    print("PASS TypeScript " + lock["version"] + ": declarations and positive/negative compile fixtures")


if __name__ == "__main__":
    main()
