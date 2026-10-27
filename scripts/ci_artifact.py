#!/usr/bin/env python3
"""Transport one tested APE build to every CI runner, with its pinned inputs."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import struct
import tarfile
import zipfile

from build_config import load_config
from release_version import bundle_release, release_info
from runtime_inputs import runtime_source_names

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "build/ci/bundle-manifest.json"
STANDALONES = ("build/test-linux/hello-standalone.exe", "build/test-linux/runtime-standalone.exe",
               "build/test-linux/registry-standalone.exe", "build/test-linux/registry-sdk.exe",
               "build/test-linux/buffer-standalone.exe", "build/test-linux/foundation-standalone.exe",
               "build/test-linux/entry-standalone.exe", "build/test-linux/scheduling-standalone.exe",
               "build/test-linux/scheduler-sdk.exe", "build/test-linux/fs-standalone.exe", "build/test-linux/fs-sdk.exe",
               "build/test-linux/crypto-standalone.exe", "build/test-linux/crypto-sdk.exe",
               "build/test-linux/compression-standalone.exe", "build/test-linux/compression-sdk.exe",
               "build/test-linux/child-process-standalone.exe", "build/test-linux/child-process-sdk.exe",
               "build/test-linux/task-pool-sdk.exe", "build/test-linux/async-standalone.exe", "build/test-linux/async-sdk.exe")
SOURCE = ".cache/quickjs-source.tar.gz"
NATIVE_PROBES = tuple("build/native/" + name + suffix
                     for name in ("toolchain-probe.exe", "backends-probe.exe")
                     for suffix in ("", ".build.json"))


def sha256(path):
    with Path(path).open("rb") as stream:
        return stream_sha256(stream)


def stream_sha256(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def checked_name(name, version):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name or str(path) != name:
        raise ValueError("Unsafe CI artifact path: " + name)
    release = f"releases/quickjs-cosmo-{version}.zip"
    allowed = name in (MANIFEST, SOURCE, *STANDALONES, *NATIVE_PROBES, release, release + ".sha256")
    allowed |= len(path.parts) == 2 and path.parts[0] == "dist"
    allowed |= len(path.parts) == 3 and path.parts[:2] == ("dist", ".aarch64")
    if not allowed:
        raise ValueError("Unexpected CI artifact path: " + name)
    return path


def verify_dist(settings):
    root, dist = settings.root, settings.dist
    manifest = json.loads((dist / "manifest.json").read_text(encoding="utf-8"))
    if any(manifest[key] != settings.data[key] for key in ("quickjs", "cosmopolitan")):
        raise ValueError("Artifact versions do not match this checkout's versions.json")
    compat = json.loads((root / "compat/versions.json").read_text(encoding="utf-8"))
    if manifest["compatibility"] != compat or compat["ref"] != settings.data["cosmopolitan"]["commit"]:
        raise ValueError("Artifact compatibility sources do not match this checkout")
    expected = {p.name: sha256(p) for p in (root / "patches").glob("*.patch")}
    if manifest["patches"] != expected:
        raise ValueError("Artifact QuickJS patches do not match this checkout")
    expected = {p.relative_to(root).as_posix(): sha256(p) for p in (root / "compat").iterdir() if p.is_file()}
    if manifest["compatibility_sources"] != expected:
        raise ValueError("Artifact compatibility helpers do not match this checkout")
    expected = {name: sha256(root / name) for name in runtime_source_names(root)}
    if manifest.get("runtime_sources") != expected:
        raise ValueError("Artifact runtime sources do not match this checkout")
    required = {"qjs.exe", "qjsc.exe", "run-test262.exe", "libquickjs.a", ".aarch64/libquickjs.a",
                "quickjs.h", "quickjs-libc.h", "qjs-cosmo.h", "qjs-tasks.h", "node-compat.d.ts", "fs.d.ts", "fs-async.d.ts", "crypto.d.ts", "zlib.d.ts", "algorithms-async.d.ts", "child_process.d.ts", "cosmo.d.ts", "ape-x86_64.elf", "ape-aarch64.elf",
                "qjs", "qjsc", "run-test262", "versions.json", "QUICKJS-LICENSE", "NODE-MODULES-LICENSE", "NATIVE-MODULES-LICENSES"}
    if not required.issubset(manifest["files"]):
        raise ValueError("Incomplete SDK in CI artifact")
    for name, record in manifest["files"].items():
        checked_name("dist/" + name, settings.data["quickjs"]["version"])
        path = dist / name
        if path.stat().st_size != record["bytes"] or sha256(path) != record["sha256"]:
            raise ValueError("SDK hash mismatch: " + name)
    if json.loads((dist / "versions.json").read_text()) != settings.data:
        raise ValueError("SDK lock file mismatch")
    for name in ("qjs.exe", "qjsc.exe", "run-test262.exe"):
        with (dist / name).open("rb") as stream:
            header = stream.read(64)
            if not header.startswith(b"MZqFpD='"):
                raise ValueError("Expected a portable APE: " + name)
            offset = struct.unpack_from("<I", header, 60)[0]
            stream.seek(offset)
            pe = stream.read(6)
            if len(pe) != 6 or pe[:4] != b"PE\0\0" or struct.unpack_from("<H", pe, 4)[0] != 0x8664:
                raise ValueError("Expected x64 Windows PE entry: " + name)
    for name, machine in (("ape-x86_64.elf", 62), ("ape-aarch64.elf", 183)):
        header = (dist / name).read_bytes()[:64]
        if header[:4] != b"\x7fELF" or struct.unpack_from("<H", header, 18)[0] != machine:
            raise ValueError("Incorrect Linux loader CPU: " + name)
    return manifest


def verify_package(settings, release=None):
    release = release or release_info(settings)
    source = settings.root / SOURCE
    if sha256(source) != settings.data["quickjs"]["sha256"]:
        raise ValueError("Pinned QuickJS source archive hash mismatch")
    archive = settings.releases / release["archive"]
    checksum = archive.with_suffix(".zip.sha256").read_text().split()
    if checksum != [sha256(archive), archive.name]:
        raise ValueError("Release ZIP checksum mismatch")
    with zipfile.ZipFile(archive) as bundle:
        if bundle.namelist() != ["readme.txt", "run-test262", "qjs"] or bundle.testzip():
            raise ValueError("Release ZIP must have the official three-file layout and valid CRC")
        for name in ("qjs", "run-test262"):
            if bundle.read(name) != (settings.dist / (name + ".exe")).read_bytes():
                raise ValueError("Release binary differs from SDK: " + name)
        readme = bundle.read("readme.txt")
        if ("Release version: " + release["version"]).encode() not in readme:
            raise ValueError("Release readme version differs from the archive version")
        with tarfile.open(source, "r:gz") as sources:
            original = next(m for m in sources if m.name.endswith("/readme-cosmo.txt"))
            with sources.extractfile(original) as stream:
                if not readme.startswith(stream.read()):
                    raise ValueError("Release readme is missing the upstream text")
        if any(settings.data[key]["commit"].encode() not in readme for key in ("quickjs", "cosmopolitan")):
            raise ValueError("Release readme is missing pinned commits")
        if (settings.dist / "NODE-MODULES-LICENSE").read_bytes() not in readme:
            raise ValueError("Release readme is missing Node module notices")
        if (settings.dist / "NATIVE-MODULES-LICENSES").read_bytes() not in readme:
            raise ValueError("Release readme is missing native source notices")


def bundle_metadata(settings):
    metadata = json.loads((settings.root / MANIFEST).read_text(encoding="utf-8"))
    if metadata["format"] != 2 or metadata["versions"] != settings.data:
        raise ValueError("CI bundle does not match the pinned inputs")
    bundle_release(metadata, settings)
    return metadata


def verify(settings):
    metadata = bundle_metadata(settings)
    release = bundle_release(metadata, settings)
    for name, record in metadata["files"].items():
        checked_name(name, release["version"])
        path = settings.root / name
        if path.stat().st_size != record["bytes"] or sha256(path) != record["sha256"]:
            raise ValueError("CI payload hash mismatch: " + name)
    sdk = verify_dist(settings)
    expected = {"dist/" + name for name in sdk["files"]} | {
        "dist/manifest.json", SOURCE, *STANDALONES, *NATIVE_PROBES,
        "releases/" + release["archive"], "releases/" + release["archive"] + ".sha256"}
    if set(metadata["files"]) != expected:
        raise ValueError("CI bundle payload inventory mismatch")
    from native_provenance import verify_probe
    for backend in (False, True):
        name = "backends" if backend else "toolchain"
        verify_probe(settings, settings.root / ("build/native/" + name + "-probe.exe"), backend)
    verify_package(settings, release)
    print("PASS CI artifact integrity: SDK, sources, standalone APEs and release ZIP", flush=True)
    return metadata


def pack(settings, output, tag=None):
    sdk = verify_dist(settings)
    release = release_info(settings, tag)
    verify_package(settings, release)
    report = json.loads((settings.reports / "linux.json").read_text(encoding="utf-8"))
    if report["failed"] or report["qjs_sha256"] != sha256(settings.dist / "qjs.exe"):
        raise ValueError("Build host tests must pass for the packaged qjs")
    archive = "releases/" + release["archive"]
    files = sorted({"dist/" + name for name in sdk["files"]} | {
        "dist/manifest.json", SOURCE, *STANDALONES, *NATIVE_PROBES, archive, archive + ".sha256"})
    for name in ("probe-linux.json", "backends-linux.json"):
        native = json.loads((settings.root / "build/native" / name).read_text(encoding="utf-8"))
        if not native["passed"]:
            raise ValueError("Native probes must pass before packaging")
        binary = "toolchain-probe.exe" if name.startswith("probe-") else "backends-probe.exe"
        if native["build"]["binary_sha256"] != sha256(settings.root / "build/native" / binary):
            raise ValueError("Native report refers to a different binary")
    metadata = dict(format=2, versions=settings.data, release=release, files={})
    for name in files:
        checked_name(name, release["version"])
        path = settings.root / name
        metadata["files"][name] = dict(bytes=path.stat().st_size, sha256=sha256(path))
    target = settings.root / MANIFEST
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, "w:gz", compresslevel=6) as bundle:
        for name in (MANIFEST, *files):
            bundle.add(settings.root / name, arcname=name, recursive=False)
    output.with_suffix(output.suffix + ".sha256").write_text(f"{sha256(output)}  {output.name}\n")
    print("Packed CI artifact:", output, flush=True)


def unpack(settings, archive):
    checksum = archive.with_suffix(archive.suffix + ".sha256").read_text().split()
    if checksum != [sha256(archive), archive.name]:
        raise ValueError("CI transport checksum mismatch")
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if len({m.name for m in members}) != len(members) or any(not m.isfile() for m in members):
            raise ValueError("CI transport only permits unique regular files")
        with bundle.extractfile(MANIFEST) as stream:
            metadata = json.load(stream)
        if metadata["format"] != 2 or metadata["versions"] != settings.data:
            raise ValueError("CI transport uses different pinned inputs")
        release = bundle_release(metadata, settings)
        for member in members:
            checked_name(member.name, release["version"])
        if {m.name for m in members} != {MANIFEST, *metadata["files"]}:
            raise ValueError("CI transport inventory mismatch")
        # Verify every byte before overwriting any local payload file.
        for member in members:
            if member.name == MANIFEST:
                continue
            record = metadata["files"][member.name]
            with bundle.extractfile(member) as stream:
                digest = stream_sha256(stream)
            if member.size != record["bytes"] or digest != record["sha256"]:
                raise ValueError("CI transport payload mismatch: " + member.name)
        for member in members:
            target = settings.root / member.name
            if target.resolve() != target.absolute():
                raise ValueError("CI payload destination is a filesystem alias: " + member.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.extractfile(member) as stream, target.open("wb") as output:
                shutil.copyfileobj(stream, output)
            target.chmod(stat.S_IMODE(member.mode) & 0o777)
    verify(settings)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("pack", "unpack", "verify"))
    parser.add_argument("--archive", type=Path, default=ROOT / "build/ci/quickjs-cosmo-ci.tar.gz")
    parser.add_argument("--tag", help="Release tag when packing outside GitHub Actions")
    args = parser.parse_args()
    settings = load_config()
    if args.operation == "pack":
        pack(settings, args.archive.resolve(), args.tag)
    elif args.operation == "unpack":
        unpack(settings, args.archive.resolve())
    else:
        verify(settings)


if __name__ == "__main__":
    main()
