#!/usr/bin/env python3
"""Run a downloaded tests package without a source checkout or toolchain."""
from pathlib import Path
import os
import platform
import subprocess

root = Path(__file__).resolve().parent
os.chdir(root)
os.environ['TZ']='UTC'
os.environ['LC_ALL']='C'
cpu = 'aarch64' if platform.machine().lower() in ('aarch64', 'arm64') else 'x86_64'


def command(name, *arguments):
    binary = root / name
    if os.name == 'nt':
        return [str(binary), *arguments]
    binary.chmod(0o755)
    if platform.system() == 'Linux':
        loader = root / ('ape-' + cpu + '.elf')
        loader.chmod(0o755)
        return [str(loader), str(binary), *arguments]
    return ['/bin/sh', str(binary), *arguments]


subprocess.run(command('run-test262', '-N', '-f', 'tests/release-smoke.js'), check=True, timeout=120)
for name in ('test_closure', 'test_language', 'test_builtin', 'test_loop', 'test_bigint', 'test_cyclic_import', 'test_worker', 'test_rw_handler', 'test_intl'):
    flags = ['--std'] if name == 'test_builtin' else ['--experimental'] if name == 'test_intl' else []
    subprocess.run(command('qjs', *flags, 'tests/' + name + '.js'), check=True, timeout=120)
print('PASS standalone release tests: QuickJS regressions and test262 entry')
