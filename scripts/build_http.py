#!/usr/bin/env python3
"""Build the pinned Nightly response-header parser behind the JS adapter."""
import json,os
from build_config import load_config
from build_native import architecture_peer,elf_machine,run
from node_contract import ROOT,read_json
from prepare_native import sha256

def build(root=ROOT):
    settings=load_config();lock=read_json(root/'native/http/sources.json')
    if lock['commit']!=settings.data['cosmopolitan']['commit']:raise ValueError('HTTP parser commit mismatch')
    for record in lock['sources']:
        path=settings.native_source/record['path']
        if not path.is_file() or path.is_symlink() or sha256(path)!=record['sha256']:raise ValueError('HTTP parser source pin mismatch: '+record['path'])
    if sha256(root/lock['license']['path'])!=lock['license']['sha256']:raise ValueError('HTTP parser license pin mismatch')
    os.environ['SOURCE_DATE_EPOCH']=str(settings.source_epoch);output=root/'build/native/http';output.mkdir(parents=True,exist_ok=True)
    files=[root/'native/http/binding.c',*[settings.native_source/r['path'] for r in lock['sources'] if r['path'].endswith('.c')]]
    objects=[]
    for file in files:
        target=output/(file.stem+'.o');objects.append(target)
        run([settings.toolchain/'bin/cosmocc','-std=gnu23','-D_COSMO_SOURCE','-D_GNU_SOURCE','-O2','-Wall','-Werror=implicit-function-declaration',
             '-ffunction-sections','-fdata-sections','-ffile-prefix-map='+str(root)+'=.',
             '-I'+str(settings.build),'-I'+str(settings.native_source),'-c',file,'-o',target],root)
    reports={};symbol='js_cosmo_http_api'
    for arch,machine in [('x86_64',62),('aarch64',183)]:
        peer=architecture_peer if arch=='aarch64' else lambda p:p;tools=settings.toolchain/'bin'/(arch+'-linux-cosmo-');target=peer(output/'qjs-http.o');target.parent.mkdir(exist_ok=True)
        run([str(tools)+'ld','-r','--gc-sections','-u',symbol,'--wrap=realloc','--wrap=free','-o',target,*map(peer,objects)],root)
        run([str(tools)+'objcopy','-G',symbol,'--strip-unneeded',target],root);elf_machine(target,machine)
        defined=run([str(tools)+'nm','-g','--defined-only','-P',target],root).splitlines()
        if [line.split()[0] for line in defined]!=[symbol]:raise ValueError('HTTP SDK symbol leak')
        undefined=run([str(tools)+'nm','-u','-P',target],root).splitlines()
        if any(line.split()[0].startswith(('ParseHttp','InitHttp','DestroyHttp','GetHttp','kHttp','__wrap_')) for line in undefined):raise ValueError('Unresolved HTTP parser closure')
        reports[arch]=dict(sha256=sha256(target),exported=[symbol],undefined=undefined)
    inputs=['scripts/build_http.py','native/http/sources.json','native/http/LICENSE','native/http/binding.c','native/http/binding.h']
    (output/'build.json').write_text(json.dumps(dict(format=1,inputs={p:sha256(root/p) for p in inputs},sources=lock,architectures=reports),indent=2)+'\n',encoding='utf8')
    print('PASS HTTP header parser: pinned Nightly, owner allocator and private dual-architecture closure')

if __name__=='__main__':build()
