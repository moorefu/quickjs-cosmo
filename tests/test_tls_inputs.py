import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import build_tls


class TLSInputBoundary(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.source=self.root/'upstream';self.overlay=self.root/'build/native/tls/source';self.records=[];targets=[]
        digest=lambda data:hashlib.sha256(data).hexdigest()
        for name in ['config.h','sample.c']:
            relative='third_party/mbedtls/'+name;original=b'original '+name.encode();modified=b'patched '+name.encode()
            for folder,content in [(self.source,original),(self.overlay,modified)]:
                path=folder/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(content)
            self.records.append(dict(path=relative,sha256=digest(original)));targets.append(dict(path=relative,source_sha256=digest(original),patched_sha256=digest(modified)))
        for name,data in [('patches/tls.patch',b'patch'),('native/tls/ca.pem',b'CA'),('native/tls/LICENSE',b'license')]:
            path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        self.lock=dict(format=1,cosmopolitan_commit='pinned',candidate_only=True,source_cohort=self.records,
                       patch=dict(path='patches/tls.patch',sha256=digest(b'patch'),targets=targets),
                       ca=dict(path='native/tls/ca.pem',sha256=digest(b'CA'),license_path='native/tls/LICENSE',license_sha256=digest(b'license')))
        (self.root/'native/tls/security.json').write_text(json.dumps(self.lock))
        self.addCleanup(patch.stopall)
        patch.object(build_tls,'prepare_source',return_value=self.source).start()
        patch.object(build_tls,'load_config',return_value=SimpleNamespace(data={'cosmopolitan':{'commit':'pinned'}})).start()
    def prepare(self):return build_tls.prepare(self.root,offline=True)
    def test_verified_overlay_is_reused(self):self.assertEqual(self.prepare()[:2],(self.source,self.overlay))
    def test_changed_upstream_source_is_rejected(self):
        (self.source/self.records[0]['path']).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'source pin'):self.prepare()
    def test_unknown_overlay_header_cannot_shadow_source(self):
        (self.overlay/'third_party/mbedtls/unknown.h').write_bytes(b'shadow')
        with self.assertRaisesRegex(ValueError,'shadow'):self.prepare()
    def test_mixed_overlay_is_rejected(self):
        (self.overlay/self.records[0]['path']).unlink()
        with self.assertRaisesRegex(ValueError,'Mixed'):self.prepare()
    def test_modified_patch_is_rejected(self):
        (self.root/'patches/tls.patch').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'patch pin'):self.prepare()
    def test_modified_ca_is_rejected(self):
        (self.root/'native/tls/ca.pem').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'CA pin'):self.prepare()
    def test_modified_license_is_rejected(self):
        (self.root/'native/tls/LICENSE').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'license pin'):self.prepare()


if __name__=='__main__':unittest.main()
