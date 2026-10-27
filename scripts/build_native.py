#!/usr/bin/env python3
"""Build private, checksum-locked Nightly algorithm archives for both APE CPUs."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess

from build_config import load_config
from node_contract import ROOT, checked_file, read_json
from prepare_native import prepare_source, sha256


def architecture_peer(path):
    return path.parent / '.aarch64' / path.name


def elf_machine(path, expected):
    with path.open('rb') as stream:
        header = stream.read(20)
    if len(header) != 20 or header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != expected:
        raise ValueError('Native object has the wrong ELF architecture: ' + str(path))


def load_inputs(root, source):
    config = read_json(root / 'native/build-inputs.json')
    if config.get('format') != 1 or not config.get('libraries'):
        raise ValueError('Invalid native build inventory')
    names = set()
    for library in config['libraries']:
        if not re.fullmatch(r'[a-z0-9-]+', library['id']) or library['id'] in names:
            raise ValueError('Invalid or duplicate native library id')
        names.add(library['id'])
        object_names = set()
        if library.get('export_to_sdk') is not False or not library['sources']:
            raise ValueError('M2-01 only permits private, nonempty candidate archives')
        for record in library['sources']:
            path = checked_file(source, record['path'])
            if path.suffix not in {'.c', '.S'} or not path.is_file() or sha256(path) != record['sha256']:
                raise ValueError('Native source pin mismatch: ' + record['path'])
            if path.stem in object_names:
                raise ValueError('Native object name collision: ' + record['path'])
            object_names.add(path.stem)
            flags = config['common_flags'] + library['flags'] + record['flags']
            if any(not isinstance(flag, str) or 'march=native' in flag for flag in flags):
                raise ValueError('Invalid/nonportable native compile flags')
        for name in library['license_files']:
            if not checked_file(source, name).is_file():
                raise ValueError('Missing native license source: ' + name)
    return config


def run(command, root, timeout=180):
    result = subprocess.run(list(map(str, command)), cwd=root, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace', timeout=timeout)
    if result.returncode:
        raise ValueError('Native command failed: ' + ' '.join(map(str, command)) + '\n' + result.stdout[-16000:])
    return result.stdout


def write_licenses(config, source, destination):
    sections = []
    for library in config['libraries'] + config.get('host_licenses', []):
        sections.append(library['id'] + ' (' + library['license'] + ')\n')
        for name in library['license_files']:
            content = (source / name).read_text(encoding='utf-8')
            if name.endswith(('.c', '.h')):
                end = content.find('*/')
                if not content.startswith('/*') or end < 0:
                    raise ValueError('Review native license header extraction: ' + name)
                content = content[:end + 2]
            sections.append(name + '\n' + content + '\n')
    destination.write_text('\n'.join(sections), encoding='utf-8')


def audit_symbols(settings, root, output, archives):
    required = {
        'mbedtls-core.a': {'mbedtls_md_info_from_type', 'mbedtls_md_setup', 'mbedtls_md_hmac', 'mbedtls_hkdf', 'mbedtls_pkcs5_pbkdf2_hmac'},
        'haclstar-blake2b.a': {'Hacl_Hash_Blake2b_hash_with_key', 'Hacl_Hash_Blake2b_copy', 'Hacl_Hash_Blake2b_free'},
        'mbedtls-aead.a': {'mbedtls_aes_setkey_enc', 'mbedtls_gcm_update', 'mbedtls_chachapoly_update'},
        'haclstar-25519.a': {'Hacl_Ed25519_sign', 'Hacl_Ed25519_verify', 'Hacl_Curve25519_ecdh'},
        'zstd.a': {'ZSTD_compress', 'ZSTD_decompress'},
        'lz4-frame.a': {'LZ4F_compressFrame', 'LZ4F_decompress'},
        'bzip2.a': {'BZ2_bzBuffToBuffCompress', 'BZ2_bzBuffToBuffDecompress'},
    }
    reports = {}
    for architecture in ('x86_64', 'aarch64'):
        definitions, libraries = {}, {}
        tool = settings.toolchain / 'bin' / (architecture + '-linux-cosmo-nm')
        for name in archives:
            archive = output / name
            if architecture == 'aarch64': archive = architecture_peer(archive)
            symbols = set()
            for line in run([tool, '-g', '--defined-only', '-P', archive], root).splitlines():
                parts = line.split()
                if len(parts) < 2 or parts[1] not in {'T', 'D', 'R', 'B', 'C', 'S', 'G'}: continue
                symbol = parts[0]
                if symbol == 'main' or symbol.startswith(('mbedtls_ssl_', 'mbedtls_x509_', 'mbedtls_rsa_', 'mbedtls_ecp_')):
                    raise ValueError('Unexpected CLI/TLS/general key symbol in private M2 cohort: ' + symbol)
                if symbol in definitions:
                    raise ValueError('Duplicate strong native symbol: ' + symbol)
                definitions[symbol] = name; symbols.add(symbol)
            if not required.get(name, set()).issubset(symbols):
                raise ValueError('Native archive is missing required ABI symbols: ' + name)
            libraries[name] = sorted(symbols)
        reports[architecture] = libraries
    return reports


def build(root=ROOT, offline=False, jobs=4):
    if os.name != 'posix':
        raise ValueError('Build native archives in WSL/Unix')
    settings = load_config()
    os.environ['SOURCE_DATE_EPOCH'] = str(settings.source_epoch)
    source = prepare_source(root, offline=offline)
    config = load_inputs(root, source)
    output = root / 'build/native/backends'
    if not output.resolve().is_relative_to(root.resolve()):
        raise ValueError('Native output escapes workspace')
    output.mkdir(parents=True, exist_ok=True)
    expected_files = {'LICENSES.txt'}
    for library in config['libraries']:
        for record in library['sources']:
            name = 'objects/' + library['id'] + '/' + Path(record['path']).stem + '.o'
            expected_files.update((name, str(Path(name).parent / '.aarch64' / Path(name).name)))
        expected_files.update((library['id'] + '.a', '.aarch64/' + library['id'] + '.a'))
    descriptor = dict(format=1, source=read_json(root / config['source_lock'])['cosmopolitan'],
                      toolchain=settings.data['cosmopolitan'], config_sha256=sha256(root / 'native/build-inputs.json'),
                      builder_sha256=sha256(root / 'scripts/build_native.py'), source_epoch=settings.source_epoch)
    fingerprint = hashlib.sha256(json.dumps(descriptor, sort_keys=True).encode()).hexdigest()
    manifest_path = output / 'build.json'
    if manifest_path.is_file():
        cached = read_json(manifest_path)
        if cached.get('fingerprint') == fingerprint and set(cached.get('files', {})) == expected_files and all(
                checked_file(output, name).is_file() and sha256(output / name) == record['sha256']
                for name, record in cached.get('files', {}).items()) and cached.get('files'):
            print('PASS native archives: verified cached dual-architecture build', flush=True)
            return output, cached
    commands = []
    libraries = {}
    for library in config['libraries']:
        objects = []
        for record in library['sources']:
            target = output / 'objects' / library['id'] / (Path(record['path']).stem + '.o')
            if not target.resolve().is_relative_to(output.resolve()):
                raise ValueError('Native object escapes output directory')
            if not architecture_peer(target).resolve().is_relative_to(output.resolve()):
                raise ValueError('Native architecture peer escapes output directory')
            target.parent.mkdir(parents=True, exist_ok=True)
            flags = config['common_flags'] + library['flags'] + record['flags']
            if record['path'].endswith('.S'):
                flags = [flag for flag in flags if not flag.startswith('-std=')]
            command = [settings.toolchain / 'bin/cosmocc', *flags, '-I' + str(source),
                       '-ffile-prefix-map=' + str(root) + '=.', '-c', source / record['path'], '-o', target]
            object_inputs = dict(source_sha256=record['sha256'], command=list(map(str, command)),
                                 source_archive=descriptor['source']['sha256'],
                                 toolchain=descriptor['toolchain'], source_epoch=settings.source_epoch)
            commands.append((record['path'], target, command, object_inputs))
            objects.append(target)
        libraries[library['id']] = objects
    def compile_one(item):
        name, target, command, inputs = item
        stamp = target.with_name(target.name + '.compile.json')
        cached = read_json(stamp) if stamp.is_file() else {}
        peer = architecture_peer(target)
        reuse = cached.get('inputs') == inputs and target.is_file() and peer.is_file()
        reuse = reuse and cached.get('x86_64_sha256') == sha256(target) and cached.get('aarch64_sha256') == sha256(peer)
        log = cached.get('diagnostics', '') if reuse else run(command, root)
        elf_machine(target, 62)
        elf_machine(peer, 183)
        stamp.write_text(json.dumps(dict(inputs=inputs, diagnostics=log, x86_64_sha256=sha256(target),
                                         aarch64_sha256=sha256(peer)), indent=2) + '\n', encoding='utf-8')
        print(('NATIVE_CACHED ' if reuse else 'NATIVE_OBJECT ') + name, flush=True)
        return dict(source=name, object=target.relative_to(output).as_posix(),
                    command=list(map(str, command)), diagnostics=log,
                    architectures={'x86_64': dict(elf_machine=62, sha256=sha256(target)),
                                   'aarch64': dict(elf_machine=183, sha256=sha256(architecture_peer(target)))})
    with ThreadPoolExecutor(max_workers=max(1, min(jobs, 16))) as pool:
        compiled = list(pool.map(compile_one, commands))
    archives = []
    for name, objects in libraries.items():
        archive = output / (name + '.a')
        # ar replaces members but does not remove dropped source files. Always
        # make a fresh archive, so shrinking a cohort cannot retain stale code.
        for path in (archive, architecture_peer(archive)):
            if not path.resolve().is_relative_to(output.resolve()):
                raise ValueError('Native archive escapes output directory')
            path.unlink(missing_ok=True)
        run([settings.toolchain / 'bin/cosmoar', 'rcsD', archive, *objects], root)
        for path in (archive, architecture_peer(archive)):
            if path.read_bytes()[:8] != b'!<arch>\n':
                raise ValueError('Missing native archive: ' + str(path))
        archives.append(name + '.a')
    symbols = audit_symbols(settings, root, output, archives)
    # Source preparation rechecks every selected member against the pinned tar.
    prepare_source(root, offline=True)
    write_licenses(config, source, output / 'LICENSES.txt')
    files = {}
    for name in sorted(expected_files):
        path = checked_file(output, name)
        files[name] = dict(bytes=path.stat().st_size, sha256=sha256(path))
    manifest = dict(fingerprint=fingerprint, inputs=descriptor, archives=archives,
                    libraries=config['libraries'], commands=compiled, files=files, symbols=symbols,
                    scope='private E1/E2 candidate archives; no new JS exports or SDK backend archive delivery')
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('PASS native archives: ' + ', '.join(archives), flush=True)
    return output, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--jobs', type=int, default=4)
    args = parser.parse_args()
    try:
        build(offline=args.offline, jobs=args.jobs)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
