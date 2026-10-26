#!/usr/bin/env python3
"""Select the APE entry point for the current operating system and CPU."""
import ctypes
from pathlib import Path
import platform


def normalize_arch(machine):
    aliases = {"amd64": "x86_64", "x64": "x86_64", "aarch64": "arm64"}
    machine = machine.lower()
    return aliases.get(machine, machine)


def windows_arches():
    """Distinguish an ARM64 Windows host from its emulated x64 Python process."""
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    query = kernel.IsWow64Process2
    query.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ushort), ctypes.POINTER(ctypes.c_ushort)]
    query.restype = ctypes.c_int
    process_machine, native_machine = ctypes.c_ushort(), ctypes.c_ushort()
    if not query(ctypes.c_void_p(-1), ctypes.byref(process_machine), ctypes.byref(native_machine)):
        raise ctypes.WinError(ctypes.get_last_error())
    names = {0x8664: "x86_64", 0xAA64: "arm64", 0x014C: "x86"}
    host = names.get(native_machine.value, hex(native_machine.value))
    process = names.get(process_machine.value or native_machine.value, "unknown")
    return host, process


def host_info():
    system = platform.system().lower()
    host = process = normalize_arch(platform.machine())
    if system == "windows":
        host, process = windows_arches()
    return dict(system=system, platform="win32" if system == "windows" else system,
                host_arch=host, python_arch=process,
                execution_arch="x86_64" if system == "windows" else process)


def ape_command(binary, arguments, dist, *, system=None, arch=None, loader=None):
    """Linux uses its matching ELF loader; other Unix hosts use APE's shell entry."""
    system = system or platform.system().lower()
    arguments = [str(binary), *map(str, arguments)]
    if system == "windows":
        return arguments
    if system == "linux":
        arch = normalize_arch(arch or platform.machine())
        if arch not in ("x86_64", "arm64"):
            raise ValueError("Unsupported APE CPU: " + arch)
        loader = Path(loader) if loader else Path(dist) / (
            "ape-aarch64.elf" if arch == "arm64" else "ape-x86_64.elf")
        if not loader.is_file():
            raise FileNotFoundError("Missing APE loader: " + str(loader))
        return [str(loader), *arguments]
    return ["/bin/sh", *arguments]


def check_host(info, expected_platform=None, expected_arch=None, expected_execution_arch=None):
    expected = {"platform": expected_platform, "host_arch": expected_arch,
                "execution_arch": expected_execution_arch}
    for field, value in expected.items():
        if value and info[field] != value:
            raise ValueError(f"Host {field}: expected {value}, got {info[field]}")
