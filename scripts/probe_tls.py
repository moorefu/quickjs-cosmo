#!/usr/bin/env python3
"""Build private TLS regression APEs and audit the delivered SDK symbol boundary."""
import argparse
import json
from pathlib import Path
from build_config import load_config
from build_native import run
from build_tls import build
from node_contract import ROOT,read_json
from prepare_native import sha256


def sdk_boundary(settings):
    records={}
    for arch,archive in [('x86_64',settings.dist/'libquickjs.a'),('aarch64',settings.dist/'.aarch64/libquickjs.a')]:
        output=run([settings.toolchain/'bin'/(arch+'-linux-cosmo-nm'),'-g','-P',archive],ROOT)
        forbidden=[line.split()[0] for line in output.splitlines() if line.split() and line.split()[0].startswith(('mbedtls_','Hacl_','Everest_'))]
        if forbidden:raise ValueError('General crypto/TLS backend escaped SDK closure: '+repr(forbidden[:20]))
        records[arch]=dict(archive=archive.relative_to(ROOT).as_posix(),sha256=sha256(archive),general_backend_symbols=[])
    if any(p.name!='libquickjs.a' for p in settings.dist.rglob('*.a')):raise ValueError('General backend archive leaked into SDK')
    if any(p.name.startswith(('mbedtls','hacl','ssl')) for p in settings.dist.rglob('*.h')):raise ValueError('General TLS/crypto header leaked into SDK')
    return records


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--offline',action='store_true');parser.add_argument('--output',type=Path,default=ROOT/'build/test-linux')
    args=parser.parse_args();settings=load_config();output=args.output.resolve()
    if not output.is_relative_to((ROOT/'build').resolve()):raise ValueError('TLS probe output must stay in build/')
    output.mkdir(parents=True,exist_ok=True);backend,manifest=build(offline=args.offline)
    lock=read_json(ROOT/'native/tls/security.json');matrix=read_json(ROOT/'native/tls/advisories.json')
    expected={r['id']:r for r in lock['advisories']['records']};actual={r['id']:r['source'] for r in matrix['records']}
    if actual!=expected or len(matrix['records'])!=55 or matrix['counts']['unfixed_raw_backend']!=14 or matrix.get('general_backend_admitted') is not False:
        raise ValueError('TLS advisory scope changed; a fresh source/security review is required')
    source=ROOT/'upstream/cosmopolitan-native-aefad27c09ff';overlay=backend/'source'
    common=[settings.toolchain/'bin/cosmocc','-std=gnu23','-O2','-D_GNU_SOURCE','-D_COSMO_SOURCE','-I'+str(overlay),'-I'+str(source),'-I'+str(ROOT/'native')]
    commands=[]
    for name,files,wrap in [
        ('tls-security-sdk.exe',[ROOT/'tests/native/tls_security.c'],'-Wl,--wrap=calloc,--wrap=getrandom'),
        ('tls-policy-sdk.exe',[ROOT/'tests/native/tls_policy.c',ROOT/'native/tls/policy.c'],'-Wl,--wrap=getrandom')]:
        command=[*common,*files,ROOT/'compat/host_exit.c',backend/'audit-mbedtls.a',wrap,'-Wl,--wrap=_Exit,-u,__wrap__Exit','-lpthread','-o',output/name]
        run(command,ROOT);commands.append(list(map(str,command)))
    sources=['tests/native/tls_security.c','tests/native/tls_policy.c','native/tls/policy.c','native/tls/policy.h',
             'native/crypto/aead.c','native/tls/mbedtls-security.patch','tests/fixtures/tls-certificates.mjs','scripts/test_tls_security.py','scripts/probe_tls.py']
    report=dict(format=1,lock_sha256=sha256(ROOT/'native/tls/security.json'),backend_fingerprint=manifest['fingerprint'],
                sources={name:sha256(ROOT/name) for name in sources},
                binaries={(output/name).relative_to(ROOT).as_posix():sha256(output/name) for name in ['tls-security-sdk.exe','tls-policy-sdk.exe']},
                sdk=sdk_boundary(settings),commands=commands,scope='Private audit probes; no general TLS SDK API; public TLS awaits M5-03')
    (ROOT/'build/native/tls/probes.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print('PASS TLS security probe build and SDK symbol boundary for both architectures')


if __name__=='__main__':main()
