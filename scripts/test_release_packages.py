#!/usr/bin/env python3
"""Execute SDK and tests after extraction into a fresh independent directory."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from assemble_release import extract_zip
from build_variants import validate_ca
from runtime_resources import validate_resources
from host_runtime import ape_command
from prepare_native import sha256
from release_evidence import binding


def validate(settings,version):
    root=settings.root;directory=root/'build/package-validation';directory.mkdir(parents=True,exist_ok=True)
    environment={**os.environ,'PATH':str(settings.toolchain/'bin')+os.pathsep+os.environ['PATH']}
    records=[]
    with tempfile.TemporaryDirectory(prefix='sdk-中文-',dir=directory) as temporary, tempfile.TemporaryDirectory(prefix='tests 中文 空格 ',dir=directory) as test_temporary:
        scratch=Path(temporary)
        for kind in ('sdk','tests'):
            archive=settings.releases/('internal/quickjs-cosmo-'+kind+'-'+settings.runtime_profile+'-'+version+'.zip')
            extract_zip(archive,(Path(test_temporary) if kind=='tests' else scratch)/kind)
        sdk=scratch/'sdk';tests=Path(test_temporary)/'tests'
        result=subprocess.run([sys.executable,str(tests/'run-tests.py')],cwd=tests,env=environment,capture_output=True,text=True,encoding='utf8',timeout=180)
        if result.returncode:raise ValueError('Extracted tests package failed: '+result.stdout+result.stderr)
        records.append(dict(entry='tests',sha256=sha256(tests/'run-test262'),passed=True))
        source=scratch/'app.mjs';source.write_bytes((root/'tests/runtime_profiles.mjs').read_bytes());target=scratch/'app.exe'
        subprocess.run(ape_command(sdk/'qjsc.exe',['-m','-o',target,source],sdk),cwd=scratch,env=environment,check=True,timeout=180)
        validate_resources(target,root,settings.runtime_profile)
        result=subprocess.run(ape_command(target,[],sdk),cwd=scratch,env=environment,capture_output=True,text=True,encoding='utf8',timeout=120)
        if result.returncode or 'PASS runtime-profiles' not in result.stdout:raise ValueError('Extracted SDK qjsc failed: '+result.stdout+result.stderr)
        records.append(dict(entry='qjsc-sdk',sha256=sha256(sdk/'qjsc.exe'),passed=True))
        target=scratch/'ca-sdk.exe'
        subprocess.run([str(settings.toolchain/'bin/cosmocc'),'-O2','-I'+str(sdk),str(root/'tests/native/ca_provider.c'),str(sdk/'libquickjs.a'),'-lm','-lpthread','-ldl','-Wl,--wrap=_Exit,-u,__wrap__Exit','-o',str(target)],cwd=scratch,env=environment,check=True,timeout=180)
        validate_resources(target,root,settings.runtime_profile);output=scratch/'default.pem'
        subprocess.run(ape_command(target,['default',root/'native/tls/ca-bundle.pem',output],sdk),cwd=scratch,check=True,timeout=120)
        if sha256(output)!=sha256(root/'native/tls/ca-bundle.pem'):raise ValueError('Extracted SDK default CA changed')
        records.append(dict(entry='ca-sdk',sha256=sha256(sdk/'libquickjs.a'),passed=True))
    value=dict(format=1,inputs=binding(settings),records=records)
    (directory/(settings.runtime_profile+'.json')).write_text(json.dumps(value,indent=2)+'\n',encoding='utf8')
    print('PASS independent SDK/tests packages: '+settings.runtime_profile)
    return value
