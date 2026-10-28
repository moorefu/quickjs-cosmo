#!/usr/bin/env python3
"""Build the SDK crypto closure, keeping only the QuickJS binding public."""
import json
import os
from pathlib import Path

from build_config import load_config
from build_native import architecture_peer, elf_machine, run
from node_contract import ROOT, read_json
from prepare_native import sha256
from build_crypto_extra import build as build_extra

ROOT_SYMBOL = 'js_cosmo_crypto_api'


def build(root=ROOT):
    settings = load_config()
    extra_archive=build_extra(root)
    os.environ['SOURCE_DATE_EPOCH'] = str(settings.source_epoch)
    backend = root / 'build/native/backends'
    manifest = read_json(backend / 'build.json')
    # This is called after build_native has verified the locked source cohort.
    for name, record in manifest['files'].items():
        if sha256(backend / name) != record['sha256']:
            raise ValueError('Crypto input archive/object changed: ' + name)
    output = root / 'build/native/crypto'
    output.mkdir(parents=True, exist_ok=True)
    objects, commands = [], []
    included = next(record for library in manifest['libraries'] for record in library['sources']
                    if record['path'] == 'third_party/mbedtls/pkcs5.c')
    if sha256(settings.native_source / included['path']) != included['sha256']:
        raise ValueError('PBKDF2 cancellation source pin mismatch')
    vendor=root/'native/vendor/haclstar-0.3'
    for name in ('core', 'extra', 'keys', 'aead', 'gcm-ecb', 'binding', 'pbkdf2'):
        target = output / (name + '.o')
        command = [settings.toolchain / 'bin/cosmocc', '-std=gnu23', '-D_COSMO_SOURCE', '-D_GNU_SOURCE',
                   '-O2', '-Wall', '-Werror=implicit-function-declaration', '-ffunction-sections', '-fdata-sections',
                   '-ffile-prefix-map=' + str(root) + '=.', '-I' + str(settings.build),
                   '-I' + str(settings.native_source), '-I'+str(vendor/'dist/gcc-compatible'),
                   '-I'+str(vendor/'dist/kremlin/include'),'-I'+str(vendor/'dist/kremlin/kremlib/dist/minimal'),
                   '-c', root / 'native/crypto' / (name + '.c'), '-o', target]
        diagnostics = run(command, root)
        commands.append(dict(command=list(map(str, command)), diagnostics=diagnostics))
        objects.append(target)
    reports = {}
    for arch, machine in (('x86_64', 62), ('aarch64', 183)):
        peer = architecture_peer if arch == 'aarch64' else lambda value: value
        tools = settings.toolchain / 'bin' / (arch + '-linux-cosmo-')
        target = peer(output / 'qjs-crypto.o')
        target.parent.mkdir(parents=True, exist_ok=True)
        command = [str(tools) + 'ld', '-r', '--gc-sections', '-u', ROOT_SYMBOL,
                   '-u', 'mbedtls_notice', '-u', 'hacl_star_notice',
                   '--wrap=malloc', '--wrap=calloc', '--wrap=free', '-o', target,
                   *map(peer, objects), '--start-group', peer(backend / 'mbedtls-core.a'),
                   peer(backend / 'haclstar-blake2b.a'), peer(backend / 'mbedtls-aead.a'), peer(backend / 'haclstar-25519.a'),peer(extra_archive), '--end-group']
        run(command, root)
        commands.append(dict(command=list(map(str, command))))
        command = [str(tools) + 'objcopy', '-G', ROOT_SYMBOL, '--strip-unneeded', target]
        run(command, root)
        commands.append(dict(command=list(map(str, command))))
        elf_machine(target, machine)
        definitions = run([str(tools) + 'nm', '-g', '--defined-only', '-P', target], root).splitlines()
        if [line.split()[0] for line in definitions] != [ROOT_SYMBOL]:
            raise ValueError('Crypto closure leaks public backend symbols: ' + str(definitions))
        symbols = run([str(tools) + 'nm', '-P', target], root)
        if any(token in symbols for token in ('mbedtls_ssl_', 'mbedtls_x509_', 'mbedtls_rsa_',
                'mbedtls_ecp_', 'mbedtls_pkcs5_pbes2', 'mbedtls_md_file')):
            raise ValueError('Unused general crypto code survived SDK closure')
        cipher_symbols = {line.split()[0] for line in symbols.splitlines() if line.startswith('mbedtls_cipher_')}
        if not cipher_symbols.issubset({'mbedtls_cipher_info_from_values', 'mbedtls_cipher_free',
                'mbedtls_cipher_setup', 'mbedtls_cipher_setkey', 'mbedtls_cipher_update'}):
            raise ValueError('General cipher API survived the AES-ECB bridge')
        if any(not any(line.startswith(notice + ' ') for line in symbols.splitlines())
               for notice in ('mbedtls_notice', 'hacl_star_notice')):
            raise ValueError('Crypto license notice was discarded')
        undefined = run([str(tools) + 'nm', '-u', '-P', target], root).splitlines()
        if any(line.split()[0].startswith(('mbedtls_', 'Hacl_', 'FStar_')) for line in undefined):
            raise ValueError('Unresolved private crypto backend dependency: ' + str(undefined))
        reports[arch] = dict(elf_machine=machine, sha256=sha256(target),
                             exported=[ROOT_SYMBOL], undefined=undefined)
    inputs = {name: sha256(root / name) for name in (
        'native/crypto/core.c', 'native/crypto/core.h', 'native/crypto/extra.c', 'native/crypto/extra.h', 'native/haclstar-extra.json', 'scripts/build_crypto_extra.py', 'native/crypto/binding.c',
        'native/crypto/binding.h', 'native/crypto/extended-binding.h', 'native/crypto/extended-async.h', 'native/crypto/keys.c', 'native/crypto/keys.h', 'native/crypto/aead.c', 'native/crypto/aead.h', 'native/crypto/gcm-ecb.c', 'native/crypto/pbkdf2.c', 'native/tasks.h', 'scripts/build_crypto.py', 'native/build-inputs.json')}
    (output / 'build.json').write_text(json.dumps(dict(format=1, inputs=inputs,
        backend_fingerprint=manifest['fingerprint'], architectures=reports, commands=commands,
        included_sources={included['path']:included['sha256']},
        scope='SDK binding only; backend symbols localized; unused PBES2, general cipher and file APIs removed; AES-ECB bridge is private'),
        indent=2) + '\n', encoding='utf-8')
    print('PASS crypto SDK closure: x86_64/aarch64, private backends, retained notices')


if __name__ == '__main__':
    build()
