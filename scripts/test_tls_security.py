#!/usr/bin/env python3
"""Offline TLS policy regression against independent host TLS endpoints."""
import argparse
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
from host_runtime import ape_command,host_info,node_oracle_key
from node_contract import ROOT,read_json
from test_node_compat import node_identity


class Endpoint:
    def __init__(self,folder,label,cipher,version,ipv6=False):
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version=context.maximum_version=version;context.set_ciphers(cipher+':@SECLEVEL=0')
        context.load_cert_chain(folder/(label+'.pem'),folder/(label+'.key'))
        self.names=[];context.sni_callback=lambda sock,name,ctx:self.names.append(name)
        self.socket=socket.socket(socket.AF_INET6 if ipv6 else socket.AF_INET);self.socket.bind(('::1' if ipv6 else '127.0.0.1',0));self.socket.listen(1);self.socket.settimeout(10)
        self.port=self.socket.getsockname()[1];self.error=None
        def serve():
            try:
                connection,_=self.socket.accept()
                with connection:
                    connection.settimeout(8)
                    with context.wrap_socket(connection,server_side=True):pass
            except (ssl.SSLError,ConnectionError):pass
            except OSError as error:self.error=error
        self.thread=threading.Thread(target=serve,daemon=True);self.thread.start()
    def close(self):
        self.socket.close();self.thread.join(timeout=11)
        if self.thread.is_alive() or self.error:raise ValueError('TLS endpoint did not close cleanly: '+str(self.error))


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--probe',type=Path,required=True);parser.add_argument('--node',type=Path)
    args=parser.parse_args();host=host_info();key=node_oracle_key(host)
    node=(args.node or ROOT/'toolchains'/('node-v24.21.0-'+key)/('node.exe' if os.name=='nt' else 'bin/node')).resolve()
    inventory=read_json(ROOT/'compat/node-api.json');node_identity(node,ROOT,read_json(ROOT/inventory['node_baseline']))
    command=ape_command(args.probe.resolve(),[],ROOT/'dist');count=0
    def run(arguments,accepted=True,marker=None):
        nonlocal count
        result=subprocess.run([*map(str,command),*map(str,arguments)],cwd=ROOT,capture_output=True,text=True,timeout=15)
        if result.returncode!=(0 if accepted else 2) or (marker or ('ACCEPT TLSv1.2' if accepted else 'REJECT')) not in result.stdout:
            raise ValueError('TLS regression failed '+repr(arguments)+': '+str(result.returncode)+'\n'+result.stdout+result.stderr)
        count+=1
    with tempfile.TemporaryDirectory(prefix='qjs-tls-security-') as temp:
        folder=Path(temp);subprocess.run([str(node),str(ROOT/'tests/fixtures/tls-certificates.mjs'),str(folder)],check=True,capture_output=True,timeout=60)
        for i,expected in enumerate([1,0,0,0,-1,-1,-1,-1]):run(['--cert',folder/('der-'+str(i)+'.pem'),expected],marker='PASS tls-policy-cert')
        def connect(label='rsa',cipher='ECDHE-RSA-AES128-GCM-SHA256',version=ssl.TLSVersion.TLSv1_2,identity='127.0.0.1',accepted=True,ca=None,rng=False):
            endpoint=Endpoint(folder,label,cipher,version,ipv6=identity=='::1')
            try:
                run(['::1' if identity=='::1' else '127.0.0.1',endpoint.port,identity,ca or folder/'ca.pem',int(rng)],accepted,marker='ACCEPT TLSv1.2' if accepted else 'REJECT handshake')
                if accepted and endpoint.names!=[None if ':' in identity or identity=='127.0.0.1' else identity]:raise ValueError('TLS SNI identity mismatch '+repr(endpoint.names))
            finally:endpoint.close()
        for label,kind in [('rsa','RSA'),('ecdsa','ECDSA')]:
            for bits,hashname in [(128,'SHA256'),(256,'SHA384')]:connect(label,'ECDHE-'+kind+'-AES'+str(bits)+'-GCM-'+hashname)
        connect(identity='localhost');connect(identity='::1');connect(rng=True,accepted=False)
        connect('p521-leaf',ca=folder/'p521-ca.pem');connect('p521-badsig',ca=folder/'p521-ca.pem',accepted=False)
        for label in ['cn-ip','dns-ip','wrong-ip','expired','future','weak-rsa','weak-hash']:connect(label,accepted=False)
        connect('wrong-dns',identity='localhost',accepted=False);connect(ca=ROOT/'native/tls/ca-bundle.pem',accepted=False)
        for cipher in ['ECDHE-RSA-AES128-SHA256','AES128-GCM-SHA256']:connect(cipher=cipher,accepted=False)
        for version in [ssl.TLSVersion.TLSv1,ssl.TLSVersion.TLSv1_1,ssl.TLSVersion.TLSv1_3]:connect(cipher='ALL',version=version,accepted=False)
    print('PASS TLS security policy: '+str(count)+' offline cases, no skipped loopback families')


if __name__=='__main__':main()
