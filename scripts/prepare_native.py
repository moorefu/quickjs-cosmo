#!/usr/bin/env python3
"""Prepare checksum-locked native source inputs and an optional local Node oracle.

Source preparation does not compile, link or enable any candidate library.
Only selected regular files are materialized; unrelated archive links are ignored.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile

from host_runtime import node_oracle_key
from node_contract import ROOT, read_json

SOURCE_PREFIXES = ("ape/", "libc/", "net/", "third_party/zlib/", "third_party/mbedtls/", "third_party/haclstar/",
                   "third_party/zstd/", "third_party/lz4cli/", "third_party/bzip2/",
                   "third_party/musl/", "third_party/tz/", "test/libc/", "test/net/https/")


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch(url, destination, expected, offline):
    if destination.is_file() and sha256(destination) == expected:
        return
    if offline:
        raise ValueError("Missing or invalid cached input: " + str(destination))
    if not url.startswith("https://") or len(expected) != 64:
        raise ValueError("Input must have an HTTPS URL and a pinned SHA-256")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--connect-timeout", "20",
                    "--max-time", "180", "--output", str(temporary), url], check=True)
    if sha256(temporary) != expected:
        raise ValueError("Downloaded input SHA-256 mismatch: " + str(destination))
    temporary.replace(destination)


def source_name(name, archive_root):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
        raise ValueError("Unsafe archive path: " + name)
    if not path.parts or path.parts[0] != archive_root:
        raise ValueError("Unexpected archive root: " + name)
    return PurePosixPath(*path.parts[1:]).as_posix() if len(path.parts) > 1 else ""


def write_member(bundle, member, destination):
    if not member.isfile():
        raise ValueError("Selected archive entry must be a regular file: " + member.name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Callers check containment against their extraction root before this write.
    if destination.is_symlink():
        raise ValueError("Refusing symlink output: " + str(destination))
    with bundle.extractfile(member) as source, destination.open("wb") as output:
        shutil.copyfileobj(source, output)
    destination.chmod(0o755 if member.mode & 0o111 else 0o644)


def prepare_source(root=ROOT, offline=False):
    lock = read_json(root / "native/versions.json")
    source = lock["cosmopolitan"]
    if source["commit"] != read_json(root / "versions.json")["cosmopolitan"]["commit"]:
        raise ValueError("Native source must match the toolchain's fixed Cosmopolitan commit")
    archive = root / ".cache" / source["archive"]
    fetch(source["url"], archive, source["sha256"], offline)
    destination = root / "upstream" / ("cosmopolitan-native-" + source["commit"][:12])
    marker = destination / ".native-inputs.json"
    selection = dict(source=source, prefixes=SOURCE_PREFIXES)
    required = [f for library in lock["libraries"] for f in library["files"]]
    # Every selected source is rechecked, including files not listed as anchors.
    ready = marker.is_file() and read_json(marker) == json.loads(json.dumps(selection))
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as bundle:
        expected_root = "cosmopolitan-" + source["commit"]
        seen = set()
        for member in bundle:
            name = source_name(member.name, expected_root)
            if not name or not name.startswith(SOURCE_PREFIXES) or member.isdir():
                continue
            if name in seen:
                raise ValueError("Duplicate selected archive path: " + name)
            seen.add(name)
            target = destination / name
            if not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Source output escapes extraction root")
            if not member.isfile():
                raise ValueError("Selected source entry must be a regular file: " + name)
            if ready:
                digest = hashlib.sha256()
                with bundle.extractfile(member) as content:
                    for block in iter(lambda: content.read(1024 * 1024), b""):
                        digest.update(block)
                if not target.is_file() or target.is_symlink() or sha256(target) != digest.hexdigest():
                    raise ValueError("Prepared native source changed: " + name)
            else:
                write_member(bundle, member, target)
    for entry in required:
        path = destination / entry["path"]
        if not path.is_file() or sha256(path) != entry["sha256"]:
            raise ValueError("Native source anchor checksum mismatch: " + entry["path"])
    marker.write_text(json.dumps(selection, indent=2) + "\n", encoding="utf-8")
    return destination


def node_destination(root=ROOT):
    return root / "toolchains" / ("node-v24.21.0-" + node_oracle_key())


def prepare_node(root=ROOT, offline=False):
    lock = read_json(root / "compat/node-baseline.json")
    key = node_oracle_key()
    if key not in lock["artifacts"]:
        raise ValueError("No pinned Node artifact for " + key)
    record = lock["artifacts"][key]
    name = record["file"].replace("/", "-")
    archive = root / ".cache/node-baseline" / name
    fetch("https://nodejs.org/dist/" + lock["version"] + "/" + record["file"],
          archive, record["sha256"], offline)
    destination = node_destination(root)
    target = destination / record["executable"]
    marker = destination / ".node-input.json"
    provenance = dict(version=lock["version"], artifact=record)
    if marker.is_file() and target.is_file():
        cached = read_json(marker)
        if cached.get("input") == provenance and cached.get("executable_sha256") == sha256(target):
            return target
    target.parent.mkdir(parents=True, exist_ok=True)
    if record["file"].endswith(".exe"):
        if target.is_symlink():
            raise ValueError("Refusing symlink Node output")
        shutil.copyfile(archive, target)
    else:
        archive_root = record["file"].split(".tar.")[0]
        with tarfile.open(archive, "r:*") as bundle:
            selected = [m for m in bundle.getmembers()
                        if source_name(m.name, archive_root) == record["executable"]]
            if len(selected) != 1:
                raise ValueError("Node archive must contain exactly one executable")
            if not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Node output escapes installation root")
            write_member(bundle, selected[0], target)
    marker.write_text(json.dumps(dict(input=provenance, executable_sha256=sha256(target)), indent=2) + "\n",
                      encoding="utf-8")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", action="store_true")
    parser.add_argument("--node", action="store_true")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    try:
        if args.source or not args.node:
            print("NATIVE_SOURCE " + str(prepare_source(offline=args.offline)))
        if args.node:
            print("NODE_EXE " + str(prepare_node(offline=args.offline)))
    except (OSError, ValueError, subprocess.CalledProcessError, tarfile.TarError) as error:
        parser.exit(1, str(error) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
