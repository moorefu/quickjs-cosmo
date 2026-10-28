#!/usr/bin/env python3
"""Verify and build the private Nightly TLS security candidate (never a public SDK archive)."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from build_config import load_config
from build_native import architecture_peer, elf_machine, run
from node_contract import ROOT, checked_file, read_json
from prepare_native import prepare_source, sha256


def prepare(root=ROOT, offline=False):
    lock=read_json(root/'native/tls/security.json')
    if lock['format']!=1 or lock['cosmopolitan_commit']!=load_config().data['cosmopolitan']['commit'] or lock['candidate_only'] is not True:
        raise ValueError('TLS candidate must use the pinned Nightly and private scope')
    source=prepare_source(root,offline=offline)
    names=set()
    for record in lock['source_cohort']:
        path=checked_file(source,record['path'])
        if record['path'] in names or sha256(path)!=record['sha256']:
            raise ValueError('TLS source pin mismatch: '+record['path'])
        names.add(record['path'])
    actual={p.relative_to(source).as_posix() for p in (source/'third_party/mbedtls').iterdir()
            if p.suffix in {'.c','.h','.inc'} and p.name!='certs.c'}
    if actual!=names:raise ValueError('TLS source cohort changed')
    patch=checked_file(root,lock['patch']['path'])
    if sha256(patch)!=lock['patch']['sha256']:raise ValueError('TLS patch pin mismatch')
    ca=checked_file(root,lock['ca']['path'])
    if sha256(ca)!=lock['ca']['sha256']:raise ValueError('TLS CA pin mismatch')
    if sha256(checked_file(root,lock['ca']['license_path']))!=lock['ca']['license_sha256']:raise ValueError('TLS CA license pin mismatch')
    overlay=root/'build/native/tls/source'
    targets=lock['patch']['targets']
    allowed={r['path'] for r in targets}
    existing={p.relative_to(overlay).as_posix() for p in overlay.rglob('*') if p.is_file()}
    if existing-allowed:raise ValueError('Unexpected TLS overlay file would shadow pinned sources')
    present=[(overlay/r['path']).is_file() for r in targets]
    if any(present):
        if not all(present) or any(sha256(overlay/r['path'])!=r['patched_sha256'] for r in targets):
            raise ValueError('Mixed or modified TLS overlay; preserve it for inspection')
    else:
        for record in targets:
            original=checked_file(source,record['path'])
            if sha256(original)!=record['source_sha256']:raise ValueError('TLS target source mismatch')
            target=overlay/record['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(original,target)
        with patch.open('rb') as content:
            result=subprocess.run(['patch','--batch','--forward','--fuzz=0','--no-backup-if-mismatch','-p1','-d',str(overlay)],stdin=content,capture_output=True,text=True)
        if result.returncode:raise ValueError('TLS patch failed: '+result.stdout+result.stderr)
        if any(sha256(overlay/r['path'])!=r['patched_sha256'] for r in targets):raise ValueError('TLS patched output mismatch')
    return source,overlay,lock


def build(root=ROOT,offline=False,jobs=4):
    if os.name!='posix':raise ValueError('Build TLS candidate in WSL/Unix')
    settings=load_config();os.environ['SOURCE_DATE_EPOCH']=str(settings.source_epoch)
    source,overlay,lock=prepare(root,offline)
    output=root/'build/native/tls';output.mkdir(parents=True,exist_ok=True)
    descriptor=dict(lock_sha256=sha256(root/'native/tls/security.json'),builder_sha256=sha256(root/'scripts/build_tls.py'),
                    toolchain=settings.data['cosmopolitan'],epoch=settings.source_epoch)
    fingerprint=hashlib.sha256(json.dumps(descriptor,sort_keys=True).encode()).hexdigest()
    manifest=output/'build.json';cached=read_json(manifest) if manifest.exists() else {}
    if cached.get('fingerprint')==fingerprint and cached.get('files') and all((output/n).is_file() and sha256(output/n)==v['sha256'] for n,v in cached['files'].items()):
        print('PASS TLS candidate: verified cached dual-architecture archive',flush=True);return output,cached
    commands=[]
    for record in lock['source_cohort']:
        if not record['path'].endswith('.c'):continue
        original=source/record['path'];path=overlay/record['path']
        if not path.is_file():path=original
        target=output/'objects'/Path(record['path']).with_suffix('.o').name;target.parent.mkdir(exist_ok=True)
        flags=['-std=gnu23','-O2','-D_GNU_SOURCE','-D_COSMO_SOURCE','-fdata-sections','-ffunction-sections']
        if path.name=='everest.c':flags+=['-O3']
        if path.name=='zeroize.c':flags+=['-O3','-fomit-frame-pointer','-foptimize-sibling-calls']
        if path.name=='shiftright-avx.c':flags+=['-O3','-Xx86_64-mavx']
        command=[settings.toolchain/'bin/cosmocc',*flags,'-I'+str(overlay),'-I'+str(source),'-ffile-prefix-map='+str(root)+'=.', '-c',path,'-o',target]
        commands.append((target,command))
    def compile_one(item):
        target,command=item;run(command,root);elf_machine(target,62);elf_machine(architecture_peer(target),183)
        print('TLS_OBJECT '+target.name,flush=True);return target
    with ThreadPoolExecutor(max_workers=max(1,min(jobs,16))) as pool:objects=list(pool.map(compile_one,commands))
    archive=output/'audit-mbedtls.a'
    for path in (archive,architecture_peer(archive)):
        if not path.resolve().is_relative_to(output.resolve()):raise ValueError('TLS archive escapes output')
        path.unlink(missing_ok=True)
    run([settings.toolchain/'bin/cosmoar','rcsD',archive,*objects],root)
    files={p.relative_to(output).as_posix():dict(sha256=sha256(p),bytes=p.stat().st_size)
           for p in [archive,architecture_peer(archive),*objects,*map(architecture_peer,objects)]}
    result=dict(fingerprint=fingerprint,inputs=descriptor,commands=[list(map(str,c)) for _,c in commands],files=files,
                scope='Private audit candidate only; no general mbedTLS SDK archive/headers')
    manifest.write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print('PASS TLS candidate: pinned patched sources and both architectures',flush=True);return output,result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--offline',action='store_true');parser.add_argument('--jobs',type=int,default=4)
    args=parser.parse_args();build(offline=args.offline,jobs=args.jobs)
