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
        links=[]
        for index in range(4):
            dangling=index==3;target=expected/'missing' if dangling else expected
            links.append(dict(name=str(expected.parent/('link'+str(index))),target=str(target),dangling=dangling,
                legacy=[dict(mode=0o120777),0],readlink=[str(target),0],
                stat=[None,2] if dangling else [dict(mode=0o40777),0],sync=[True,False,False],
                async_=[True,False,False],callback=[True,False,False],
                syncStat='ENOENT' if dangling else [False,False,True],asyncStat='ENOENT' if dangling else [False,False,True]))
            links[-1]['async']=links[-1].pop('async_')
        context=dict(paths=[row],errors=[],files=[],links=links,controls=[[False,True,False],[False,False,True]],module='junction module',chdir=str(expected))
        return dict(signalRoundTrip=True,main=context,worker=context)

    def test_wrong_shared_result_is_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);expected=root/'expected';actual=root/'other';expected.mkdir();actual.mkdir()
            run=subprocess.CompletedProcess([],0,'HOST_FILESYSTEM_RESULT '+json.dumps(self.value(expected,actual))+'\n','')
            with patch.object(driver.subprocess,'run',return_value=run),self.assertRaises(AssertionError):driver.observe([], {})

    def test_same_native_identity_is_accepted(self):
        with tempfile.TemporaryDirectory() as name:
            target=Path(name)/'identity';target.mkdir()
            run=subprocess.CompletedProcess([],0,'HOST_FILESYSTEM_RESULT '+json.dumps(self.value(target,target))+'\n','')
            with patch.object(driver.subprocess,'run',return_value=run):driver.observe([], {})

    def test_junction_reported_as_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as name:
            target=Path(name)/'identity';target.mkdir();value=self.value(target,target)
            value['main']['links'][0]['legacy'][0]['mode']=0o100777
            run=subprocess.CompletedProcess([],0,'HOST_FILESYSTEM_RESULT '+json.dumps(value)+'\n','')
            with patch.object(driver.subprocess,'run',return_value=run),self.assertRaises(AssertionError):driver.observe([], {})

    def test_target_parent_alias_uses_native_identity(self):
        with tempfile.TemporaryDirectory() as name:
            parent=Path(name);target=parent/'identity';target.mkdir();alias=parent/'alias-parent'
            value=self.value(target,target)
            for row in value['main']['links']:row['readlink'][0]=str(alias/Path(row['target']).relative_to(parent))
            samefile=driver.os.path.samefile
            def translate(path):
                value=Path(path)
                return parent/value.relative_to(alias) if value.is_relative_to(alias) else value
            run=subprocess.CompletedProcess([],0,'HOST_FILESYSTEM_RESULT '+json.dumps(value)+'\n','')
            with patch.object(driver.subprocess,'run',return_value=run),patch.object(driver.os.path,'samefile',side_effect=lambda a,b:samefile(translate(a),translate(b))):driver.observe([], {})

if __name__=='__main__':unittest.main()
