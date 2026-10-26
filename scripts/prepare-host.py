#!/usr/bin/env python3
"""Use native ELF build tools on Linux; leave output APEs untouched.

WSL's MZ binfmt handler otherwise launches the compiler as a Windows process.
The original, verified ZIP is retained so the toolchain can be re-extracted.
"""
import os
from pathlib import Path
import platform
import subprocess
from build_config import load_config

root = Path(__file__).resolve().parents[1]
toolchain = load_config().toolchain
if platform.system() == "Linux":
    machine = platform.machine().lower()
    arch = "aarch64" if machine in ("aarch64", "arm64") else "x86_64"
    loader = toolchain / f"bin/ape-{arch}.elf"
    candidates = []
    for path in toolchain.rglob("*"):
        if path.is_file() and not path.is_symlink():
            with path.open("rb") as source:
                if source.read(2) == b"MZ":
                    candidates.append(str(path))
    if candidates:
        print(f"Preparing {len(candidates)} native Linux build tools", flush=True)
        subprocess.run([str(loader), str(toolchain / "bin/assimilate"), "-e",
                        "-a" if arch == "aarch64" else "-x", "-c", *candidates], check=True)
