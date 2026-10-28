import hashlib
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from prepare_native import fetch


class ResumablePinnedDownload(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.destination=Path(self.temp.name)/'input.tar.gz'
        self.partial=self.destination.with_suffix('.gz.part');self.payload=b'complete pinned input';self.digest=hashlib.sha256(self.payload).hexdigest()
        wait=patch('prepare_native.time.sleep');wait.start();self.addCleanup(wait.stop)
    def test_partial_timeout_resumes_without_discarding_bytes(self):
        calls=[]
        def curl(command):
            calls.append(command)
            if len(calls)==1:self.partial.write_bytes(self.payload[:8]);return subprocess.CompletedProcess(command,28)
            self.assertIn('--continue-at',command);self.assertEqual(self.partial.read_bytes(),self.payload[:8]);self.partial.write_bytes(self.payload)
            return subprocess.CompletedProcess(command,0)
        with patch('prepare_native.subprocess.run',side_effect=curl):fetch('https://example.invalid/input',self.destination,self.digest,False)
        self.assertEqual(self.destination.read_bytes(),self.payload);self.assertEqual(len(calls),2);self.assertFalse(self.partial.exists())
    def test_server_without_range_support_restarts_cleanly(self):
        self.partial.write_bytes(b'partial');calls=[]
        def curl(command):
            calls.append(command)
            if len(calls)==1:return subprocess.CompletedProcess(command,33)
            self.assertNotIn('--continue-at',command);self.assertFalse(self.partial.exists());self.partial.write_bytes(self.payload)
            return subprocess.CompletedProcess(command,0)
        with patch('prepare_native.subprocess.run',side_effect=curl):fetch('https://example.invalid/input',self.destination,self.digest,False)
        self.assertEqual(self.destination.read_bytes(),self.payload)
    def test_resumed_checksum_mismatch_never_promotes_input(self):
        def curl(command):self.partial.write_bytes(b'wrong bytes');return subprocess.CompletedProcess(command,0)
        with patch('prepare_native.subprocess.run',side_effect=curl),self.assertRaisesRegex(ValueError,'SHA-256 mismatch'):
            fetch('https://example.invalid/input',self.destination,self.digest,False)
        self.assertFalse(self.destination.exists());self.assertFalse(self.partial.exists())
    def test_retries_remain_bounded(self):
        with patch('prepare_native.subprocess.run',return_value=subprocess.CompletedProcess(['curl'],28)) as curl,self.assertRaises(subprocess.CalledProcessError):
            fetch('https://example.invalid/input',self.destination,self.digest,False)
        self.assertEqual(curl.call_count,4);self.assertFalse(self.destination.exists())


if __name__=='__main__':unittest.main()
