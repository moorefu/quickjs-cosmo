"""Keep resource generation, manifest metadata and release scanning consistent."""
import hashlib
import json
import struct
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from runtime_resources import resource_files, validate_resources, CORE, CA, CAPABILITIES, MANIFEST
from runtime_capabilities import report
from test_resources import expected_cases
import test_resources as driver


class RuntimeResourceTests(unittest.TestCase):
    def test_windows_image_cleanup_is_retried_but_never_ignored(self):
        temporary = Mock(name='temporary')
        temporary.name = 'resource-probes'
        temporary.cleanup.side_effect = [PermissionError('image busy'), None]
        with patch.object(driver.tempfile, 'TemporaryDirectory', return_value=temporary), \
             patch.object(driver, 'os', SimpleNamespace(name='nt')), \
             patch.object(driver.time, 'sleep') as sleep:
            with driver.probe_directory(ROOT): pass
            self.assertEqual(temporary.cleanup.call_count, 2)
            sleep.assert_called_once_with(0.1)
        temporary.cleanup.side_effect = PermissionError('still busy')
        with patch.object(driver.tempfile, 'TemporaryDirectory', return_value=temporary), \
             patch.object(driver, 'os', SimpleNamespace(name='nt')), \
             patch.object(driver.time, 'monotonic', side_effect=[0, 16]):
            with self.assertRaisesRegex(PermissionError, 'still busy'):
                with driver.probe_directory(ROOT): pass

    def test_fault_images_are_created_exclusively(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.exe'
            target = Path(directory) / 'probe.exe'
            with zipfile.ZipFile(source, 'w') as archive: archive.writestr('member', b'data')
            driver.rewrite_zip(source, target)
            original = target.read_bytes()
            with self.assertRaises(FileExistsError): driver.rewrite_zip(source, target)
            self.assertEqual(target.read_bytes(), original)

    def test_local_header_size_is_checked_independently(self):
        files = resource_files(ROOT, 'base')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'runtime'
            with zipfile.ZipFile(path, 'w') as archive:
                for name, data in files.items(): archive.writestr(name, data)
            with zipfile.ZipFile(path) as archive: offset = archive.getinfo(CA).header_offset
            raw = bytearray(path.read_bytes())
            struct.pack_into('<I', raw, offset + 22, len(files[CA]) + 1)
            path.write_bytes(raw)
            with self.assertRaisesRegex(ValueError, 'local/central'):
                validate_resources(path, ROOT, 'base')

    def test_canonical_repeated_generation_and_profile_identity(self):
        for profile in ('base', 'full'):
            files = resource_files(ROOT, profile)
            self.assertEqual(files, resource_files(ROOT, profile))
            self.assertTrue(files[CORE].startswith(b'(function(native, data)'))
            self.assertEqual(json.loads(files[CAPABILITIES]), report(ROOT, profile))
            manifest = json.loads(files[MANIFEST])
            self.assertEqual(manifest['format'], 1)
            self.assertEqual([row['name'] for row in manifest['resources']], [CORE, CA, CAPABILITIES])
            for row in manifest['resources']:
                self.assertEqual(row['size'], len(files[row['name']]))
                self.assertEqual(row['sha256'], hashlib.sha256(files[row['name']]).hexdigest())

    def test_packaging_rejects_missing_changed_duplicate_and_extra_members(self):
        files = resource_files(ROOT, 'base')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'runtime'
            cases = [list(files.items())]
            for name in files:
                cases.extend([[(key, data) for key, data in files.items() if key != name],
                              [(key, b'changed' if key == name else data) for key, data in files.items()],
                              [*files.items(), (name, files[name])]])
            cases.append([*files.items(), ('.quickjs-cosmo/unreviewed', b'bad')])
            for index, contents in enumerate(cases):
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    with zipfile.ZipFile(path, 'w') as archive:
                        for name, data in contents:
                            archive.writestr(name, data)
                if not index:
                    result = validate_resources(path, ROOT, 'base')
                    self.assertTrue(all(row['copies'] == 1 for row in result.values()))
                    with self.assertRaises(ValueError): validate_resources(path, ROOT, 'full')
                else:
                    with self.subTest(index=index), self.assertRaises(ValueError):
                        validate_resources(path, ROOT, 'base')

    def test_fault_evidence_requires_every_resource_and_failure(self):
        cases = expected_cases()
        self.assertEqual(len(cases), 29)
        self.assertEqual(len(cases), len(set(cases)))
        for name in (CORE, CA, CAPABILITIES, MANIFEST):
            for mode in ('missing', 'format', 'integrity', 'too-large'):
                self.assertTrue(any(case.startswith('resource-' + name.rsplit('/', 1)[-1] + '-' + mode) for case in cases))
