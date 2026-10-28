"""The host probe must reject agreement on an incorrect realpath."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import test_host_filesystem as driver

class HostIdentityTests(unittest.TestCase):
    def value(self,expected,actual):
        row={'input':str(expected),'expected':str(expected),'legacy':[str(actual),0],'sync':str(actual),'async':str(actual)}
        return dict(signalRoundTrip=True,main=dict(paths=[row],errors=[],files=[]),worker=dict(paths=[row],errors=[],files=[]))

    def test_wrong_shared_result_is_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);expected=root/'expected';actual=root/'other';expected.touch();actual.touch()
            run=subprocess.CompletedProcess([],0,'HOST_FILESYSTEM_RESULT '+json.dumps(self.value(expected,actual))+'\n','')
            with patch.object(driver.subprocess,'run',return_value=run),self.assertRaises(AssertionError):driver.observe([], {})

    def test_same_native_identity_is_accepted(self):
        with tempfile.TemporaryDirectory() as name:
            target=Path(name)/'identity';target.touch()
            run=subprocess.CompletedProcess([],0,'HOST_FILESYSTEM_RESULT '+json.dumps(self.value(target,target))+'\n','')
            with patch.object(driver.subprocess,'run',return_value=run):driver.observe([], {})

if __name__=='__main__':unittest.main()
