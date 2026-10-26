#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
from build_config import load_config

ROOT = Path(__file__).resolve().parents[1]
settings = load_config()
config = settings.data
manifest = {
    "build_profile": settings.profile,
    "quickjs": config["quickjs"],
    "cosmopolitan": config["cosmopolitan"],
    "format": "Actually Portable Executable (APE), x86_64 + aarch64",
    "features": ["std", "os", "Worker", "BigInt", "experimental Temporal/Intl"],
    "files": {},
    "patches": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted((ROOT / "patches").glob("*.patch"))},
}
for path in sorted(settings.dist.rglob("*")):
    if path.parent not in (settings.dist, settings.dist / ".aarch64"):
        continue
    if path.is_file() and path.name != "manifest.json":
        manifest["files"][path.relative_to(settings.dist).as_posix()] = {
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
(settings.dist / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
