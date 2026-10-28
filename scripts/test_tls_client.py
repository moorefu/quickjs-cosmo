#!/usr/bin/env python3
"""Compare the public TLS client with pinned Node against local TLS services."""
import argparse
import json
import os
from pathlib import Path
import socket
import socketserver
import ssl
import subprocess
import tempfile
import threading
from host_runtime import ape_command,host_info,node_oracle_key
from test_node_compat import node_identity
from node_contract import ROOT,read_json

class Service(socketserver.ThreadingTCPServer):
    daemon_threads=True
    allow_reuse_address=False
class Service6(Service):address_family=socket.AF_INET6

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(4)
        if self.server.slow:
            self.server.stop.wait(3);return
        try:
            with self.server.context.wrap_socket(self.request,server_side=True) as stream:
                while data:=stream.recv(16384):stream.sendall(data)
                stream.unwrap()
        except (OSError,TimeoutError,ssl.SSLError):pass

def result(command,environment):
    run=subprocess.run(list(map(str,command)),env=environment,cwd=ROOT,capture_output=True,text=True,timeout=20)
    lines=[line for line in run.stdout.splitlines() if line.startswith('NODE_COMPAT_RESULT ')]
    if run.returncode or len(lines)!=1:raise ValueError('TLS client failed ('+str(run.returncode)+'): '+str(command)+'\n'+run.stdout+run.stderr)
    return json.loads(lines[0].split(' ',1)[1])

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--qjs',type=Path,required=True);parser.add_argument('--node',type=Path)
    parser.add_argument('--compiled',type=Path);parser.add_argument('--worker',type=Path);parser.add_argument('--sdk',type=Path)
    args=parser.parse_args();key=node_oracle_key(host_info());node=(args.node or ROOT/'toolchains'/('node-v24.21.0-'+key)/('node.exe' if os.name=='nt' else 'bin/node')).resolve();node_identity(node,ROOT,read_json(ROOT/'compat/node-baseline.json'))
    with tempfile.TemporaryDirectory(prefix='qjs-tls-',dir=ROOT/'build') as temporary:
        folder=Path(temporary)
        subprocess.run([str(node),str(ROOT/'tests/fixtures/tls-certificates.mjs'),str(folder)],check=True,capture_output=True)
        for mode,cert in [('echo','rsa'),('no-sni','ecdsa'),('ipv6','rsa'),('wrong-dns','wrong-dns'),('wrong-ip','wrong-ip'),('dns-ip','dns-ip'),('cn-ip','cn-ip'),('expired','expired'),('future','future'),('untrusted','rsa'),('abort','rsa'),('timeout','rsa')]:
            context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.minimum_version=context.maximum_version=ssl.TLSVersion.TLSv1_2
            context.set_ciphers('ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256');context.load_cert_chain(folder/(cert+'.pem'),folder/(cert+'.key'))
            seen=[];context.set_servername_callback(lambda stream,name,context:seen.append(name))
            host='::1' if mode=='ipv6' else '127.0.0.1'
            with (Service6 if mode=='ipv6' else Service)((host,0),Handler) as server:
                server.context=context;server.slow=mode in ('abort','timeout');server.stop=threading.Event()
                thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
                environment=dict(os.environ,NODE_COMPAT_TLS_MODE=mode,NODE_COMPAT_TLS_HOST=host,NODE_COMPAT_TLS_PORT=str(server.server_address[1]),NODE_COMPAT_TLS_CA=str(folder/'ca.pem'))
                try:
                    fixture=ROOT/'tests/node-compat/tls.mjs'
                    expected=result([node,fixture],environment)
                    actual=result(ape_command(args.qjs.resolve(),['-m',str(fixture)],ROOT/'dist'),environment)
                    if actual!=expected:raise ValueError(mode+' TLS mismatch\nNode '+json.dumps(expected)+'\nqjs  '+json.dumps(actual))
                    sni=None if mode in ('no-sni','ipv6','wrong-ip','dns-ip','cn-ip') else 'localhost'
                    expected_names=[sni,sni]
                    if args.compiled:
                        actual=result(ape_command(args.compiled.resolve(),[],ROOT/'dist'),environment)
                        if actual!=expected:raise ValueError(mode+' compiled TLS mismatch: '+json.dumps(actual))
                        expected_names.append(sni)
                    if mode not in ('abort','timeout') and seen!=expected_names:raise ValueError('SNI mismatch: '+repr(seen))
                    if mode=='echo':
                        for program,flags,marker in [(args.qjs,['-m',str(ROOT/'tests/runtime_tls.mjs')],'PASS runtime-tls'),(args.worker,[],'PASS runtime-tls'),(args.sdk,[],'PASS tls-client-sdk')]:
                            if not program:continue
                            run=subprocess.run(ape_command(program.resolve(),flags,ROOT/'dist'),env=environment,cwd=ROOT,capture_output=True,text=True,timeout=90)
                            if run.returncode or marker not in run.stdout:raise ValueError('TLS entry failed: '+str(program)+'\n'+run.stdout+run.stderr)
                            print('PASS TLS entry '+str(program.name)+' '+marker,flush=True)
                    print('PASS TLS client '+mode,flush=True)
                finally:server.stop.set();server.shutdown();thread.join(timeout=5)

if __name__=='__main__':main()
