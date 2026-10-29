#!/usr/bin/env python3
"""Link the admitted compression subset into a private dual-architecture object."""
import json
import os

from build_config import load_config
from build_native import architecture_peer, elf_machine, run
from node_contract import ROOT, read_json
from prepare_native import sha256

ROOT_SYMBOL = 'js_cosmo_compression_api'


def build(root=ROOT):
    settings = load_config()
    os.environ['SOURCE_DATE_EPOCH'] = str(settings.source_epoch)
    backend = root / 'build/native/backends'
    manifest = read_json(backend / 'build.json')
    for name, record in manifest['files'].items():
        if sha256(backend / name) != record['sha256']:
            raise ValueError('Compression input changed: ' + name)
    included = {}
    for library in manifest['libraries']:
        for record in library['sources']:
            if record['path'] in ('third_party/bzip2/huffman.c', 'third_party/bzip2/blocksort.c'):
                digest = sha256(settings.native_source / record['path'])
                if digest != record['sha256']:
                    raise ValueError('Bzip2 workspace source pin mismatch: ' + record['path'])
                included[record['path']] = digest
    if len(included) != 2:
        raise ValueError('Missing pinned bzip2 workspace translation units')
    output = root / 'build/native/compression'
    output.mkdir(parents=True, exist_ok=True)
    objects, commands = [], []
    full = settings.runtime_profile == 'full'
    names = ('allocator', 'core', 'stream', 'binding') + (('bzip2-huffman', 'bzip2-blocksort') if full else ())
    for name in names:
        target = output / (name + '.o')
        command = [settings.toolchain / 'bin/cosmocc', '-std=gnu23', '-D_COSMO_SOURCE', '-D_GNU_SOURCE',
                   '-DBZ_NO_STDIO', '-DQJS_COMPRESSION_FULL=' + str(int(full)), '-O2', '-Wall', '-Werror=implicit-function-declaration',
                   '-ffunction-sections', '-fdata-sections', '-ffile-prefix-map=' + str(root) + '=.',
                   '-I' + str(settings.build), '-I' + str(settings.native_source),
                   '-c', root / 'native/compression' / (name + '.c'), '-o', target]
        diagnostics = run(command, root)
        commands.append(dict(command=list(map(str, command)), diagnostics=diagnostics))
        objects.append(target)
    reports = {}
    for arch, machine in (('x86_64', 62), ('aarch64', 183)):
        peer = architecture_peer if arch == 'aarch64' else lambda value: value
        tools = settings.toolchain / 'bin' / (arch + '-linux-cosmo-')
        target = peer(output / 'qjs-compression.o')
        target.parent.mkdir(parents=True, exist_ok=True)
        command = [str(tools) + 'ld', '-r', '--gc-sections', '-u', ROOT_SYMBOL,
                   '--wrap=malloc', '--wrap=calloc', '--wrap=realloc', '--wrap=free', '-o', target,
                   *map(peer, objects), '--start-group',
                   *[peer(backend / name) for name in (('zstd.a', 'lz4-frame.a', 'bzip2.a') if full else ())], '--end-group']
        run(command, root)
        commands.append(dict(command=list(map(str, command))))
        command = [str(tools) + 'objcopy', '-G', ROOT_SYMBOL, '--strip-unneeded', target]
        run(command, root)
        commands.append(dict(command=list(map(str, command))))
        elf_machine(target, machine)
        definitions = run([str(tools) + 'nm', '-g', '--defined-only', '-P', target], root).splitlines()
        if [line.split()[0] for line in definitions] != [ROOT_SYMBOL]:
            raise ValueError('Compression closure leaks backend definitions: ' + str(definitions))
        symbols = run([str(tools) + 'nm', '-P', target], root)
        if not full and any(token in symbols for token in ('ZSTD_', 'LZ4_', 'LZ4F_', 'BZ2_')):
            raise ValueError('Optional compression implementation survived in base')
        if any(token in symbols for token in ('BZ2_bzReadOpen', 'BZ2_bzWriteOpen', ' LZ4IO_', ' main ')):
            raise ValueError('CLI or file interfaces survived compression closure')
        undefined = run([str(tools) + 'nm', '-u', '-P', target], root).splitlines()
        if any(line.split()[0] in {'malloc', 'calloc', 'realloc', 'free', '_gc_free', '__defer'} for line in undefined):
            raise ValueError('Compression closure bypasses the runtime allocator')
        reports[arch] = dict(elf_machine=machine, sha256=sha256(target), exported=[ROOT_SYMBOL], undefined=undefined)
    sources = ['native/compression/' + name for name in ('core.c', 'core.h', 'stream.c', 'stream.h', 'stream-binding.h', 'binding.c', 'binding.h', 'allocator.c',
        'bzip2-huffman.c', 'bzip2-blocksort.c', 'bzip2-workspace.h')]
    sources += ['scripts/build_compression.py', 'native/build-inputs.json', 'native/tasks.h']
    (output / 'build.json').write_text(json.dumps(dict(format=1, profile=settings.runtime_profile,
        inputs={name: sha256(root / name) for name in sources}, backend_fingerprint=manifest['fingerprint'],
        architectures=reports, commands=commands, included_sources=included,
        linked_backends=['zlib']+(['zstd','lz4','bzip2'] if full else []),
        scope='Private profile-specific compression closure; no CLI'),
        indent=2) + '\n', encoding='utf-8')
    print('PASS compression SDK closure: x86_64/aarch64, private backends, quota allocators')


if __name__ == '__main__':
    build()
