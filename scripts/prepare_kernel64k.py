#!/usr/bin/env python3
"""Prepare checksum-locked, test-only Ubuntu ARM64 64K kernel inputs."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

from build_config import ROOT
from prepare_native import fetch, sha256


def prepare(offline=False):
    lock=json.loads((ROOT/'compat/kernel64k.json').read_text())
    output=ROOT/'build/kernel64k/inputs'
    output.mkdir(parents=True,exist_ok=True)
    files={}
    for name,item in lock['packages'].items():
        archive=ROOT/'.cache/kernel64k'/Path(item['Filename']).name
        fetch(lock['origin']+item['Filename'],archive,item['SHA256'],offline)
        process=subprocess.Popen(['dpkg-deb','--fsys-tarfile',str(archive)],stdout=subprocess.PIPE)
        with tarfile.open(fileobj=process.stdout,mode='r|') as bundle:
            for member in bundle:
                base=Path(member.name).name
                if not member.isfile() or not (base.startswith(('vmlinuz-','config-')) or base in ('binfmt_misc.ko','binfmt_misc.ko.zst')):continue
                path=output/base
                with bundle.extractfile(member) as source,path.open('wb') as target:shutil.copyfileobj(source,target)
                files[base]=dict(sha256=sha256(path),package=name)
        if process.wait()!=0:raise ValueError('Cannot extract verified kernel package: '+name)
    config=(output/('config-'+lock['release'])).read_text()
    for value in ('CONFIG_ARM64_64K_PAGES=y','CONFIG_PROC_FS=y','CONFIG_BLK_DEV_INITRD=y','CONFIG_SERIAL_AMBA_PL011_CONSOLE=y'):
        if value not in config.splitlines():raise ValueError('Required kernel configuration missing: '+value)
    if not any('binfmt_misc.ko' in name for name in files) and 'CONFIG_BINFMT_MISC=y' not in config.splitlines():raise ValueError('Kernel binfmt implementation is missing')
    proof=dict(lock=lock,files=files)
    (output/'provenance.json').write_text(json.dumps(proof,indent=2)+'\n')
    return output,proof


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--offline',action='store_true');args=parser.parse_args()
    output,_=prepare(args.offline);print('KERNEL64K_INPUTS '+str(output))
