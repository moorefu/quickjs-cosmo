#!/usr/bin/env python3
"""Fetch the locked official archives and preserve POSIX modes and symlinks."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checked_path(root, name):
    path = root / name
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Archive path escapes destination: " + name)
    return path


def extract_zip(archive, destination):
    with zipfile.ZipFile(archive) as bundle:
        bad = bundle.testzip()
        if bad:
            raise ValueError("Invalid ZIP CRC: " + bad)
        for entry in bundle.infolist():
            path = checked_path(destination, entry.filename)
            mode = entry.external_attr >> 16
            if entry.is_dir():
                path.mkdir(parents=True, exist_ok=True)
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            if stat.S_ISLNK(mode):
                target = bundle.read(entry).decode("utf-8")
                checked_path(destination, str(path.parent.relative_to(destination) / target))
                if path.is_symlink() or path.exists():
                    path.unlink()
                path.symlink_to(target)
            else:
                with bundle.open(entry) as source, path.open("wb") as output:
                    shutil.copyfileobj(source, output)
                path.chmod(stat.S_IMODE(mode) or 0o644)


def extract_tar(archive, destination):
    with tarfile.open(archive, "r:gz") as bundle:
        for entry in bundle:
            _, _, name = entry.name.partition("/")
            if not name:
                continue
            path = checked_path(destination, name)
            if entry.isdir():
                path.mkdir(parents=True, exist_ok=True)
            elif entry.isfile():
                path.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(entry) as source, path.open("wb") as output:
                    shutil.copyfileobj(source, output)
                path.chmod(entry.mode)
            else:
                raise ValueError("Unsupported source archive entry: " + entry.name)


def prepare(config, archive, destination, extractor, offline):
    marker = destination / ".bootstrap.json"
    if marker.exists() and json.loads(marker.read_text()) == config:
        print("Ready:", destination.relative_to(ROOT), flush=True)
        return
    expected = config["sha256"]
    if len(expected) != 64:
        raise ValueError("The lock file must contain a SHA-256 digest")
    if not archive.exists() or sha256(archive) != expected:
        if offline:
            raise ValueError("Missing or invalid cached archive: " + str(archive))
        archive.parent.mkdir(parents=True, exist_ok=True)
        partial = archive.with_suffix(archive.suffix + ".part")
        subprocess.run([
            "curl", "--fail", "--location", "--retry", "3", "--connect-timeout", "20",
            "--output", str(partial), config["url"],
        ], check=True)
        actual = sha256(partial)
        if actual != expected:
            raise ValueError("SHA-256 mismatch for " + str(partial) + ": " + actual)
        partial.replace(archive)
    destination.mkdir(parents=True, exist_ok=True)
    print("Extracting:", archive.name, flush=True)
    extractor(archive, destination)
    marker.write_text(json.dumps(config, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Only use verified cached archives")
    args = parser.parse_args()
    if os.name != "posix":
        parser.error("Run this bootstrap inside WSL, Linux, macOS or BSD to preserve symlinks")
    config = json.loads((ROOT / "versions.json").read_text())
    prepare(config["cosmopolitan"], ROOT / ".cache/cosmocc-4.0.2.zip",
            ROOT / "toolchains/cosmocc-4.0.2", extract_zip, args.offline)
    prepare(config["quickjs"], ROOT / ".cache/quickjs-source.tar.gz",
            ROOT / "upstream/quickjs", extract_tar, args.offline)


if __name__ == "__main__":
    main()
