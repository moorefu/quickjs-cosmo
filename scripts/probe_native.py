#!/usr/bin/env python3
"""Compile a dual-architecture toolchain probe or run that same APE on a host."""
import argparse
import json
import os
from pathlib import Path
import struct
import sys

from build_config import load_config
from host_runtime import ape_command, host_info
from node_contract import ROOT, read_json
from prepare_native import sha256
from test_node_compat import run_command


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compile", action="store_true", help="Compile using cosmocc on Unix/WSL")
    parser.add_argument("--binary", type=Path, default=ROOT / "build/native/toolchain-probe.exe")
    args = parser.parse_args()
    settings = load_config()
    binary = args.binary.resolve()
    if args.compile:
        if os.name != "posix":
            parser.error("Compile in WSL/Unix, then run the same APE on Windows")
        binary.parent.mkdir(parents=True, exist_ok=True)
        verification = run_command([sys.executable, ROOT / "scripts/prepare_compat.py", "--offline"], ROOT, 30)
        if verification["failure"] or verification["exit_code"]:
            parser.exit(1, verification["stdout"] + verification["stderr"])
        compiler = settings.toolchain / "bin/cosmocc"
        result = run_command([compiler, "-O2", "-std=gnu23", "-D_COSMO_SOURCE",
                              "-DQJS_COSMO_SIGPROC", "-I" + str(settings.build / "compat-source"),
                              ROOT / "native/probes/toolchain.c", ROOT / "compat/host_exit.c",
                              ROOT / "compat/host_process.c", "-Wl,--wrap=_Exit,-u,__wrap__Exit",
                              "-o", binary], ROOT, 120)
        if result["failure"] or result["exit_code"]:
            parser.exit(1, result["stdout"] + result["stderr"])
        slices = {}
        for suffix, machine in ((".com.dbg", 62), (".aarch64.elf", 183)):
            path = binary.with_name(binary.name + suffix)
            with path.open("rb") as source:
                header = source.read(20)
            if header[:4] != b"\x7fELF" or struct.unpack_from("<H", header, 18)[0] != machine:
                parser.exit(1, "Missing or incorrect architecture slice: " + str(path) + "\n")
            slices[suffix] = dict(elf_machine=machine, sha256=sha256(path))
        provenance = dict(binary_sha256=sha256(binary), slices=slices,
                          toolchain=settings.data["cosmopolitan"],
                          compatibility=read_json(ROOT / "compat/versions.json"),
                          sources={name: sha256(ROOT / name) for name in
                                   ("native/probes/toolchain.c", "compat/host_exit.c", "compat/host_process.c")})
        binary.with_name(binary.name + ".build.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    if not binary.is_file():
        parser.error("Missing native probe; use --compile in WSL first")
    provenance_path = binary.with_name(binary.name + ".build.json")
    if not provenance_path.is_file():
        parser.error("Missing probe build provenance; compile using this script first")
    provenance = read_json(provenance_path)
    if provenance["binary_sha256"] != sha256(binary) or provenance["toolchain"] != settings.data["cosmopolitan"]:
        parser.error("Probe provenance does not match binary or toolchain")
    if provenance["compatibility"] != read_json(ROOT / "compat/versions.json") or any(
            sha256(ROOT / name) != digest for name, digest in provenance["sources"].items()):
        parser.error("Probe was not built with current source/compatibility inputs")
    result = run_command(ape_command(binary, [], settings.dist), ROOT, timeout=30)
    records = [line[len("NATIVE_PROBE "):] for line in result["stdout"].splitlines()
               if line.startswith("NATIVE_PROBE ")]
    passed = not result["failure"] and result["exit_code"] == 0 and len(records) == 1
    values = json.loads(records[0]) if passed else None
    if values:
        passed = all(values.get(k) is True for k in
                     ("crc32", "blake2b256", "getrandom", "numericAddress", "socketCreation", "stdio"))
    report = dict(format=1, passed=passed, host=host_info(), binary_sha256=sha256(binary),
                  source_sha256=sha256(ROOT / "native/probes/toolchain.c"),
                  native_lock_sha256=sha256(ROOT / "native/versions.json"),
                  build=provenance,
                  toolchain=read_json(ROOT / "versions.json")["cosmopolitan"],
                  scope="toolchain link/runtime probe; no JS API or TCP/DNS exchange claim",
                  result=values, process=result)
    path = ROOT / "build/native" / ("probe-" + host_info()["system"] + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(("PASS " if passed else "FAIL ") + "native-toolchain-probe; report: " + str(path))
    if not passed:
        print(result["stdout"] + result["stderr"])
    return int(not passed)


if __name__ == "__main__":
    raise SystemExit(main())
