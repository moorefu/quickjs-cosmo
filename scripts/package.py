#!/usr/bin/env python3
"""Match the upstream QuickJS Cosmopolitan binary release layout."""
from datetime import datetime
import argparse
import hashlib
from pathlib import Path
import re
import stat
import zipfile
from build_config import load_config
from release_version import release_info
from runtime_capabilities import readme, report

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--nightly", action="store_true", help="Compatibility alias; Nightly is always used")
parser.add_argument("--tag", help="Release tag, for example v2026-06-04.1; automatic for Actions tag runs")
args = parser.parse_args()
settings = load_config("nightly" if args.nightly else None)
lock = settings.data
output = settings.releases
output.mkdir(parents=True, exist_ok=True)
version = (root / "upstream/quickjs/VERSION").read_text().strip()
if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", version) or version != lock["quickjs"]["version"]:
    raise ValueError("QuickJS VERSION must match the locked YYYY-MM-DD version")
release = release_info(settings, args.tag)
name = release["archive"]
archive = output / name
files = [
    (root / "upstream/quickjs/readme-cosmo.txt", "readme.txt", 0o664),
    (settings.dist / "run-test262.exe", "run-test262", 0o755),
    (settings.dist / "qjs.exe", "qjs", 0o755),
]
timestamp = datetime.fromisoformat(lock["quickjs"]["commit_date"].replace("Z", "+00:00"))
contents = []
for path, relative, mode in files:
    data = path.read_bytes()
    if relative == "readme.txt":
        data += ("\n\nPinned build\n"
                 "Release version: " + release["version"] + "\n"
                 "QuickJS commit: " + lock["quickjs"]["commit"] + "\n"
                 "cosmocc commit: " + lock["cosmopolitan"]["commit"] + "\n"
                 "cosmocc Nightly run: " + str(lock["cosmopolitan"]["run_number"]) + "\n").encode("ascii")
        data += b"\nNode.js JavaScript modules (MIT)\n" + (settings.dist / "NODE-MODULES-LICENSE").read_bytes()
        data += b"\nNative library and source notices (runtime adapters and build probes)\n" + (settings.dist / "NATIVE-MODULES-LICENSES").read_bytes()
        data += readme(report(root))
    if mode & 0o111 and not data.startswith(b"MZ"):
        raise ValueError(f"Expected an APE binary, not a shell launcher: {path}")
    contents.append((relative, mode, data))

with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
    for relative, mode, data in contents:
        info = zipfile.ZipInfo(relative, timestamp.timetuple()[:6])
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | mode) << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        bundle.writestr(info, data)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix(".zip.sha256").write_text(f"{digest}  {name}\n")
print(f"Packaged {len(contents)} files: {archive} ({archive.stat().st_size} bytes)")
print("SHA-256:", digest)
