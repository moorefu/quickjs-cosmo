#!/usr/bin/env python3
"""One deployment contract for source, Worker, compiled, SDK and installed APEs."""
import argparse
import errno
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

from ape_layout import inspect
from build_config import load_config
from host_runtime import ape_command, host_info
from prepare_native import prepare_node, sha256
from test_host_filesystem import native_path


def parse(output,prefix):
    values=[json.loads(v[len(prefix):]) for v in output.splitlines() if v.startswith(prefix)]
    if len(values)!=1:raise ValueError('Missing or duplicate deployment result: '+output)
    return values[0]


def classify(error,codes=None):
    codes=codes or {name:getattr(errno,name) for name in ('ENOSYS','ENOTSUP','EPERM','EACCES','ENOENT')}
    if not error:return 'implemented'
    if error in (codes['ENOSYS'],codes['ENOTSUP']):return 'unsupported'
    if error in (codes['EPERM'],codes['EACCES']):return 'permission-denied'
    if error==codes['ENOENT']:return 'path-missing'
    return 'error'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('qjs','compiled','sdk'):parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--node',type=Path);args=parser.parse_args();settings=load_config();root=settings.root
    for name in ('qjs','compiled','sdk'):setattr(args,name,getattr(args,name).resolve())
    node=args.node.resolve() if args.node else prepare_node(offline=True)
    from test_node_compat import verify_node
    node_proof=verify_node(node,json.loads((root/'compat/node-baseline.json').read_text()),root)
    protected=[*settings.dist.glob('*'),settings.dist/'.aarch64/libquickjs.a',root/'versions.json',root/'native/versions.json',root/'compat/versions.json',*settings.releases.glob('*.zip'),args.compiled,args.sdk]
    before={p.relative_to(root).as_posix():sha256(p) for p in protected if p.is_file()}
    layouts={name:inspect(path) for name,path in (('qjs',args.qjs),('qjsc',settings.dist/'qjsc.exe'),('compiled',args.compiled),('sdk',args.sdk))}
    records=[]
    with tempfile.TemporaryDirectory(prefix='deployment-',dir=root/'build') as temporary:
        work=Path(temporary).resolve();env=dict(os.environ,QJS_DEPLOY_ROOT=str(work),QJS_DEPLOY_QJS=str(args.qjs.resolve()),QJS_DEPLOY_NODE=str(node),
            QJS_DEPLOY_CHILD=str(root/'tests/fixtures/deployment-child.mjs'),QJS_DEPLOY_SCRIPT=str(root/'tests/runtime_deployment.mjs'))
        if os.name=='nt':env.update(TMP=str(work),TEMP=str(work))
        else:
            home=work/'home';home.mkdir();cache=work/'cache';cache.mkdir();commands=work/'commands';commands.mkdir()
            for name in ('sh','uname','mkdir','dd','gzip','chmod','mv','cc'):
                program=shutil.which(name)
                if program:(commands/name).symlink_to(program)
                elif name!='cc' or host_info()['platform']=='darwin' and host_info()['execution_arch']=='arm64':raise ValueError('Missing APE shell deployment tool: '+name)
            env.update(HOME=str(home),TMPDIR=str(cache),PATH=str(commands))
            env['QJS_DEPLOY_NATIVE_LAUNCHER']=str(args.qjs.parent/('ape-aarch64.elf' if host_info()['execution_arch']=='arm64' else 'ape-x86_64.elf')) if platform.system()=='Linux' else str(cache/'.ape-1.10')
        installed=work/'installed 中文 空格';installed.mkdir();copy=installed/'renamed-runtime.exe';shutil.copy2(args.qjs,copy)
        entries={'qjs':(args.qjs,['-m',root/'tests/runtime_deployment.mjs']),'compiled':(args.compiled,[]),
                 'sdk':(args.sdk,[root/'tests/runtime_deployment.mjs']),
                 'installed-first':(copy,['-m',root/'tests/runtime_deployment.mjs']),
                 'installed-reuse':(copy,['-m',root/'tests/runtime_deployment.mjs'])}
        for name,(binary,arguments) in entries.items():
            command=ape_command(binary.resolve(),arguments,args.qjs.resolve().parent)
            if name.startswith('installed-') and os.name!='nt':command=['/bin/sh',str(binary),*map(str,arguments)]
            process=subprocess.Popen(command,cwd=work,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8',errors='replace')
            try:stdout,stderr=process.communicate(timeout=180)
            except BaseException:process.kill();process.communicate();raise
            if process.returncode:raise ValueError(name+' failed: '+stdout+stderr)
            value=parse(stdout,'DEPLOYMENT_RESULT ')
            if value['main']['pid']!=process.pid:raise ValueError('process.pid does not identify the native payload process: '+name)
            if not os.path.samefile(native_path(value['main']['execPath']),binary):raise ValueError('execPath names the wrong payload: '+name)
            if value['main']['pid']<=0 or value['main']['protocol'] or not value['nativeToApe'] or value['vectors']!=261:
                raise ValueError('Incomplete process identity/argv/environment evidence: '+name)
            counts={(r['target'],r['api']) for r in value['results']}
            if counts!={(target,api) for target in ('ape','native') for api in ('sync','async','legacy','legacy-async')}:raise ValueError('Missing process transport: '+name)
            if sum(r.get('sharedCursor',False) for r in value['results'])!=8:raise ValueError('Missing shared cursor evidence')
            if sha256(copy)!=sha256(args.qjs):raise ValueError('Installed APE changed while executing')
            records.append(dict(entry=name,value=value,nativePid=process.pid))
            if name=='installed-first' and os.name!='nt':
                cache_before={str(p.relative_to(cache)):sha256(p) for p in cache.rglob('*') if p.is_file()}
                if not cache_before:raise ValueError('APE embedded loader cache was not exercised')
            if name=='installed-reuse' and os.name!='nt':
                cache_after={str(p.relative_to(cache)):sha256(p) for p in cache.rglob('*') if p.is_file()}
                if cache_before!=cache_after:raise ValueError('Installed loader cache changed during reuse')
                records[-1]['cache']=cache_after
        for name in ('qjs','compiled','sdk'):
            binary,arguments=entries[name];caller='custom '+name+' argv0 中文 空格'
            options={}
            if os.name=='nt':command=[caller,*map(str,arguments)];options['executable']=str(binary)
            else:
                launcher=env['QJS_DEPLOY_NATIVE_LAUNCHER']
                command=[launcher,'-',str(binary),caller,*map(str,arguments)]
            process=subprocess.Popen(command,cwd=work,env=dict(env,QJS_DEPLOY_CUSTOM_ONLY='1'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8',errors='replace',**options)
            try:stdout,stderr=process.communicate(timeout=30)
            except BaseException:process.kill();process.communicate();raise
            if process.returncode:raise ValueError(name+' custom argv0 failed: '+stdout+stderr)
            value=parse(stdout,'DEPLOYMENT_RESULT ')
            if value['main']['argv0']!=caller or value['main']['pid']!=process.pid or not os.path.samefile(native_path(value['main']['execPath']),binary):raise ValueError('Custom argv0 changed native payload/PID identity: '+name)
            records.append(dict(entry=name+'-custom-argv0',value=value,nativePid=process.pid))
        if platform.system()=='Linux':
            # Only assimilate a disposable copy. This independently tests the bare entry.
            bare=work/'runtime.elf';shutil.copy2(args.qjs,bare)
            subprocess.run([str(settings.toolchain/'bin/assimilate'),'-e','-a' if host_info()['execution_arch']=='arm64' else '-x','-c',str(bare)],check=True) if settings.toolchain.is_dir() else assimilate_copy(args.qjs,bare,settings.dist)
            run=subprocess.run([str(bare),'-m',str(root/'tests/runtime_deployment.mjs'),'--identity'],env=env,capture_output=True,text=True,encoding='utf8',timeout=20,check=True)
            value=parse(run.stdout,'DEPLOYMENT_RESULT ')
            if not os.path.samefile(native_path(value['execPath']),bare):raise ValueError('Bare ELF execPath mismatch')
            records.append(dict(entry='bare-elf',value=value,layout=inspect(bare)))
        run=subprocess.run(ape_command(args.sdk.resolve(),['--native-probe',work],settings.dist),capture_output=True,text=True,encoding='utf8',env=env,timeout=20,check=True)
        native=parse(run.stdout,'DEPLOYMENT_NATIVE ')
        codes=parse(run.stdout,'DEPLOYMENT_ERRNO ')
        capabilities=dict(native=native,hostCpuCount=os.cpu_count(),pageSize=native['pageSize'],
            errnoNumbers=codes,tlsFlags=dict(status='implemented' if host_info()['execution_arch']=='x86_64' else 'not-applicable',vectors=30 if host_info()['execution_arch']=='x86_64' else 0),
            fifo=dict(status=classify(native['fifoError'],codes),errno=native['fifoError']),cpu=dict(status=classify(native['cpuError'],codes),count=native['cpuCount']),
            zero=dict(status=classify(native['zeroError'],codes),bytes=native['zeroBytes'],allZero=native['zeroContent']),
            signals=dict(status='verified-separately',report='custom/host-filesystem-all-entries'),permissions=dict(status='verified-separately',report='custom/host-filesystem-all-entries'),
            tty=dict(status='verified-separately',report='build/terminal/'+platform.system().lower()+'/results.json'))
        if native['zeroError']==0 and (native['zeroBytes']!=32 or not native['zeroContent']):raise ValueError('Invalid /dev/zero implementation')
    after={name:sha256(root/name) for name in before}
    if before!=after:raise ValueError('Deployment test modified protected payloads or build inputs')
    value=dict(format=1,host=host_info(),qjsSha256=sha256(args.qjs),records=records,layouts=layouts,node=node_proof,capabilities=capabilities,immutable=before)
    output=root/('build/deployment/'+platform.system().lower()+'/results.json');output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(value,indent=2)+'\n')
    print('PASS deployment all entries: '+str(len(records))+' entries; native/APE argv and cursor vectors')


def assimilate_copy(master,copy,dist):
    # Cross-host verification has no compiler. Decode the architecture boot header
    # exactly as the official assimilate tool does, on a disposable test copy.
    import re
    from ape_layout import printf_bytes,elf
    data=bytearray(Path(master).read_bytes());machine=183 if host_info()['execution_arch']=='arm64' else 62
    headers=[printf_bytes(m[1]) for m in re.finditer(rb"printf '([^']*)' >&7",data[:65536]) if m[1].startswith(b'\\177ELF')]
    selected=[v for v in headers if elf(v,data)['machine']==machine]
    if len(selected)!=1:raise ValueError('Cannot select the bare ELF architecture')
    data[:64]=selected[0][:64];Path(copy).write_bytes(data);Path(copy).chmod(0o755)


if __name__=='__main__':main()
