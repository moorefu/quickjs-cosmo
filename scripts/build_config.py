#!/usr/bin/env python3
"""Shared paths and locked inputs for stable and nightly builds."""
from datetime import datetime
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]


def load_config(profile=None):
    profile = profile or os.environ.get("QUICKJS_COSMO_PROFILE", "stable")
    if profile not in ("stable", "nightly"):
        raise ValueError("Unknown build profile: " + profile)
    nightly = profile == "nightly"
    lock_file = ROOT / ("versions-nightly.json" if nightly else "versions.json")
    data = json.loads(lock_file.read_text())
    cosmo = data["cosmopolitan"]
    timestamp = datetime.fromisoformat(data["quickjs"]["commit_date"].replace("Z", "+00:00"))
    return SimpleNamespace(
        root=ROOT, profile=profile, lock_file=lock_file, data=data,
        toolchain=ROOT / "toolchains" / ("cosmocc-" + cosmo["version"]),
        archive=ROOT / ".cache" / cosmo.get("archive_name", "cosmocc-" + cosmo["version"] + ".zip"),
        build=ROOT / "build" / ("quickjs-nightly" if nightly else "quickjs"),
        dist=ROOT / "dist" / "nightly" if nightly else ROOT / "dist",
        reports=ROOT / "build/test-results/nightly" if nightly else ROOT / "build/test-results",
        releases=ROOT / "releases/nightly" if nightly else ROOT / "releases",
        source_epoch=int(timestamp.timestamp()),
    )


if __name__ == "__main__":
    config = load_config()
    print(getattr(config, sys.argv[1]))
