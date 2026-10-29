#!/usr/bin/env python3
"""Native identity/attributes/startup checks for source, Worker, qjsc and SDK."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
from host_runtime import ape_command

ROOT=Path(__file__).resolve().parents[1]
FIXTURE=ROOT/'tests/runtime_host_filesystem.mjs'

def native_path(name):
    if os.name=='nt':
        name=re.sub(r'^/([A-Za-z])(?=/|$)',r'\1:',name)
        if len(name)==2 and name[1]==':':name+='\\'
    return name

def setup(root):
    links=[]
    for label in ('main','worker'):
        directory=root/label;target=directory/'real';target.mkdir(parents=True)
        unicode=directory/'目标 空格';unicode.mkdir()
        for link,target in ((directory/'linked',target),(directory/'联接 空格',unicode),
                            (directory/'chain',directory/'linked'),(directory/'dangling',directory/'missing-junction-target')):
            if os.name=='nt':
                run=subprocess.run(['cmd','/d','/c','mklink','/J',str(link),str(target)],capture_output=True,timeout=15)
                assert run.returncode==0,run.stderr
                native=link.lstat();assert native.st_file_attributes&0x400 and native.st_reparse_tag==0xa0000003,link
            else:link.symlink_to(target,target_is_directory=True)
            links.append(link)
    return links

def attributes(path,value):
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.SetFileAttributesW.argtypes=[ctypes.c_wchar_p,ctypes.c_uint32]
    if not kernel.SetFileAttributesW(str(path),value):raise ctypes.WinError(ctypes.get_last_error())

def observe(command,environment):
    run=subprocess.run(command,env=environment,cwd=ROOT,capture_output=True,text=True,encoding='utf8',errors='replace',timeout=30)
    assert run.returncode==0,(run.returncode,run.stdout,run.stderr)
    lines=[line.removeprefix('HOST_FILESYSTEM_RESULT ') for line in run.stdout.splitlines() if line.startswith('HOST_FILESYSTEM_RESULT ')]
    assert len(lines)==1,run.stdout
    value=json.loads(lines[0])
    assert value['signalRoundTrip'] is True,'Logical PID namespace changed'
    for context in ('main','worker'):
        for row in value[context]['paths']:
            assert row['legacy'][1]==0 and 'sync' in row and 'async' in row,row
            for result in (row['legacy'][0],row['sync'],row['async']):assert os.path.samefile(native_path(result),row['expected']),row
        for row in value[context]['errors']:
            assert row['legacy'][1]!=0 and row['sync']==row['expected'] and row['async']==row['expected'],row
        assert len(value[context]['links'])==4,'Missing junction/symlink fixtures'
        for row in value[context]['links']:
            assert row['legacy'][1]==0 and stat.S_ISLNK(row['legacy'][0]['mode']),row
            assert row['sync']==row['async']==row['callback']==[True,False,False],row
            assert row['readlink'][1]==0,row
            actual=os.path.normcase(os.path.normpath(native_path(row['readlink'][0])))
            expected=os.path.normcase(os.path.normpath(row['target']))
            assert actual==expected,row
            if row['dangling']:
                assert row['stat'][1]!=0 and row['syncStat']==row['asyncStat']=='ENOENT',row
                assert not Path(row['target']).exists(),row
            else:
                assert row['stat'][1]==0 and stat.S_ISDIR(row['stat'][0]['mode']),row
                assert row['syncStat']==row['asyncStat']==[False,False,True],row
                assert os.path.samefile(native_path(row['readlink'][0]),row['target']),row
        assert value[context]['controls']==[[False,True,False],[False,False,True]],value[context]
        assert value[context]['module']=='junction module',value[context]
    assert os.path.samefile(native_path(value['main']['chdir']),Path(value['main']['links'][0]['target']))
    return value

def check(command,root,environment):
    links=setup(root)
    try:
        value=observe(command,environment)
        files=[Path(row['name']) for label in ('main','worker') for row in value[label]['files']]
        for file in files:
            if os.name=='nt':assert not file.stat().st_file_attributes&2,file
            file.write_text('native overwrite',encoding='utf8')
        if os.name=='nt':
            try:
                for file in files:attributes(file,2|4)
                value=observe(command,environment)
                for label in ('main','worker'):
                    for row in value[label]['files']:
                        file=Path(row['name']);assert file.stat().st_file_attributes&6==6,file
                        assert file.read_text(encoding='utf8')==row['text'],file
            finally:
                for file in files:attributes(file,128)
    finally:
        for link in links:
            if os.name=='nt':link.rmdir()
            else:link.unlink()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--qjs',required=True,type=Path);parser.add_argument('--compiled',required=True,type=Path);parser.add_argument('--sdk',required=True,type=Path);args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='host-fs-',dir=ROOT/'build') as name:
        base=Path(name).resolve();environment=dict(os.environ)
        if os.name=='nt':environment.update(TMP=str(base),TEMP=str(base))
        commands={
            'qjs':lambda directory:ape_command(args.qjs.resolve(),['-m',str(FIXTURE),str(directory)],args.qjs.resolve().parent),
            'compiled':lambda directory:ape_command(args.compiled.resolve(),[str(directory)],args.qjs.resolve().parent),
            'sdk':lambda directory:ape_command(args.sdk.resolve(),[str(FIXTURE),str(directory)],args.qjs.resolve().parent)}
        for label,command in commands.items():
            root=base/(label+' 中文 空格');root.mkdir();check(command(root),root,environment)
            if os.name=='nt':
                app=base/(label+' startup');app.mkdir();links=setup(app)
                try:
                    temp=base/(label+'-'+'x'*100);temp.mkdir()
                    observe(command(app),dict(environment,TMP=str(temp),TEMP=str(temp)))
                    assert (temp/'quickjs-cosmo-sig').is_dir(),'long TMP was silently replaced'
                    invalid=base/(label+'-file');invalid.write_text('file',encoding='utf8')
                    readonly=base/(label+'-denied');readonly.mkdir()
                    acl=subprocess.run(['icacls',str(readonly),'/deny','*S-1-1-0:(WD,AD)'],capture_output=True,timeout=15);assert acl.returncode==0,acl.stderr
                    try:
                        for bad in (invalid,readonly):
                            run=subprocess.run(command(app),env=dict(environment,TMP=str(bad),TEMP=str(bad)),capture_output=True,text=True,encoding='utf8',errors='replace',timeout=5)
                            assert run.returncode!=0 and 'cannot initialize Windows signal state' in run.stderr and str(bad) in run.stderr,(bad,run.returncode,run.stdout,run.stderr)
                    finally:
                        restored=subprocess.run(['icacls',str(readonly),'/remove:d','*S-1-1-0'],capture_output=True,timeout=15);assert restored.returncode==0,restored.stderr
                finally:
                    for link in links:link.rmdir()
        print('PASS host filesystem: native identity, source/Worker/qjsc/SDK, attributes and bounded temp startup')

if __name__=='__main__':main()
