#!/usr/bin/env python3
"""Verify HTTPS/Fetch against independent local Python TLS/HTTP services."""
import argparse,json,os,socket,ssl,subprocess,tempfile,threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler
from test_http import Service,Service6,run
from host_runtime import ape_command,host_info,node_oracle_key
from node_contract import ROOT,read_json
from test_node_compat import node_identity
from prepare_native import sha256
import gzip

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def setup(self):super().setup();self.connection.settimeout(10)
    def finish(self):
        super().finish()
        # End the TLS stream with close_notify. A bare SSLSocket.close() is a
        # truncated TLS stream under the runtime's admitted strict EOF policy.
        if isinstance(self.connection,ssl.SSLSocket):
            try:self.connection.settimeout(1);self.connection.unwrap()
            except OSError:pass
    def send(self,data,encoding=None,status=200,location=None):
        self.send_response(status);self.send_header('Content-Length',str(len(data)))
        if encoding:self.send_header('Content-Encoding',encoding)
        if location:self.send_header('Location',location)
        self.end_headers();self.wfile.write(data)
    def body(self):
        if self.headers.get('Transfer-Encoding','').lower()=='chunked':
            chunks=[]
            while True:
                size=int(self.rfile.readline(16384).split(b';',1)[0],16)
                if not size:self.rfile.readline();return b''.join(chunks)
                data=self.rfile.read(size)
                if len(data)!=size or self.rfile.read(2)!=b'\r\n':raise OSError('Truncated upload')
                chunks.append(data)
        return self.rfile.read(int(self.headers.get('Content-Length','0')))
    def do_GET(self):
        try:
            if self.path=='/stall':self.server.stop.wait(15);return
            if self.path=='/stall-body':
                self.send_response(200);self.send_header('Transfer-Encoding','chunked');self.end_headers();self.wfile.write(b'5\r\nfirst\r\n');self.wfile.flush();self.server.stop.wait(15);return
            if self.path=='/gzip':self.send(gzip.compress('HTTPS compressed 中文'.encode(),mtime=0),'gzip');return
            if self.path=='/corrupt':self.send(b'broken','gzip');return
            if self.path in ('/redirect','/upgrade','/downgrade'):
                target='' if self.path=='/redirect' else ('http://127.0.0.1:'+str(self.server.plain_port) if self.path=='/downgrade' else 'https://localhost:'+str(self.server.secure_port))
                self.send(b'',status=302,location=target+'/echo');return
            if self.path in ('/small','/bytes'):self.send(b'x'*(17003 if self.path=='/small' else 262147));return
            body=self.body();self.send(json.dumps(dict(method=self.command,body=body.hex(),auth=self.headers.get('Authorization'),cookie=self.headers.get('Cookie'),sni=getattr(self.connection,'project_sni',None)),ensure_ascii=True).encode())
        except (OSError,TimeoutError,ValueError):pass
    do_POST=do_GET

class TLSService(Service):
    def get_request(self):
        raw,address=super().get_request();raw.settimeout(5)
        try:stream=self.context.wrap_socket(raw,server_side=True)
        except OSError:self.close_request(raw);raise
        with self.lock:self.connections.discard(raw);self.connections.add(stream)
        return stream,address
class TLSService6(TLSService):address_family=socket.AF_INET6

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--qjs',required=True,type=Path);parser.add_argument('--node',type=Path);parser.add_argument('--compiled',type=Path);parser.add_argument('--sdk',type=Path);args=parser.parse_args()
    host=host_info();key=node_oracle_key(host);node=(args.node or ROOT/'toolchains'/('node-v24.21.0-'+key)/('node.exe' if os.name=='nt' else 'bin/node')).resolve();identity=node_identity(node,ROOT,read_json(ROOT/'compat/node-baseline.json'))
    with tempfile.TemporaryDirectory(prefix='https-',dir=ROOT/'build') as temporary:
        folder=Path(temporary);subprocess.run([str(node),str(ROOT/'tests/fixtures/tls-certificates.mjs'),str(folder)],check=True,capture_output=True,timeout=30)
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.minimum_version=context.maximum_version=ssl.TLSVersion.TLSv1_2;context.options|=ssl.OP_NO_TICKET
        context.set_ciphers('ECDHE-RSA-AES128-GCM-SHA256');context.load_cert_chain(folder/'rsa.pem',folder/'rsa.key');context.set_servername_callback(lambda stream,name,ctx:setattr(stream,'project_sni',name))
        services=[TLSService(('127.0.0.1',0)),TLSService6(('::1',0)),Service(('127.0.0.1',0))];threads=[];records=[]
        for server in services:
            server.RequestHandlerClass=Handler;server.context=context;server.secure_port=services[0].server_address[1];server.plain_port=services[2].server_address[1]
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();threads.append(thread)
        env=dict(os.environ,NODE_EXTRA_CA_CERTS=str(folder/'ca.pem'),NODE_COMPAT_HTTPS_CA=str(folder/'ca.pem'),NODE_COMPAT_HTTPS_PORT=str(services[0].server_address[1]),NODE_COMPAT_HTTPS_PORT6=str(services[1].server_address[1]),NODE_COMPAT_HTTPS_PLAIN=str(services[2].server_address[1]))
        try:
            for program,flags,marker in [(args.qjs,['-m',str(ROOT/'tests/runtime_https.mjs')],'PASS runtime-https'),(args.compiled,[],'PASS runtime-https'),(args.sdk,[],'PASS https-client-sdk')]:
                if program:
                    print(run(ape_command(program.resolve(),flags,ROOT/'dist'),env,marker),end='',flush=True);records.append(dict(program=str(program),sha256=sha256(program),marker=marker))
            target=ROOT/'build/node-compat'/('https-entries-'+host['system']+'.json');target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(dict(format=1,host=host,node=identity,entries=records,fixture_sha256=sha256(ROOT/'tests/runtime_https.mjs')),indent=2)+'\n',encoding='utf8');print('PASS HTTPS all entries',flush=True)
        finally:
            for server in services:server.finish()
            for thread in threads:thread.join(timeout=5)

if __name__=='__main__':main()
