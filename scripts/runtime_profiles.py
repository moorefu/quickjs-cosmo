"""Shared, fail-closed runtime profile selection and capability projection."""
import os
from pathlib import Path

PROFILES = ('base', 'full')
OPTIONAL_BACKENDS = {'zstd', 'lz4', 'bzip2', 'node-bzip2-workspace'}


def selected_profile(value=None):
    value = value or os.environ.get('QUICKJS_COSMO_RUNTIME_PROFILE', 'base')
    if value not in PROFILES:
        raise ValueError('Runtime profile must be base or full')
    return value


def full_api(name):
    return any(token in name.lower() for token in ('zstd', 'lz4', 'bzip2'))


def project_inventory(inventory, profile):
    if selected_profile(profile) == 'full':
        return inventory
    import copy
    inventory = copy.deepcopy(inventory)
    excluded = {test['id'] for test in inventory['tests'] if profile not in test.get('profiles', PROFILES)}
    inventory['tests'] = [test for test in inventory['tests'] if test['id'] not in excluded]
    for module in inventory['modules']:
        if module['specifier'] in ('node:zlib', 'cosmo:compression'):
            module['entries'] = [entry for entry in module['entries'] if not full_api(entry['name'])]
            for entry in module['entries']:
                entry['tests'] = [name for name in entry['tests'] if name not in excluded]
                if module['specifier']=='node:zlib':
                    entry['parameters']=entry['parameters'].replace('; Zstd remains version-specific experimental API','')
                    entry['differences']=[text.replace('; nonzero Zstd nbWorkers remain unsupported.','.') for text in entry['differences']]
                else:
                    entry['parameters']=("name?: 'zlib'; returns linked codec metadata" if entry['name']=='codecInfo' else 'String or byte buffer; optional uint32 checksum seed')
                    entry['differences']=['Base compression extension exposes CRC32C, Adler32 and zlib metadata. Optional frame codecs require full.']
    return inventory


def declaration_files(root, profile, architecture='fat'):
    profile = selected_profile(profile)
    if architecture not in ('fat', 'x64', 'arm64'):
        raise ValueError('Unknown declaration architecture')
    files = {}
    for path in sorted((root / 'types').glob('*.d.ts')):
        if profile == 'base' and path.name == 'compression-full.d.ts':
            continue
        value = path.read_text(encoding='utf8')
        if path.name == 'node-compat.d.ts' and profile == 'base':
            value = value.replace('/// <reference path="./compression-full.d.ts" />\n', '')
        if path.name == 'cosmo.d.ts':
            value = value.replace("profile:'base'|'full'", "profile:'" + profile + "'")
            value = value.replace("architecture:'fat'|'x64'|'arm64'", "architecture:'" + architecture + "'")
        files[path.name] = value.encode('utf8')
    return files


def write_declarations(root, destination, profile, architecture='fat'):
    files = declaration_files(root, profile, architecture)
    for path in destination.glob('*.d.ts'):
        if path.name not in files:
            path.unlink()
    for name, content in files.items():
        (destination / name).write_bytes(content)


if __name__ == '__main__':
    from build_config import load_config
    settings = load_config()
    write_declarations(settings.root, settings.dist, settings.runtime_profile)
