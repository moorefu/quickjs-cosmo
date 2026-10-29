#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
from build_config import load_config
from runtime_inputs import runtime_source_names
from runtime_capabilities import report, features
from build_variants import validate_ca

ROOT = Path(__file__).resolve().parents[1]
settings = load_config()
config = settings.data
capabilities = report(ROOT,settings.runtime_profile)
(settings.dist / 'capabilities.json').write_text(json.dumps(capabilities,indent=2,ensure_ascii=True)+'\n',encoding='utf8')
manifest = {
    "build_profile": settings.profile,
    "runtime_profile": settings.runtime_profile,
    "architecture": "fat",
    "compression": json.loads((ROOT/'build/native/compression/build.json').read_text()),
    "shared_ca": {name:validate_ca(settings.dist/name,ROOT) for name in ('qjs.exe','qjsc.exe')},
    "quickjs": config["quickjs"],
    "cosmopolitan": config["cosmopolitan"],
    "format": "Actually Portable Executable (APE), x86_64 + aarch64",
    "features": features(capabilities),
    "windows_exit_status": "raw uint32; Unix retains POSIX wait status",
    "compatibility": json.loads((ROOT / "compat/versions.json").read_text()),
    "compatibility_sources": {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in sorted((ROOT / "compat").glob("*")) if p.is_file()},
    "files": {},
    "runtime_sources": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in runtime_source_names(ROOT)},
    "patches": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted((ROOT / "patches").glob("*.patch"))},
}
for path in sorted(settings.dist.rglob("*")):
    if path.parent not in (settings.dist, settings.dist / ".aarch64") and not path.is_relative_to(settings.dist / 'variants'):
        continue
    if path.is_file() and path != settings.dist / "manifest.json":
        manifest["files"][path.relative_to(settings.dist).as_posix()] = {
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
(settings.dist / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
