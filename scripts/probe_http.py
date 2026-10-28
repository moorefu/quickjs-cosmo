#!/usr/bin/env python3
"""Record HTTP/Fetch inputs, standalone programs and both SDK symbol boundaries."""
import argparse,json
from pathlib import Path
from build_config import load_config
from build_native import run
from node_contract import ROOT,read_json
from prepare_native import sha256

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=ROOT/'build/test-linux');args=parser.parse_args();settings=load_config();output=args.output.resolve()
    if not output.is_relative_to((ROOT/'build').resolve()):raise ValueError('HTTP probe output escapes build/')
    sdk={};forbidden=('ParseHttpMessage','InitHttpMessage','ResetHttpMessage','DestroyHttpMessage','GetHttpHeader','kHttpToken','kHttpRepeatable')
    for arch,path in [('x86_64',settings.dist/'libquickjs.a'),('aarch64',settings.dist/'.aarch64/libquickjs.a')]:
        names=run([settings.toolchain/'bin'/(arch+'-linux-cosmo-nm'),'-g','-P',path],ROOT)
        escaped=[line.split()[0] for line in names.splitlines() if line.split() and line.split()[0] in forbidden]
        if escaped:raise ValueError('General HTTP parser escaped SDK closure: '+repr(escaped))
        sdk[arch]=dict(archive=path.relative_to(ROOT).as_posix(),sha256=sha256(path),general_parser_symbols=[])
    if any(p.name in {'http.h','binding.h'} for p in settings.dist.rglob('*.h')):raise ValueError('Private HTTP header escaped SDK')
    sources=['native/http/sources.json','native/http/LICENSE','native/http/binding.c','native/http/binding.h','scripts/build_http.py','scripts/probe_http.py','scripts/test_http.py','tests/native/http_parser.c','tests/native/http_client.c','tests/runtime_http.mjs','tests/fixtures/http-worker.mjs','tests/node/fixtures/http-service.mjs','tests/node/http.mjs','tests/node/http-lifecycle.mjs','tests/node/web-streams.mjs','tests/node/fetch-api.mjs','tests/node/fetch.mjs','tests/node/fetch-lifecycle.mjs','tests/node/fetch-upload-policy.mjs']
    report=dict(format=1,lock_sha256=sha256(ROOT/'native/http/sources.json'),sources={p:sha256(ROOT/p) for p in sources},sdk=sdk,binaries={(output/name).relative_to(ROOT).as_posix():sha256(output/name) for name in ['http-standalone.exe','http-parser-sdk.exe','http-client-sdk.exe']},scope='Private pinned HTTP header parser; public HTTP/Fetch JS subset and explicit upload cancellation policy, not a general parser SDK')
    target=ROOT/'build/native/http/probes.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print('PASS HTTP/Fetch provenance and private dual-architecture SDK boundary')

if __name__=='__main__':main()
