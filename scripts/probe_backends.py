#!/usr/bin/env python3
"""Run one dual-architecture E1/E2 backend probe against independent vectors."""
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import sys
import zlib

from build_config import load_config
from build_native import build, elf_machine, run
from native_provenance import source_names, verify_probe
from host_runtime import ape_command, host_info
from node_contract import ROOT, read_json
from prepare_native import sha256
from test_node_compat import run_command, write_report


def vectors():
    data = bytes((i * 131 + 7) & 255 for i in range(8193))
    expected = {name: hashlib.new(name, data).hexdigest() for name in ('md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512')}
    expected.update({
        'hmac-sha256': hmac.digest(b'\x0b' * 20, b'Hi There', 'sha256').hex(),
        # RFC 5869 Appendix A.1, independently fixed rather than reproducing C.
        'hkdf-sha256': '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
        'pbkdf2-sha256': hashlib.pbkdf2_hmac('sha256', b'password', b'salt', 2, 32).hex(),
        'blake2b512': hashlib.blake2b(data).hexdigest(),
        'blake2b256': hashlib.blake2b(data, digest_size=32).hexdigest(),
        'blake2b-keyed': hashlib.blake2b(data, key=bytes(range(32))).hexdigest(),
    })
    return expected, dict(crc32=zlib.crc32(data), adler32=zlib.adler32(data), crc32c=0xe3069283)


def compile_probe(settings, binary, offline):
    output, libraries = build(offline=offline)
    verification = run_command([sys.executable, ROOT / 'scripts/prepare_compat.py', '--offline'], ROOT, 30)
    if verification['failure'] or verification['exit_code']:
        raise ValueError(verification['stdout'] + verification['stderr'])
    source = ROOT / 'upstream' / ('cosmopolitan-native-' + settings.data['cosmopolitan']['commit'][:12])
    binary.parent.mkdir(parents=True, exist_ok=True)
    command = [settings.toolchain / 'bin/cosmocc', '-O2', '-std=gnu23', '-D_COSMO_SOURCE', '-D_GNU_SOURCE',
               '-DBZ_NO_STDIO', '-DQJS_COSMO_SIGPROC', '-Werror=implicit-function-declaration',
               '-I' + str(settings.build / 'compat-source'), '-I' + str(source),
               ROOT / 'native/probes/backends.c', ROOT / 'compat/host_exit.c', ROOT / 'compat/host_process.c',
               *[output / name for name in libraries['archives']], '-Wl,--wrap=_Exit,-u,__wrap__Exit', '-o', binary]
    run(command, ROOT, 180)
    slices = {}
    for suffix, machine in (('.com.dbg', 62), ('.aarch64.elf', 183)):
        path = binary.with_name(binary.name + suffix)
        elf_machine(path, machine)
        slices[suffix] = dict(elf_machine=machine, sha256=sha256(path))
    sources = sorted(source_names(True))
    provenance = dict(binary_sha256=sha256(binary), slices=slices, toolchain=settings.data['cosmopolitan'],
                      backend_build=libraries, command=list(map(str, command)),
                      sources={name: sha256(ROOT / name) for name in sources})
    binary.with_name(binary.name + '.build.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compile', action='store_true')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--binary', type=Path, default=ROOT / 'build/native/backends-probe.exe')
    args = parser.parse_args()
    settings = load_config()
    binary = args.binary.resolve()
    try:
        if args.compile:
            if os.name != 'posix':
                raise ValueError('Compile in WSL/Unix and run the same APE on other hosts')
            compile_probe(settings, binary, args.offline)
        provenance = verify_probe(settings, binary, True)
        process = run_command(ape_command(binary, [], settings.dist), ROOT, 60)
        records = [line[len('NATIVE_BACKEND_PROBE '):] for line in process['stdout'].splitlines() if line.startswith('NATIVE_BACKEND_PROBE ')]
        value = json.loads(records[0]) if len(records) == 1 else None
        expected, checksums = vectors()
        passed = not process['failure'] and process['exit_code'] == 0 and value is not None
        if passed:
            passed = value.get('vectors') == expected and all(value.get(key) == number for key, number in checksums.items())
            passed &= all(value.get(key) is True for key in ('selfTests', 'streamCopy', 'corruption', 'outputBounds', 'roundTrips'))
        report = dict(format=1, passed=passed, host=host_info(), build=provenance,
                      native_lock_sha256=sha256(ROOT / 'native/versions.json'), result=value, process=process,
                      scope='E1/E2 private library cohort; no JS binding, full format, TLS or SDK archive admission')
        path = ROOT / 'build/native' / ('backends-' + host_info()['system'] + '.json')
        write_report(path, report)
        print(('PASS ' if passed else 'FAIL ') + 'native-backend-probe; report: ' + str(path))
        if not passed:
            print(process['stdout'] + process['stderr'])
            if value:
                print('Vector differences: ' + ', '.join(key for key in expected if value.get('vectors', {}).get(key) != expected[key]))
        return int(not passed)
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    sys.exit(main())
