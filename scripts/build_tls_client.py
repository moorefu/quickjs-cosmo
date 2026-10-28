#!/usr/bin/env python3
"""Build the audited TLS client closure; expose only the project vtable."""
import argparse
import json
from build_config import load_config
from build_native import architecture_peer,elf_machine,run
from build_tls import build
from node_contract import ROOT
from prepare_native import sha256

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--offline',action='store_true');args=parser.parse_args()
    settings=load_config();output,manifest=build(offline=args.offline)
    ca=ROOT/'native/tls/ca-bundle.pem'
    # Bytes are pinned and checked by build_tls before embedding.
    (output/'ca-bundle.h').write_text('static const unsigned char qjs_tls_ca[]=\n'+''.join(json.dumps(line)+'\n' for line in ca.read_text().splitlines(keepends=True))+';\n')
    objects=[]
    for name in ('backend','policy'):
        target=output/(name+'.o');objects.append(target)
        run([settings.toolchain/'bin/cosmocc','-std=gnu23','-O2','-D_GNU_SOURCE','-D_COSMO_SOURCE','-ffunction-sections','-fdata-sections',
             '-I'+str(output/'source'),'-I'+str(settings.native_source),'-I'+str(output),'-ffile-prefix-map='+str(ROOT)+'=.',
             '-c',ROOT/'native/tls'/(name+'.c'),'-o',target],ROOT)
    reports={};symbol='qjs_tls_backend_api'
    for arch,machine in [('x86_64',62),('aarch64',183)]:
        peer=architecture_peer if arch=='aarch64' else lambda p:p
        tools=settings.toolchain/'bin'/(arch+'-linux-cosmo-');target=peer(output/'qjs-tls.o');target.parent.mkdir(exist_ok=True)
        run([str(tools)+'ld','-r','--gc-sections','-u',symbol,'-u','mbedtls_notice','--wrap=malloc','--wrap=calloc','--wrap=free','--wrap=realloc_in_place',
             '-o',target,*map(peer,objects),peer(output/'audit-mbedtls.a')],ROOT)
        run([str(tools)+'objcopy','-G',symbol,'--strip-unneeded',target],ROOT);elf_machine(target,machine)
        defined=run([str(tools)+'nm','-g','--defined-only','-P',target],ROOT).splitlines()
        if [line.split()[0] for line in defined]!=[symbol]:raise ValueError('TLS backend symbols escaped closure')
        undefined=run([str(tools)+'nm','-u','-P',target],ROOT).splitlines()
        if any(line.split()[0].startswith(('mbedtls_','Hacl_','Everest_','__wrap_')) for line in undefined):raise ValueError('Unresolved TLS backend dependency: '+str(undefined))
        reports[arch]=dict(sha256=sha256(target),exported=[symbol],undefined=undefined)
    sources=['scripts/build_tls_client.py','native/tls/backend.c','native/tls/backend.h','native/tls/policy.c','native/tls/policy.h','native/tls/ca-bundle.pem']
    (output/'client.json').write_text(json.dumps(dict(format=1,backend_fingerprint=manifest['fingerprint'],inputs={p:sha256(ROOT/p) for p in sources},architectures=reports),indent=2)+'\n')
    print('PASS TLS client closure: dual architecture, localized backend, fixed CA')

if __name__=='__main__':main()
