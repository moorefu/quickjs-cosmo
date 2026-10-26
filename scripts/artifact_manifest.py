#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / "versions.json").read_text())
manifest = {
    "quickjs": config["quickjs"],
    "cosmopolitan": config["cosmopolitan"],
    "format": "Actually Portable Executable (APE), x86_64 + aarch64",
    "features": ["std", "os", "Worker", "BigInt", "experimental Temporal/Intl"],
    "files": {},
    "patches": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted((ROOT / "patches").glob("*.patch"))},
}
for path in sorted((ROOT / "dist").rglob("*")):
    if path.is_file() and path.name != "manifest.json":
        manifest["files"][str(path.relative_to(ROOT / "dist"))] = {
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
(ROOT / "dist/manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
