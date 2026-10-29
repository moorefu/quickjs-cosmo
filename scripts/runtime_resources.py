"""Canonical, bounded resources shared by every runtime and release entry."""
import hashlib
import json
import struct
import zipfile

from embed_js import generate
from runtime_capabilities import report
from runtime_profiles import selected_profile

PREFIX = '.quickjs-cosmo/'
CORE = PREFIX + 'runtime-core.js'
CA = PREFIX + 'ca-bundle.pem'
CAPABILITIES = PREFIX + 'capabilities.json'
MANIFEST = PREFIX + 'resource-manifest.json'
LIMITS = {CORE: 4 * 1024 * 1024, CA: 4 * 1024 * 1024,
          CAPABILITIES: 2 * 1024 * 1024, MANIFEST: 16 * 1024}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def resource_files(root, profile):
    files = {CORE: generate(root).encode('utf8'),
             CA: (root / 'native/tls/ca-bundle.pem').read_bytes(),
             CAPABILITIES: (json.dumps(report(root, profile), indent=2, ensure_ascii=True) + '\n').encode('utf8')}
    manifest = dict(format=1, resources=[dict(name=name, size=len(data), sha256=digest(data))
                                       for name, data in files.items()])
    files[MANIFEST] = (json.dumps(manifest, separators=(',', ':')) + '\n').encode('ascii')
    for name, data in files.items():
        if not data or len(data) > LIMITS[name] or b'\0' in data:
            raise ValueError('Invalid runtime resource: ' + name)
    return files


def validate_resources(binary, root, profile=None):
    with zipfile.ZipFile(binary) as archive, open(binary, 'rb') as raw:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        profile = selected_profile(profile)
        expected = resource_files(root, profile)
        for name, data in expected.items():
            if names.count(name) != 1 or archive.getinfo(name).file_size != len(data) or archive.read(name) != data:
                raise ValueError('Missing, duplicate or changed runtime resource: ' + name)
            info = archive.getinfo(name)
            raw.seek(info.header_offset)
            header = raw.read(30)
            if len(header) != 30:
                raise ValueError('Truncated resource ZIP header')
            magic, _, flags, method, _, _, crc, packed, size, name_size, extra_size = struct.unpack('<IHHHHHIIIHH', header)
            if (magic != 0x04034b50 or flags != info.flag_bits or flags & ~0x800 or method != info.compress_type or
                method not in (0, 8) or (crc, packed, size) != (info.CRC, info.compress_size, len(data)) or
                raw.read(name_size) != name.encode('ascii') or
                info.header_offset + 30 + name_size + extra_size + packed > archive.start_dir):
                raise ValueError('Resource local/central ZIP header mismatch: ' + name)
        if {name for name in names if name.startswith(PREFIX)} - set(expected) - {PREFIX + 'architecture'}:
            raise ValueError('Unexpected runtime resource')
        return {name: dict(bytes=len(data), sha256=digest(data), copies=1) for name, data in expected.items()}
