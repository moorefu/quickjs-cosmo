"""Inspect real ELF/PE headers and APE boot headers without executing a payload."""
import hashlib
from pathlib import Path
import re
import struct
import zlib

MODERN = 0x101ca75
ARM64 = 183
AMD64 = 62


def digest(data):
    return hashlib.sha256(data).hexdigest()


def elf(header, image=None):
    image = header if image is None else image
    if len(header) < 64 or header[:7] != b'\x7fELF\x02\x01\x01':
        raise ValueError('Expected little-endian ELF64')
    fields = struct.unpack_from('<HHIQQQIHHHHHH', header, 16)
    kind, machine, version, entry, phoff, _, flags, size, stride, count, _, _, _ = fields
    if version != 1 or size != 64 or stride != 56 or not 0 < count <= 128 or phoff > len(image) or count * stride > len(image) - phoff:
        raise ValueError('Invalid ELF program-header range')
    loads = []
    for index in range(count):
        ptype, protection, offset, address, physical, filesz, memsz, alignment = struct.unpack_from('<IIQQQQQQ', image, phoff + index * stride)
        if ptype != 1:
            continue
        if filesz > memsz or offset > len(image) or filesz > len(image) - offset or address + memsz > 2**64 or alignment < 1 or alignment & (alignment - 1):
            raise ValueError('Invalid ELF LOAD segment')
        loads.append(dict(offset=offset, address=address, physical=physical, fileBytes=filesz, memoryBytes=memsz, flags=protection, alignment=alignment,
                          congruent64k=address % 65536 == offset % 65536))
    if not loads or not any(v['flags'] & 1 and v['address'] <= entry < v['address'] + v['memoryBytes'] for v in loads):
        raise ValueError('ELF entry is outside executable LOAD segments')
    return dict(type=kind, machine=machine, entry=entry, flags=flags, modern=flags & 0x1ffffff == MODERN, loads=loads,
                ready64k=all(v['alignment'] >= 65536 and v['congruent64k'] for v in loads))


def printf_bytes(value):
    output = bytearray()
    index = 0
    while index < len(value):
        if value[index] != 92:
            output.append(value[index]); index += 1
            continue
        index += 1
        match = re.match(rb'[0-7]{1,3}', value[index:])
        if match:
            # Shell printf emits the low byte, including octal values > 377.
            output.append(int(match[0], 8) & 255); index += len(match[0])
        elif index < len(value) and value[index] == 92:
            output.append(92); index += 1
        else:
            raise ValueError('Unsupported escape in APE ELF boot header')
    return bytes(output)


def pe(data):
    if len(data) < 64 or data[:2] != b'MZ':
        raise ValueError('Missing PE DOS header')
    offset = struct.unpack_from('<I', data, 60)[0]
    if offset > len(data) - 24 or data[offset:offset + 4] != b'PE\0\0':
        raise ValueError('Invalid PE header offset')
    machine, sections = struct.unpack_from('<HH', data, offset + 4)
    optional_size = struct.unpack_from('<H', data, offset + 20)[0]
    opt = offset + 24
    if not 0 < sections <= 96 or optional_size < 64 or opt + optional_size + sections * 40 > len(data) or struct.unpack_from('<H', data, opt)[0] != 0x20b:
        raise ValueError('Invalid PE32+ section table')
    entry = struct.unpack_from('<I', data, opt + 16)[0]
    segments = []
    for index in range(sections):
        start = opt + optional_size + index * 40
        memory, address, size, raw = struct.unpack_from('<IIII', data, start + 8)
        protection = struct.unpack_from('<I', data, start + 36)[0]
        if raw > len(data) or size > len(data) - raw:
            raise ValueError('PE raw section exceeds the file')
        segments.append(dict(address=address, memoryBytes=memory, offset=raw, fileBytes=size, flags=protection))
    if not any(v['flags'] & 0x20000000 and v['address'] <= entry < v['address'] + max(v['memoryBytes'], v['fileBytes']) for v in segments):
        raise ValueError('PE entry is outside executable sections')
    return dict(machine=machine, entry=entry, sections=segments)


def inspect(path, require_64k=True):
    data = Path(path).read_bytes()
    if data.startswith(b'\x7fELF'):
        result = dict(format='ELF', sha256=digest(data), elf=elf(data))
        if require_64k and result['elf']['machine'] == ARM64 and not result['elf']['ready64k']:
            raise ValueError('ARM64 ELF is not 64K aligned: ' + str(path))
        return result
    payloads = [elf(printf_bytes(m[1]), data) for m in re.finditer(rb"printf '([^']*)' >&7", data[:65536]) if m[1].startswith(b'\\177ELF')]
    if len(payloads) != 2 or {v['machine'] for v in payloads} != {AMD64, ARM64}:
        raise ValueError('APE must contain both decoded ELF boot headers')
    loaders = {}
    offset = 0
    while True:
        offset = data.find(b'\x1f\x8b\x08', offset)
        if offset < 0:
            break
        try:
            decoder = zlib.decompressobj(31)
            raw = decoder.decompress(data[offset:offset + 2 * 1024 * 1024], 4 * 1024 * 1024)
            if decoder.eof and raw.startswith(b'\x7fELF'):
                value = elf(raw)
                if value['machine'] in (AMD64, ARM64):
                    value.update(sha256=digest(raw), compressedOffset=offset)
                    key = value['machine']
                    if key in loaders and loaders[key]['sha256'] != value['sha256']:
                        raise ValueError('Conflicting embedded loaders')
                    loaders[key] = value
        except zlib.error:
            pass  # Other payload bytes may resemble gzip; required loaders remain mandatory.
        offset += 1
    if set(loaders) != {AMD64, ARM64}:
        raise ValueError('Missing required embedded loaders')
    native_pe = pe(data)
    if native_pe['machine'] != 0x8664:
        raise ValueError('APE Windows entry must be AMD64 (including emulation)')
    if require_64k and (any(not v['modern'] for v in payloads) or any(not v['ready64k'] for v in payloads if v['machine'] == ARM64) or not loaders[ARM64]['ready64k']):
        raise ValueError('APE boot flags, payload or embedded loader lack reviewed 64K layout: ' + str(path))
    return dict(format='APE', sha256=digest(data), pe=native_pe, payloads=payloads, loaders={str(k): v for k, v in loaders.items()})
