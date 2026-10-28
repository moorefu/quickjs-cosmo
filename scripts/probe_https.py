#!/usr/bin/env python3
"""Bind HTTPS sources, standalone programs and private TLS SDK closures."""
import argparse,json
from pathlib import Path
from build_config import load_config
from node_contract import ROOT
from prepare_native import sha256
from probe_tls import sdk_boundary

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=ROOT/'build/test-linux');args=parser.parse_args();output=args.output.resolve();settings=load_config()
    if not output.is_relative_to((ROOT/'build').resolve()):raise ValueError('HTTPS probe output escapes build/')
    names=['scripts/probe_https.py','scripts/test_https.py','scripts/embed_js.py','src/js/node/http.js','src/js/node/https.js','src/js/node/tls.js','src/js/internal/fetch.js','native/net/socket.c','native/tls/backend.c','native/tls/backend.h','native/tls/security.json','tests/runtime_https.mjs','tests/fixtures/https-worker.mjs','tests/fixtures/tls-certificates.mjs','tests/native/https_client.c','tests/node/https-api.mjs','tests/node/https.mjs','tests/node/https-ca.mjs','tests/node/fixtures/https-service.mjs','tests/node/fixtures/https-client.mjs','tests/node/fixtures/https-ca-child.mjs']
    names+=['src/js/internal/web-streams.js','tests/node/fetch-lifecycle.mjs']
    report=dict(format=1,lock_sha256=sha256(ROOT/'native/tls/security.json'),sources={n:sha256(ROOT/n) for n in names},binaries={(output/n).relative_to(ROOT).as_posix():sha256(output/n) for n in ['https-standalone.exe','https-client-sdk.exe']},sdk=sdk_boundary(settings),scope='Admitted TLS1.2 HTTP client and HTTPS Fetch; no general TLS SDK')
    target=ROOT/'build/native/https/probes.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print('PASS HTTPS provenance and private dual-architecture SDK boundary')

if __name__=='__main__':main()
