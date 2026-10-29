#!/usr/bin/env python3
"""Executable Windows integrity, process-visibility and real-UNC acceptance.

Use an elevated console to exercise High and create a private loopback SMB share.
--unc-root may instead name an existing writable share. No missing fixture is
described as UNC coverage. Scheduled tasks can run this same command verbatim.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid

from build_config import load_config
from prepare_native import sha256
from test_host_filesystem import check
from windows_security import integrity, launch_restricted, process_state, deny_process_query


def powershell(code,environment):
    wrapped="try { & { "+code+" } } catch { if ($_.CategoryInfo.Category -eq 'PermissionDenied') { [Console]::Error.WriteLine('QJS_PERMISSION_DENIED') }; throw }"
    run=subprocess.run(['powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-Command',wrapped],env=environment,capture_output=True,text=True,encoding='utf8',errors='replace',timeout=60)
    if run.returncode:
        kind=PermissionError if 'QJS_PERMISSION_DENIED' in run.stderr else OSError
        raise kind(run.stderr.strip() or run.stdout.strip())
    return run.stdout.strip()


def acceptance(args):
    settings=load_config();root=settings.root;records=[]
    with tempfile.TemporaryDirectory(prefix='win-deploy-',dir=root/'build') as temporary:
        work=Path(temporary).resolve();current=integrity()
        target=subprocess.Popen([sys.executable,'-c','import time;time.sleep(600)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
        try:deny_process_query(target._handle)
        except BaseException:target.terminate();target.wait(timeout=5);raise
        try:
            return integrity_and_unc(args,work,current,target,records)
        finally:target.terminate();target.wait(timeout=5)


def integrity_and_unc(args,work,current,target,records):
    settings=load_config();root=settings.root
    for name,rid in (('Low',4096),('Medium',8192),('High',12288)):
        directory=work/name;directory.mkdir()
        # Only this disposable subtree receives a Low mandatory label.
        subprocess.run(['icacls',str(directory),'/setintegritylevel','(OI)(CI)L'],capture_output=True,check=True,timeout=15)
        env=dict(os.environ,TMP=str(directory),TEMP=str(directory),QJS_DEPLOY_SECURITY='1',QJS_DEPLOY_QJS=str(args.qjs.resolve()),QJS_DEPLOY_SCRIPT=str(root/'tests/runtime_deployment.mjs'))
        result=directory/'result.json';config=directory/'input.json'
        entries=[dict(name='qjs',command=[str(args.qjs.resolve()),'-m',str(root/'tests/runtime_deployment.mjs')]),
            dict(name='compiled',command=[str(args.compiled.resolve())]),dict(name='sdk',command=[str(args.sdk.resolve()),str(root/'tests/runtime_deployment.mjs')])]
        config.write_text(json.dumps(dict(result=str(result),integrity=rid,parent=os.getpid(),deniedTarget=target.pid,entries=entries,environment=env,cwd=str(directory))),encoding='utf8')
        value=launch_restricted(rid,[sys.executable,str(root/'scripts/windows_security.py'),'--child',str(config)],env,directory)
        if value['status']=='executed':
            proof=json.loads(result.read_text()) if result.is_file() else {}
            if value['exitCode'] or proof.get('passed') is not True or len(proof['checks'])!=3:raise ValueError(name+' integrity failed: '+json.dumps(proof))
            value['proof']=proof
        records.append(dict(level=name,requested=rid,value=value))
    if os.environ.get('GITHUB_ACTIONS')=='true' and any(v['value']['status']!='executed' for v in records):raise ValueError('CI must exercise all three actual integrity levels: '+json.dumps(records))
    share='qjs-'+uuid.uuid4().hex;share_root=work/'share';share_root.mkdir();started=False;created=False;unc=None;failure=None
    share_env=dict(os.environ,QJS_SHARE_NAME=share,QJS_SHARE_PATH=str(share_root))
    try:
        if args.unc_root:
            # Make a unique child; never remove or change the supplied share.
            unc=args.unc_root/share;unc.mkdir()
            share_root=unc
        else:
            prior=powershell("$ErrorActionPreference='Stop';(Get-Service LanmanServer).Status.ToString()",share_env)
            if prior!='Running':
                if os.environ.get('GITHUB_ACTIONS')!='true':raise OSError('SMB service is stopped; provide --unc-root or run on the CI acceptance host')
                powershell("$ErrorActionPreference='Stop';Start-Service LanmanServer",share_env);started=True
            powershell("$ErrorActionPreference='Stop';New-SmbShare -Name $env:QJS_SHARE_NAME -Path $env:QJS_SHARE_PATH -FullAccess ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -Temporary | Out-Null",share_env);created=True
            unc=Path('\\\\localhost\\'+share)
        (share_root/'fixtures').mkdir()
        for name in ('runtime_host_filesystem.mjs',):shutil.copy2(root/'tests'/name,share_root/name)
        for name in ('host-filesystem-worker.mjs','host-filesystem-probe.mjs'):shutil.copy2(root/'tests/fixtures'/name,share_root/'fixtures'/name)
        shutil.copy2(args.qjs,share_root/'runtime.exe')
        env=dict(os.environ,TMP=str(work),TEMP=str(work))
        for name,command in (
            ('qjs-unc',[str(unc/'runtime.exe'),'-m',str(unc/'runtime_host_filesystem.mjs'),str(unc/'qjs')]),
            ('compiled-unc',[str(args.fs_compiled.resolve()),str(unc/'compiled')]),
            ('sdk-unc',[str(args.fs_sdk.resolve()),str(unc/'runtime_host_filesystem.mjs'),str(unc/'sdk')])):
            local=share_root/('qjs' if name.startswith('qjs') else 'compiled' if name.startswith('compiled') else 'sdk');local.mkdir()
            check(command,local,env)
        unc_proof=dict(status='implemented',root=str(unc),entries=['qjs','worker','compiled','sdk'],payloadSha256=sha256(share_root/'runtime.exe'))
        if unc_proof['payloadSha256']!=sha256(args.qjs):raise ValueError('UNC payload was modified')
    except OSError as error:
        unc_proof=dict(status='permission-denied' if isinstance(error,PermissionError) or getattr(error,'winerror',None)==5 else 'unavailable',error=str(error))
        failure=error
    finally:
        if created:powershell("$ErrorActionPreference='Stop';Remove-SmbShare -Name $env:QJS_SHARE_NAME -Force -Confirm:$false",share_env)
        if started:powershell("$ErrorActionPreference='Stop';Stop-Service LanmanServer",share_env)
        if args.unc_root and unc:shutil.rmtree(unc)
    if failure and os.environ.get('GITHUB_ACTIONS')=='true':raise ValueError('Real UNC acceptance did not execute: '+str(failure))
    if target.poll() is not None:raise ValueError('Denied fixture exited before visibility observations completed')
    value=dict(format=1,currentIntegrity=current,integrity=records,unc=unc_proof,parent=process_state(os.getpid()),deniedTargetKnownLive=True,qjsSha256=sha256(args.qjs))
    output=root/'build/deployment/windows/security.json';output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(value,indent=2)+'\n',encoding='utf8')
    print('PASS Windows deployment acceptance: actual integrity/visibility results and UNC classification')
    return value


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('qjs','compiled','sdk','fs-compiled','fs-sdk'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--unc-root',type=Path);args=parser.parse_args()
    if os.name!='nt':parser.error('Run this acceptance command on native Windows')
    acceptance(args)


if __name__=='__main__':main()
