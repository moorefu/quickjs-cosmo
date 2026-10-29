import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build_config import load_config
from prepare_toolchain import inputs,role,validate_record


class ToolchainProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.settings=load_config()
        names=['bin/cosmocc','bin/apelink','bin/ape-aarch64.elf','bin/ape-x86_64.elf','include/stdio.h']
        names += [arch+'/lib/'+name for arch in ('aarch64-linux-cosmo','x86_64-linux-cosmo') for name in ('crt.o','libcosmo.a')]
        original={name:dict(bytes=1,sha256='a'*64) for name in names};installed=copy.deepcopy(original)
        for name in ('bin/cosmocc','bin/apelink','bin/ape-aarch64.elf'):installed[name]['sha256']='b'*64
        roles={}
        for name in installed:roles.setdefault(role(name),[]).append(name)
        self.record=dict(inputs=inputs(self.settings),original=original,installed=installed,roles=roles,
            commands=[dict(argv=['build-pinned-override'])],changes={name:dict(before=original[name],after=v) for name,v in installed.items() if original[name]!=v})

    def test_matching_cross_host_attestation(self):
        self.record['inputs']['host']={'system':'Linux','machine':'x86_64'}
        validate_record(self.settings,self.record)

    def test_source_changed_after_build(self):
        self.record['inputs']['files']['compat/patches/apelink-64k.patch']='c'*64
        with self.assertRaisesRegex(ValueError,'maintained inputs'):validate_record(self.settings,self.record)

    def test_missing_crt_or_compiler_is_not_complete(self):
        for name in ('aarch64-linux-cosmo/lib/crt.o','bin/cosmocc'):
            record=copy.deepcopy(self.record);del record['installed'][name]
            with self.subTest(name=name),self.assertRaises(ValueError):validate_record(self.settings,record)

    def test_stale_precompiled_linker_is_not_an_override(self):
        self.record['installed']['bin/apelink']=self.record['original']['bin/apelink']
        self.record['changes'].pop('bin/apelink')
        with self.assertRaisesRegex(ValueError,'overrides'):validate_record(self.settings,self.record)


if __name__=='__main__':unittest.main()
