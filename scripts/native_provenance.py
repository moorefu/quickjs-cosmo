"""Verify transported native probes without requiring a compiler or source tar."""
import re
import hashlib
from build_crypto_extra import license_text

from node_contract import read_json
from prepare_native import sha256


def source_names(backend):
    common = {'compat/host_exit.c', 'compat/host_process.c'}
    if backend:
        return common | {'native/probes/backends.c', 'native/build-inputs.json', 'scripts/build_native.py',
                         'scripts/probe_backends.py', 'compat/versions.json', 'native/versions.json',
                         'scripts/native_provenance.py', 'scripts/prepare_native.py',
                         'scripts/build_crypto_extra.py', 'native/haclstar-extra.json'}
    return common | {'native/probes/toolchain.c', 'scripts/probe_native.py', 'native/versions.json',
                     'scripts/native_provenance.py'}


def verify_probe(settings, binary, backend=False):
    root = settings.root
    value = read_json(binary.with_name(binary.name + '.build.json'))
    if value['binary_sha256'] != sha256(binary) or value['toolchain'] != settings.data['cosmopolitan']:
        raise ValueError('Native probe binary/toolchain mismatch')
    expected = {name: sha256(root / name) for name in source_names(backend)}
    if value.get('sources') != expected:
        raise ValueError('Native probe source inventory mismatch')
    slices = value.get('slices', {})
    if set(slices) != {'.com.dbg', '.aarch64.elf'} or any(
            slices[suffix].get('elf_machine') != machine or
            not re.fullmatch('[0-9a-f]{64}', slices[suffix].get('sha256', ''))
            for suffix, machine in (('.com.dbg', 62), ('.aarch64.elf', 183))):
        raise ValueError('Missing native probe architecture evidence')
    if backend:
        build = value['backend_build']
        inputs = build['inputs']
        config = read_json(root / 'native/build-inputs.json')
        lock = read_json(root / 'native/versions.json')
        if (inputs['source'] != lock['cosmopolitan'] or inputs['toolchain'] != settings.data['cosmopolitan'] or
                inputs['config_sha256'] != sha256(root / 'native/build-inputs.json') or
                inputs['builder_sha256'] != sha256(root / 'scripts/build_native.py') or
                build['libraries'] != config['libraries']):
            raise ValueError('Native backend build inputs mismatch')
        if set(build['symbols']) != {'x86_64', 'aarch64'}:
            raise ValueError('Missing native backend symbol audit')
        license_record=build['files']['LICENSES.txt']
        combined=(root/'dist/NATIVE-MODULES-LICENSES').read_bytes()
        original=combined[:license_record['bytes']]
        if (hashlib.sha256(original).hexdigest()!=license_record['sha256'] or
                combined[license_record['bytes']:]!=license_text(root).encode('utf-8')):
            raise ValueError('Native backend license mismatch')
    elif value['compatibility'] != read_json(root / 'compat/versions.json'):
        raise ValueError('Native toolchain probe compatibility mismatch')
    return value
