"""Exercise the real provider using damaged copies of a linked SDK APE."""
import os
from contextlib import contextmanager
import struct
from pathlib import Path
import tempfile
import time
import warnings
import zipfile

from runtime_resources import CORE, CA, CAPABILITIES, MANIFEST, LIMITS


@contextmanager
def probe_directory(root):
    temporary = tempfile.TemporaryDirectory(prefix='resource-faults-', dir=root / 'build')
    try:
        yield Path(temporary.name)
    finally:
        # Windows ARM's x64 emulator may retain an exited image briefly. Every
        # case has a new pathname; cleanup still must succeed within the bound.
        deadline = time.monotonic() + 15
        while True:
            try:
                temporary.cleanup()
                break
            except PermissionError:
                if os.name != 'nt' or time.monotonic() >= deadline:
                    raise
                time.sleep(0.1)


def expected_cases():
    cases = []
    for name in (CORE, CA, CAPABILITIES, MANIFEST):
        modes = ['missing', 'format', 'integrity', 'too-large'] + (['format'] if name == MANIFEST else []) + ['format']
        cases.extend('resource-' + name.rsplit('/', 1)[-1] + '-' + mode + '-' + str(index) for index, mode in enumerate(modes))
    return cases + ['resource-non-zip', 'resource-COSMOPOLITAN_INIT_ZIPOS', 'resource-COSMOPOLITAN_DISABLE_ZIPOS',
                    'resource-js-missing', 'resource-js-integrity', 'resource-local-too-large',
                    'resource-local-mismatch', 'resource-deflate-corrupt']


def rewrite_zip(source, target, member=None, data=None, duplicate=False, strip=False):
    with zipfile.ZipFile(source) as archive:
        entries = [(entry, archive.read(entry)) for entry in archive.infolist()]
        prefix = source.read_bytes()[:min(entry.header_offset for entry, _ in entries)]
    # Never overwrite an executable that a previous case has run.
    with target.open('xb') as output:
        output.write(prefix)
    if not strip:
        with zipfile.ZipFile(target, 'a', zipfile.ZIP_DEFLATED) as archive:
            for entry, content in entries:
                if entry.filename != member or duplicate:
                    archive.writestr(entry, content)
            if data is not None:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    archive.writestr(member, data)
    target.chmod(0o755)


def validate(settings, sdk, execute):
    root = settings.root
    records = []
    with probe_directory(root) as directory:
        with zipfile.ZipFile(sdk) as archive:
            original = {name: archive.read(name) for name in (CORE, CA, CAPABILITIES, MANIFEST)}
        for name, content in original.items():
            cases = [('missing', None), ('format', b'\0' + content[1:]),
                     ('integrity', b'X' + content[1:]), ('too-large', b'x' * (LIMITS[name] + 1))]
            if name == MANIFEST:
                start = content.index(b'"sha256":"') + len(b'"sha256":"')
                cases[2] = ('integrity', content[:start] + (b'0' if content[start:start+1] != b'0' else b'1') + content[start+1:])
                cases.append(('format', b'{}\n'))
            cases.append(('format', content))
            for index, (mode, changed) in enumerate(cases):
                entry = 'resource-' + name.rsplit('/', 1)[-1] + '-' + mode + '-' + str(index)
                target = directory / (entry + '.exe')
                rewrite_zip(sdk, target, name, changed, duplicate=index == len(cases) - 1)
                execute(target, [mode, name, 'unused'], entry)
                records.append(entry)
        target = directory / 'resource-non-zip.exe'
        rewrite_zip(sdk, target, strip=True)
        execute(target, ['unavailable', CORE, 'unused'], 'resource-non-zip')
        records.append('resource-non-zip')
        for variable, value in (('COSMOPOLITAN_INIT_ZIPOS', str(sdk)), ('COSMOPOLITAN_DISABLE_ZIPOS', '1')):
            environment = {**os.environ, variable: value}
            entry = 'resource-' + variable
            execute(sdk, ['unavailable', CA, 'unused'], entry, environment)
            records.append(entry)
        source = directory / 'diagnostic.mjs'
        for mode, changed in (('missing', None), ('integrity', b'{}\n')):
            code = 'ERR_RESOURCE_' + mode.upper()
            source.write_text("import {runtimeInfo} from 'cosmo:runtime';\n"
                              "try { runtimeInfo(); throw Error('resource unexpectedly accepted'); } catch(error) {\n"
                              "if(error.code!==" + repr(code) + "||!error.message.includes('capabilities.json'))throw error;\n"
                              "print('PASS JS resource diagnostics'); }\n", encoding='utf8')
            entry = 'resource-js-' + mode
            target = directory / (entry + '.exe')
            rewrite_zip(settings.dist / 'qjs.exe', target, CAPABILITIES, changed)
            execute(target, ['-m', source], entry)
            records.append(entry)
        for mode in ('local-too-large', 'local-mismatch', 'deflate-corrupt'):
            entry = 'resource-' + mode
            target = directory / (entry + '.exe')
            rewrite_zip(sdk, target)
            with zipfile.ZipFile(target) as archive:
                info = archive.getinfo(CA)
            raw = bytearray(target.read_bytes())
            offset = info.header_offset
            if mode == 'deflate-corrupt':
                start = offset + 30 + struct.unpack_from('<H', raw, offset + 26)[0] + struct.unpack_from('<H', raw, offset + 28)[0]
                raw[start:start + 8] = b'\xff' * 8
                expected = 'io'
            else:
                size = LIMITS[CA] + 1 if mode == 'local-too-large' else info.file_size - 1
                struct.pack_into('<I', raw, offset + 22, size)
                expected = 'too-large' if mode == 'local-too-large' else 'format'
            target.write_bytes(raw)
            execute(target, [expected, CA, 'unused'], entry)
            records.append(entry)
    if records != expected_cases():
        raise ValueError('Incomplete resource fault coverage')
    return records
