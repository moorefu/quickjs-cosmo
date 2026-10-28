"""Vendored crypto inputs must retain their exact bytes and closed inventory."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from build_crypto_extra import verify_sources


class ExtraSourcePins(unittest.TestCase):
    def setUp(self):
        directory=tempfile.TemporaryDirectory();self.addCleanup(directory.cleanup)
        self.root=Path(directory.name)
        self.source=self.root/'native/vendor/haclstar-0.3/input.c'
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(b'/* pinned original */\r\n')
        lock=dict(format=1,commit='b5343363688fbe0e3cdc0c488188708f09eb8a14',files=[
            dict(path=self.source.relative_to(self.root).as_posix(),sha256=hashlib.sha256(self.source.read_bytes()).hexdigest())])
        (self.root/'native/haclstar-extra.json').write_text(json.dumps(lock),encoding='utf-8')

    def test_exact_input(self):
        files,_=verify_sources(self.root)
        self.assertEqual(len(files),1)

    def test_newline_normalization_is_a_source_change(self):
        self.source.write_bytes(self.source.read_bytes().replace(b'\r\n',b'\n'))
        with self.assertRaisesRegex(ValueError,'pin mismatch'):verify_sources(self.root)

    def test_unlisted_config_is_rejected(self):
        self.source.with_name('config.h').write_text('#define NEW_BACKEND 1\n',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'inventory mismatch'):verify_sources(self.root)
