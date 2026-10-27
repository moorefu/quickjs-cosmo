"""Reject stale, nonportable or incomplete native build evidence."""
import copy
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build_native
import native_provenance
from prepare_native import sha256


class NativeInputsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'native').mkdir()
        self.source = self.root / 'source'
        self.source.mkdir()
        (self.source / 'hash.c').write_text('source')
        (self.source / 'LICENSE').write_text('license')
        self.config = dict(format=1, common_flags=['-O2'], libraries=[dict(
            id='hash', export_to_sdk=False, flags=[], license_files=['LICENSE'],
            sources=[dict(path='hash.c', sha256=sha256(self.source / 'hash.c'), flags=[])])])

    def load(self):
        (self.root / 'native/build-inputs.json').write_text(json.dumps(self.config))
        return build_native.load_inputs(self.root, self.source)

    def test_pin_mismatch_is_rejected(self):
        self.load()
        (self.source / 'hash.c').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'pin mismatch'): self.load()

    def test_same_stem_in_different_directories_is_rejected(self):
        (self.source / 'other').mkdir()
        (self.source / 'other/hash.c').write_text('source')
        entry = copy.deepcopy(self.config['libraries'][0]['sources'][0])
        entry['path'] = 'other/hash.c'
        self.config['libraries'][0]['sources'].append(entry)
        with self.assertRaisesRegex(ValueError, 'collision'): self.load()

    def test_host_cpu_flags_and_unreviewed_sdk_delivery_are_rejected(self):
        self.config['common_flags'].append('-march=native')
        with self.assertRaisesRegex(ValueError, 'nonportable'): self.load()
        self.config['common_flags'].pop()
        self.config['libraries'][0]['export_to_sdk'] = True
        with self.assertRaisesRegex(ValueError, 'private'): self.load()

    def test_wrong_cpu_or_truncated_elf_is_rejected(self):
        path = self.root / 'object.o'
        header = bytearray(20); header[:6] = b'\x7fELF\x02\x01'
        struct.pack_into('<H', header, 18, 62)
        path.write_bytes(header)
        build_native.elf_machine(path, 62)
        with self.assertRaisesRegex(ValueError, 'architecture'): build_native.elf_machine(path, 183)
        path.write_bytes(header[:19])
        with self.assertRaisesRegex(ValueError, 'architecture'): build_native.elf_machine(path, 62)

    def test_duplicate_or_out_of_scope_symbols_are_rejected(self):
        settings = SimpleNamespace(toolchain=self.root)
        with mock.patch.object(build_native, 'run', return_value='mbedtls_ssl_init T 0 1'):
            with self.assertRaisesRegex(ValueError, 'TLS'):
                build_native.audit_symbols(settings, self.root, self.root, ['one.a'])
        with mock.patch.object(build_native, 'run', return_value='duplicate T 0 1'):
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                build_native.audit_symbols(settings, self.root, self.root, ['one.a', 'two.a'])

    def test_missing_source_or_arm_evidence_is_rejected(self):
        binary = self.root / 'probe.exe'; binary.write_bytes(b'APE')
        data = dict(cosmopolitan=dict(commit='fixed'))
        settings = SimpleNamespace(root=self.root, data=data)
        expected = {'source.c': 'a' * 64}
        value = dict(binary_sha256=sha256(binary), toolchain=data['cosmopolitan'], sources={}, slices={})
        stamp = binary.with_name(binary.name + '.build.json')
        with mock.patch.object(native_provenance, 'source_names', return_value=expected.keys()), \
             mock.patch.object(native_provenance, 'sha256', side_effect=lambda path: sha256(path) if path == binary else 'a' * 64):
            stamp.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, 'source inventory'):
                native_provenance.verify_probe(settings, binary)
            value['sources'] = expected
            value['slices'] = {'.com.dbg': dict(elf_machine=62, sha256='b' * 64)}
            stamp.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, 'architecture'):
                native_provenance.verify_probe(settings, binary)


if __name__ == '__main__':
    unittest.main()
