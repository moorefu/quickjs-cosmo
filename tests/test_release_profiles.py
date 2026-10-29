"""Profiles and release budgets must reject plausible but mismatched artifacts."""
import copy
import json
import io
from pathlib import Path
import sys
import tempfile
import tarfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from assemble_release import extract_zip
from build_config import load_config
from build_variants import CA_MEMBER,validate_ca,validate_architecture
import release_assets as assets
from runtime_capabilities import report
from runtime_profiles import declaration_files,selected_profile


class ReleaseProfileTests(unittest.TestCase):
    def test_source_archive_pin_is_required_before_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'.cache').mkdir();(root/'.cache/quickjs-source.tar.gz').write_bytes(b'changed')
            settings=SimpleNamespace(root=root,runtime_profile='base',data=load_config().data)
            with self.assertRaisesRegex(ValueError,'source archive hash'):assets.package_profile(settings,dict(version='2026-06-04'))

    def test_engine_version_must_match_the_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'.cache').mkdir();source=root/'.cache/quickjs-source.tar.gz'
            data=copy.deepcopy(load_config().data)
            with tarfile.open(source,'w:gz') as archive:
                content=b'2026-06-05\n';entry=tarfile.TarInfo('quickjs-'+data['quickjs']['commit']+'/VERSION');entry.size=len(content)
                archive.addfile(entry,io.BytesIO(content))
            data['quickjs']['sha256']=assets.digest(source.read_bytes())
            settings=SimpleNamespace(root=root,runtime_profile='base',data=data)
            with self.assertRaisesRegex(ValueError,'VERSION'):assets.package_profile(settings,dict(version='2026-06-04'))

    def test_profile_selection_is_closed(self):
        self.assertEqual(load_config(runtime_profile='base').runtime_profile,'base')
        self.assertNotEqual(load_config(runtime_profile='base').build,load_config(runtime_profile='full').build)
        with self.assertRaises(ValueError):selected_profile('minimal')

    def test_sdk_members_use_platform_independent_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'.aarch64').mkdir()
            for name in ('algorithms-async.d.ts','NATIVE-MODULES-LICENSES','.aarch64/libquickjs.a'):(root/name).write_bytes(b'data')
            files=assets.sdk_files(SimpleNamespace(dist=root))
            self.assertEqual([entry[0] for entry in files],['.aarch64/libquickjs.a','NATIVE-MODULES-LICENSES','algorithms-async.d.ts'])

    def test_base_removes_optional_exports_and_backends(self):
        base=report(ROOT,'base');full=report(ROOT,'full')
        self.assertEqual({v['id'] for v in full['backends']}-{v['id'] for v in base['backends']},{'zstd','lz4','bzip2','node-bzip2-workspace'})
        for module in base['modules']:
            if module['specifier'] in ('node:zlib','cosmo:compression'):
                self.assertFalse(any(any(token in entry['name'].lower() for token in ('zstd','lz4','bzip2')) for entry in module['entries']))

    def test_profile_declarations_have_no_optional_reference(self):
        base=declaration_files(ROOT,'base');full=declaration_files(ROOT,'full')
        self.assertNotIn('compression-full.d.ts',base)
        self.assertIn('compression-full.d.ts',full)
        self.assertNotIn(b'compression-full',base['node-compat.d.ts'])
        self.assertIn(b"profile:'base'",base['cosmo.d.ts'])
        self.assertIn(b"profile:'full'",full['cosmo.d.ts'])

    def test_missing_or_changed_shared_ca_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'runtime'
            for name,value in ((None,None),(CA_MEMBER,b'incorrect')):
                with zipfile.ZipFile(path,'w') as archive:
                    if name:archive.writestr(name,value)
                with self.assertRaisesRegex(ValueError,'shared CA'):validate_ca(path,ROOT)

    def test_zip_extraction_rejects_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'archive.zip'
            for name in ('../escape','/absolute','a\\b','C:host'):
                with zipfile.ZipFile(path,'w') as archive:
                    entry=zipfile.ZipInfo('placeholder');entry.filename=name;entry.orig_filename=name
                    archive.writestr(entry,b'data')
                with self.subTest(name=name),self.assertRaises(ValueError):extract_zip(path,root/'output')

    def test_architecture_resource_must_match(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'runtime'
            with zipfile.ZipFile(path,'w') as archive:archive.writestr('.quickjs-cosmo/architecture',b'arm64')
            validate_architecture(path,'arm64')
            for architecture in ('fat','x64'):
                with self.subTest(architecture=architecture),self.assertRaises(ValueError):validate_architecture(path,architecture)

    def test_release_names_cover_six_distinct_runtimes(self):
        names={assets.runtime_name('2026-06-04.1',profile,arch) for profile in ('base','full') for arch in ('fat','x64','arm64')}
        self.assertEqual(len(names),6)
        self.assertIn('quickjs-cosmo-2026-06-04.1.zip',names)
        self.assertIn('quickjs-cosmo-full-arm64-2026-06-04.1.zip',names)

    def test_runtime_rejects_wrong_capabilities_and_size(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);dist=root/'dist';dist.mkdir();releases=root/'releases';releases.mkdir()
            settings=SimpleNamespace(**{**vars(load_config()),'dist':dist,'releases':releases,'runtime_profile':'base','upstream_readme_bytes':b'upstream'})
            (dist/'qjs.exe').write_bytes(b'MZfake')
            for name in ('NODE-MODULES-LICENSE','NATIVE-MODULES-LICENSES'):(dist/name).write_bytes(b'license')
            capabilities=report(ROOT,'base');(dist/'capabilities.json').write_text(json.dumps(capabilities))
            archive=releases/assets.runtime_name('version','base','fat')
            files=[('readme.txt',assets.runtime_readme(settings,'version','fat'),0o664),('qjs',b'MZfake',0o755)]
            assets.write_zip(archive,files,(2026,6,4,0,0,0))
            layout=dict(payloads=[dict(machine=62,loads=[dict(offset=0,address=65536,fileBytes=6,memoryBytes=6,flags=5)])])
            with patch.object(assets,'inspect',return_value=layout),patch.object(assets,'validate_ca',return_value={}),patch.object(assets,'validate_architecture'):
                self.assertEqual(assets.verify_runtime(settings,'version','fat')['qjsBytes'],6)
                changed=copy.deepcopy(capabilities);changed['modules']=[]
                (dist/'capabilities.json').write_text(json.dumps(changed))
                with self.assertRaisesRegex(ValueError,'capability'):assets.verify_runtime(settings,'version','fat')
                (dist/'capabilities.json').write_text(json.dumps(capabilities))
                with patch.dict(assets.TARGETS,{('base','fat'):(-assets.MARGIN,0)}):
                    with self.assertRaisesRegex(ValueError,'budget'):assets.verify_runtime(settings,'version','fat')
