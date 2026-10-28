#!/usr/bin/env python3
"""Loopback HTTP/Fetch all-entry contracts and explicit upload-cleanup policy."""
import argparse
import gzip
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from host_runtime import ape_command,host_info,node_oracle_key
from node_contract import ROOT,read_json
from prepare_native import sha256
from test_node_compat import node_identity

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def setup(self):super().setup();self.connection.settimeout(10)
    def send(self,data,encoding=None):
        self.send_response(200);self.send_header('Content-Length',str(len(data)));self.send_header('X-Project-Test','http')
        if encoding:self.send_header('Content-Encoding',encoding)
        self.end_headers();self.wfile.write(data)
    def do_GET(self):
        try:
            if self.path=='/stall':self.server.stop.wait(15);return
            if self.path=='/stall-body':
                self.send_response(200);self.send_header('Transfer-Encoding','chunked');self.end_headers();self.wfile.write(b'5\r\nfirst\r\n');self.wfile.flush();self.server.stop.wait(15);return
            if self.path=='/gzip':self.send(gzip.compress('compressed 中文'.encode(),mtime=0),'gzip')
            else:self.send(b'x'*(262147 if self.path=='/bytes' else 17003))
        except (OSError,TimeoutError):pass
    def do_POST(self):
        try:
            if self.headers.get('Transfer-Encoding','').lower()=='chunked':
                chunks=[]
                while True:
                    line=self.rfile.readline(16384)
                    if not line:return
                    size=int(line.split(b';',1)[0],16)
                    if not size:self.rfile.readline();break
                    data=self.rfile.read(size)
                    if len(data)!=size:return
                    chunks.append(data)
                    if self.rfile.read(2)!=b'\r\n':return
                body=b''.join(chunks)
            else:body=self.rfile.read(int(self.headers.get('Content-Length','0')))
            self.send(body)
        except (OSError,TimeoutError,ValueError):pass

class Service(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,address):self.stop=threading.Event();self.connections=set();self.lock=threading.Lock();super().__init__(address,Handler)
    def get_request(self):
        connection,address=super().get_request()
        with self.lock:self.connections.add(connection)
        return connection,address
    def close_request(self,request):
        with self.lock:self.connections.discard(request)
        super().close_request(request)
    def finish(self):
        self.stop.set();self.shutdown()
        with self.lock:connections=list(self.connections)
        for connection in connections:
            try:connection.shutdown(socket.SHUT_RDWR)
            except OSError:pass
            connection.close()
        self.server_close()
class Service6(Service):address_family=socket.AF_INET6

def run(command,environment,marker=None):
    completed=subprocess.run(list(map(str,command)),env=environment,cwd=ROOT,capture_output=True,text=True,encoding='utf8',timeout=180)
    if completed.returncode or marker and marker not in completed.stdout:raise ValueError('HTTP contract failed: '+str(command)+'\n'+completed.stdout+completed.stderr)
    return completed.stdout

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--qjs',type=Path,required=True);parser.add_argument('--compiled',type=Path);parser.add_argument('--sdk',type=Path);parser.add_argument('--node',type=Path)
    args=parser.parse_args();host=host_info();key=node_oracle_key(host);node=(args.node or ROOT/'toolchains'/('node-v24.21.0-'+key)/('node.exe' if os.name=='nt' else 'bin/node')).resolve();identity=node_identity(node,ROOT,read_json(ROOT/'compat/node-baseline.json'))
    services=[Service(('127.0.0.1',0)),Service6(('::1',0))];threads=[]
    for service in services:
        thread=threading.Thread(target=service.serve_forever,daemon=True);thread.start();threads.append(thread)
    environment=dict(os.environ,NODE_COMPAT_HTTP_PORT=str(services[0].server_address[1]),NODE_COMPAT_HTTP_PORT6=str(services[1].server_address[1]),NODE_COMPAT_CHILD_EXECUTABLE=str(node))
    records=[]
    try:
        for program,flags,marker in [(args.qjs,['-m',str(ROOT/'tests/runtime_http.mjs')],'PASS runtime-http-fetch'),(args.compiled,[],'PASS runtime-http-fetch'),(args.sdk,[],'PASS http-client-sdk')]:
            if not program:continue
            stdout=run(ape_command(program.resolve(),flags,ROOT/'dist'),environment,marker);print(stdout,end='');records.append(dict(program=str(program),sha256=sha256(program),marker=marker))
        fixture=ROOT/'tests/node/fetch-upload-policy.mjs';observations={}
        for name,command in [('node',[node,fixture]),('qjs',ape_command(args.qjs.resolve(),['-m',str(fixture)],ROOT/'dist'))]:
            output=run(command,environment);lines=[line for line in output.splitlines() if line.startswith('NODE_COMPAT_RESULT ')]
            if len(lines)!=1:raise ValueError('Missing upload policy observation')
            observations[name]=json.loads(lines[0].split(' ',1)[1])
        if observations['node']['outcome']!='upload-stop' or observations['qjs']!=dict(outcome='upload-stop',cancelCalls=1,cancelReason='upload-stop',locked=False):raise ValueError('Upload cleanup contract failed: '+json.dumps(observations))
        print('UPLOAD_CANCEL_POLICY '+json.dumps(observations,ensure_ascii=True))
        report=dict(format=1,host=host,node=identity,entries=records,upload_policy=observations,declared_difference='Input upload is actively cancelled with signal.reason and unlocked; Node reference observations are preserved, not counted as same-semantics compatibility',fixture_sha256=sha256(fixture))
        target=ROOT/'build/node-compat'/('http-fetch-policy-'+host['system']+'.json');target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
        print('PASS HTTP/Fetch entries and explicit upload cancellation policy')
    finally:
        for service in services:service.finish()
        for thread in threads:thread.join(timeout=5)

if __name__=='__main__':main()
