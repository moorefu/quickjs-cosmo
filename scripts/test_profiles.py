#!/usr/bin/env python3
"""Check profile exports, actual single-CPU execution and SDK CA providers."""
import argparse
import json
import os
from pathlib import Path
import subprocess

from ape_layout import inspect
from build_config import load_config
from build_variants import validate_ca
from host_runtime import ape_command, host_info
from prepare_native import sha256


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compile',action='store_true')
    parser.add_argument('--standalone',type=Path)
    args=parser.parse_args()
    settings=load_config();root,dist=settings.root,settings.dist
    os.environ['PATH']=str(settings.toolchain/'bin')+os.pathsep+os.environ['PATH']
    host=host_info();scratch=root/'build/test-linux'
    source=root/'tests/runtime_profiles.mjs'
    records=[]
    def execute(binary,arguments,entry):
        result=subprocess.run(ape_command(binary,arguments,dist),cwd=root,capture_output=True,text=True,encoding='utf8',timeout=120)
        if result.returncode:raise ValueError(entry+': '+result.stdout+result.stderr)
        if 'PASS' not in result.stdout:raise ValueError('Missing profile execution result: '+entry)
        if entry in ('qjs','qjsc','sdk','x64','arm64'):
            line=next(line for line in result.stdout.splitlines() if line.startswith('PASS runtime-profiles '))
            identity=json.loads(line[len('PASS runtime-profiles '):])
            expected=dict(profile=settings.runtime_profile,architecture=entry if entry in ('x64','arm64') else 'fat',
                          entry=entry if entry in ('qjsc','sdk') else 'qjs')
            if identity!=expected:raise ValueError('Runtime capability identity differs from its release: '+entry)
        records.append(dict(entry=entry,sha256=sha256(binary),output=result.stdout.strip()))
    execute(dist/'qjs.exe',['-m',source],'qjs')
    for arch in ('x64','arm64'):
        binary=dist/'variants'/arch/'qjs.exe'
        inspect(binary,expected_architecture=arch);validate_ca(binary,root)
    architecture='x64' if host['execution_arch']=='x86_64' else 'arm64'
    execute(dist/'variants'/architecture/'qjs.exe',['-m',source],architecture)
    if args.compile:
        scratch.mkdir(parents=True,exist_ok=True)
        subprocess.run(ape_command(dist/'qjsc.exe',['-m','-o',scratch/'profiles-standalone.exe',source],dist),cwd=root,check=True,timeout=180)
        (scratch/'profiles-source.h').write_text('static const char profile_source[]='+json.dumps(source.read_text(encoding='utf8'))+';\n',encoding='utf8')
        for name in ('profiles','ca_provider'):
            target=scratch/('ca-provider-sdk.exe' if name=='ca_provider' else 'profiles-sdk.exe')
            subprocess.run([str(settings.toolchain/'bin/cosmocc'),'-O2','-I'+str(dist),'-I'+str(scratch),
                            str(root/'tests/native'/(name+'.c')),str(dist/'libquickjs.a'),'-lm','-lpthread','-ldl',
                            '-Wl,--wrap=_Exit,-u,__wrap__Exit','-o',str(target)],cwd=root,check=True,timeout=180)
    directory=args.standalone or (scratch if args.compile else None)
    ca=[]
    if directory:
        for name,entry in (('profiles-standalone.exe','qjsc'),('profiles-sdk.exe','sdk')):
            binary=directory/name;validate_ca(binary,root);execute(binary,[],entry)
        binary=directory/'ca-provider-sdk.exe';validate_ca(binary,root)
        output=root/('build/profiles/'+host['system']+'/provider.pem');output.parent.mkdir(parents=True,exist_ok=True)
        for mode in ('default','provider','missing','nul'):
            execute(binary,[mode,root/'native/tls/ca-bundle.pem',output],'ca-'+mode)
            if mode in ('default','provider') and sha256(output)!=sha256(root/'native/tls/ca-bundle.pem'):
                raise ValueError('CA provider changed pinned bytes')
            ca.append(mode)
    value=dict(format=1,profile=settings.runtime_profile,architecture='fat',host=host,
               qjsSha256=sha256(dist/'qjs.exe'),capabilitiesSha256=sha256(dist/'capabilities.json'),
               variants={arch:sha256(dist/'variants'/arch/'qjs.exe') for arch in ('x64','arm64')},
               records=records,caProvider=ca)
    output=root/('build/profiles/'+host['system']+'/results.json');output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(value,indent=2)+'\n',encoding='utf8')
    print('PASS release profiles: '+settings.runtime_profile+', '+architecture+' native entry, exports and CA providers')


if __name__=='__main__':main()
