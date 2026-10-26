#!/usr/bin/env python3
"""Verify and patch selected Cosmopolitan host sources without changing the toolchain."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from build_config import load_config


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    settings = load_config()
    config = json.loads((settings.root / "compat/versions.json").read_text())
    if config["ref"] != settings.data["cosmopolitan"]["commit"]:
        raise ValueError("Compatibility sources must match the pinned cosmocc commit")
    patch = settings.root / config["patch"]
    if digest(patch) != config["patch_sha256"]:
        raise ValueError("Cosmopolitan compatibility patch checksum mismatch")
    destination = settings.build / "compat-source"
    for source in config["files"]:
        cache = settings.root / ".cache/cosmo-compat" / settings.profile / source["path"]
        if not cache.exists() or digest(cache) != source["sha256"]:
            if args.offline:
                raise ValueError("Missing or invalid pinned source: " + str(cache))
            cache.parent.mkdir(parents=True, exist_ok=True)
            partial = cache.with_suffix(".c.part")
            subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--connect-timeout", "20",
                            "--output", str(partial), source["url"]], check=True)
            if digest(partial) != source["sha256"]:
                raise ValueError("Downloaded compatibility source checksum mismatch")
            partial.replace(cache)
        target = destination / source["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cache, target)
    subprocess.run(["patch", "--batch", "-d", str(destination), "-p1", "-i", str(patch)], check=True)
    for source in config["files"]:
        if digest(destination / source["path"]) != source["patched_sha256"]:
            raise ValueError("Patched compatibility source checksum mismatch: " + source["path"])
    print("Verified Cosmopolitan host compatibility sources:", settings.profile, flush=True)


if __name__ == "__main__":
    main()
