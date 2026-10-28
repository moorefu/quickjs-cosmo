#!/usr/bin/env python3
"""Run the documented portable examples against pinned Node and the APE."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from host_runtime import ape_command,host_info,node_oracle_key
from node_contract import ROOT,read_json
from test_node_compat import node_identity

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        data=b'{"message":"portable-network","value":42}'
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--qjs',required=True,type=Path);parser.add_argument('--node',type=Path);args=parser.parse_args()
    host=host_info();node=args.node or ROOT/('toolchains/node-v24.21.0-'+node_oracle_key(host))/('node.exe' if os.name=='nt' else 'bin/node')
    node=node.resolve();node_identity(node,ROOT,read_json(ROOT/'compat/node-baseline.json'))
    service=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=service.serve_forever,daemon=True);thread.start()
    try:
        for name,arguments in [('portable-core.mjs',[]),('portable-fetch.mjs',['http://127.0.0.1:'+str(service.server_port)+'/example'])]:
            fixture=ROOT/'examples'/name;values=[]
            for command in ([str(node),str(fixture),*arguments],ape_command(args.qjs.resolve(),['-m',str(fixture),*arguments],args.qjs.resolve().parent)):
                result=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding='utf8',timeout=30)
                if result.returncode:raise ValueError(name+': '+result.stderr)
                values.append(json.dumps(json.loads(result.stdout),sort_keys=True))
            if values[0]!=values[1]:raise ValueError('Example results differ: '+name)
    finally:service.shutdown();service.server_close();thread.join(timeout=5)
    print('PASS portable examples: filesystem, streams, compression, crypto, process and Fetch on Node/QuickJS')

if __name__=='__main__':main()
