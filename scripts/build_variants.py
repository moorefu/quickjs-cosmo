#!/usr/bin/env python3
"""Relink single-CPU APEs from the exact ELF inputs used for the fat qjs."""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

from ape_layout import inspect
from build_config import load_config
from build_native import run
from prepare_native import sha256
from runtime_capabilities import report
from runtime_resources import validate_resources

CA_MEMBER = '.quickjs-cosmo/ca-bundle.pem'


def slice_segments(binary, payload):
    data=binary.read_bytes()
    return [{**{key:segment[key] for key in ('address','fileBytes','memoryBytes','flags')},
             'sha256':hashlib.sha256(data[segment['offset']:segment['offset']+segment['fileBytes']]).hexdigest()}
            for segment in payload['loads']]


def validate_ca(binary, root):
    with zipfile.ZipFile(binary) as archive:
        entries = [entry for entry in archive.infolist() if entry.filename == CA_MEMBER]
        if len(entries) != 1 or archive.read(entries[0]) != (root / 'native/tls/ca-bundle.pem').read_bytes():
            raise ValueError('Missing, duplicate or changed shared CA resource: ' + str(binary))
        return dict(member=CA_MEMBER, sha256=sha256(root / 'native/tls/ca-bundle.pem'),
                    bytes=entries[0].file_size, compressedBytes=entries[0].compress_size, copies=1)


def validate_architecture(binary, architecture):
    with zipfile.ZipFile(binary) as archive:
        entries=[entry for entry in archive.infolist() if entry.filename=='.quickjs-cosmo/architecture']
        if architecture=='fat':
            if entries:raise ValueError('Fat runtime has a single-CPU identity resource')
        elif len(entries)!=1 or archive.read(entries[0])!=architecture.encode('ascii'):
            raise ValueError('Missing or mismatched runtime architecture resource')


def validate_shell_bootstrap(binary, root):
    """Exercise the actual shell prologue before a native loader takes over."""
    with tempfile.TemporaryDirectory(prefix='ape-bootstrap-',dir=root/'build') as directory:
        loader=Path(directory)/'ape'
        loader.write_text('#!/bin/sh\nprintf "APE_BOOTSTRAP_OK:%s\\n" "$1"\n',encoding='ascii')
        loader.chmod(0o755)
        environment={**os.environ,'PATH':directory+os.pathsep+os.environ['PATH']}
        result=subprocess.run(['/bin/sh',str(binary),'--bootstrap-check'],env=environment,cwd=root,capture_output=True,timeout=30)
        if result.returncode or result.stdout!=('APE_BOOTSTRAP_OK:'+str(binary)+'\n').encode():
            raise ValueError('APE shell bootstrap failed: '+str(binary)+'\n'+result.stderr.decode('utf8',errors='replace'))


def build():
    settings = load_config()
    profile = settings.runtime_profile
    records = {}
    for architecture, cpu, suffix in (('x64', 'x86_64', '.com.dbg'), ('arm64', 'aarch64', '.aarch64.elf')):
        source = settings.build / ('qjs.exe' + suffix)
        directory = settings.dist / 'variants' / architecture
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / 'qjs.exe'
        command = [settings.toolchain / 'bin/apelink', '-s', '-V',
                   'linux+mac+bsd+windows' if architecture == 'x64' else 'linux+mac+bsd',
                   '-l', settings.toolchain / ('bin/ape-' + cpu + '.elf')]
        if architecture == 'arm64':
            # The pinned loaders recognize APEDBG=' but not apelink's unquoted
            # jartsr= prefix emitted when neither Windows nor metal is selected.
            command += ['-B', '-M', settings.toolchain / 'bin/ape-m1.c']
        command += ['-o', target, source]
        run(command, settings.root)
        # The immutable resource describes the release architecture to both
        # compiled CPU images. It is included before manifest hashes are made.
        with zipfile.ZipFile(target, 'a', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            entry = zipfile.ZipInfo('.quickjs-cosmo/architecture', (2026, 6, 4, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, architecture.encode('ascii'))
        target.chmod(0o755)
        layout = inspect(target, expected_architecture=architecture)
        validate_shell_bootstrap(target,settings.root)
        fat_layout=inspect(settings.dist/'qjs.exe')
        fat_payload=next(value for value in fat_layout['payloads'] if value['machine']==layout['payloads'][0]['machine'])
        segments=slice_segments(target,layout['payloads'][0])
        if segments!=slice_segments(settings.dist/'qjs.exe',fat_payload):
            raise ValueError('Single-CPU LOAD segments differ from the fat slice')
        ca = validate_ca(target, settings.root)
        resources = validate_resources(target, settings.root, profile)
        validate_architecture(target,architecture)
        capabilities = report(settings.root, profile)
        capabilities['architecture'] = architecture
        cap_path = directory / 'capabilities.json'
        cap_path.write_text(json.dumps(capabilities, indent=2) + '\n', encoding='utf8')
        record = dict(format=1, profile=profile, architecture=architecture,
                      qjs=dict(bytes=target.stat().st_size, sha256=sha256(target)),
                      capabilitiesSha256=sha256(cap_path), ca=ca, resources=resources, layout=layout, segments=segments,shellBootstrap=True,
                      fatLinkInput=dict(path=source.relative_to(settings.root).as_posix(), sha256=sha256(source)),
                      command=list(map(str, command)))
        (directory / 'manifest.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf8')
        records[architecture] = record
    validate_resources(settings.dist / 'qjs.exe', settings.root, profile)
    print('PASS runtime variants: ' + profile + ' x64/arm64, shared fat link inputs, one copy of each runtime resource')
    return records


if __name__ == '__main__':
    build()
