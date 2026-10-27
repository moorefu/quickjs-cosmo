#!/usr/bin/env python3
"""Shared paths and inputs for the single pinned Nightly build."""
from datetime import datetime
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]


def load_config(profile=None):
    profile = profile or os.environ.get("QUICKJS_COSMO_PROFILE", "nightly")
    if profile != "nightly":
        raise ValueError("This checkout is pinned to Nightly cosmocc; use versions.json")
    lock_file = ROOT / "versions.json"
    data = json.loads(lock_file.read_text())
    cosmo = data["cosmopolitan"]
    timestamp = datetime.fromisoformat(data["quickjs"]["commit_date"].replace("Z", "+00:00"))
    return SimpleNamespace(
        root=ROOT, profile=profile, lock_file=lock_file, data=data,
        toolchain=ROOT / "toolchains" / ("cosmocc-" + cosmo["version"]),
        archive=ROOT / ".cache" / cosmo.get("archive_name", "cosmocc-" + cosmo["version"] + ".zip"),
        build=ROOT / "build/quickjs-nightly",
        native_source=ROOT / "upstream" / ("cosmopolitan-native-" + cosmo["commit"][:12]),
        dist=ROOT / "dist",
        reports=ROOT / "build/test-results",
        releases=ROOT / "releases",
        source_epoch=int(timestamp.timestamp()),
    )


if __name__ == "__main__":
    config = load_config()
    print(getattr(config, sys.argv[1]))
