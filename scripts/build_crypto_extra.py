"""Verify and build the narrowly vendored HACL* SHA3/SHAKE/BLAKE2s cohort."""
import hashlib
import json
import os
from pathlib import Path

from build_config import load_config
from build_native import architecture_peer, elf_machine, run
from node_contract import ROOT, checked_file, read_json
from prepare_native import sha256


def verify_sources(root=ROOT):
    lock=read_json(root/'native/haclstar-extra.json')
    if lock.get('format')!=1 or lock['commit']!='b5343363688fbe0e3cdc0c488188708f09eb8a14':
        raise ValueError('Unexpected HACL* extra source revision')
    files={entry['path']:entry['sha256'] for entry in lock['files']}
    vendor=root/'native/vendor/haclstar-0.3'
    actual={p.relative_to(root).as_posix() for p in vendor.rglob('*') if p.is_file()}
    if actual!=set(files) or len(files)!=len(lock['files']):raise ValueError('HACL* extra source inventory mismatch')
    for name,digest in files.items():
        if sha256(checked_file(root,name))!=digest:raise ValueError('HACL* extra source pin mismatch: '+name)
    return files,vendor


def license_text(root=ROOT):
    _,vendor=verify_sources(root)
    mit=(vendor/'dist/gcc-compatible/Hacl_SHA3.c').read_text(encoding='utf-8').split('*/',1)[0]+'*/'
    return 'HACL* 0.3.0 SHA3/SHAKE/BLAKE2s generated C (MIT), support headers (Apache-2.0)\n'+mit+'\n'+(vendor/'LICENSE').read_text(encoding='utf-8')


def build(root=ROOT):
    settings=load_config()
    os.environ['SOURCE_DATE_EPOCH']=str(settings.source_epoch)
    files,vendor=verify_sources(root)
    output=root/'build/native/crypto-extra';output.mkdir(parents=True,exist_ok=True)
    flags=['-std=gnu23','-O2','-ffunction-sections','-fdata-sections',
           '-ffile-prefix-map='+str(root)+'=.',
           '-I'+str(vendor/'dist/gcc-compatible'),'-I'+str(vendor/'dist/kremlin/include'),
           '-I'+str(vendor/'dist/kremlin/kremlib/dist/minimal')]
    objects=[];commands=[]
    for name in ('Hacl_SHA3','Hacl_Blake2s_32'):
        target=output/(name+'.o')
        command=[settings.toolchain/'bin/cosmocc',*flags,'-c',vendor/'dist/gcc-compatible'/(name+'.c'),'-o',target]
        diagnostics=run(command,root);commands.append(dict(command=list(map(str,command)),diagnostics=diagnostics));objects.append(target)
    archive=output/'haclstar-extra.a'
    for path in (archive,architecture_peer(archive)):path.unlink(missing_ok=True)
    run([settings.toolchain/'bin/cosmoar','rcsD',archive,*objects],root)
    slices={}
    for arch,machine in (('x86_64',62),('aarch64',183)):
        peer=architecture_peer if arch=='aarch64' else lambda p:p
        for obj in objects:elf_machine(peer(obj),machine)
        symbols=run([settings.toolchain/'bin'/(arch+'-linux-cosmo-nm'),'-g','--defined-only','-P',peer(archive)],root)
        if any(name not in symbols for name in ('Hacl_Impl_SHA3_absorb','Hacl_Impl_SHA3_squeeze','Hacl_Blake2s_32_blake2s_update_last')):
            raise ValueError('Missing incremental HACL* extra backend symbols')
        slices[arch]=dict(sha256=sha256(peer(archive)),symbols=symbols)
    (output/'LICENSES.txt').write_text(license_text(root),encoding='utf-8')
    (output/'build.json').write_text(json.dumps(dict(format=1,source_lock=sha256(root/'native/haclstar-extra.json'),
        files=files,builder=sha256(root/'scripts/build_crypto_extra.py'),toolchain=settings.data['cosmopolitan'],
        commands=commands,architectures=slices),indent=2)+'\n',encoding='utf-8')
    print('PASS HACL* extra backend: pinned minimal sources, x86_64/aarch64')
    return archive


if __name__=='__main__':build()
