#!/usr/bin/env python3
"""Exercise inherited descriptors through the interpreter, qjsc and hand linked SDK."""
import argparse
import json
from pathlib import Path
import queue
import subprocess
import threading
import time
from host_runtime import ape_command

ROOT=Path(__file__).resolve().parents[1]
FIXTURE=ROOT/'tests/node/fixtures/process-stdio-child.mjs'

def line(pipe):
    result=queue.Queue()
    threading.Thread(target=lambda:result.put(pipe.readline()),daemon=True).start()
    return result.get(timeout=20)

def check(command,broken=True):
    data=bytes(range(256))*1024+b'abc'
    for mode in ('echo','pipe','pipeline'):
        run=subprocess.run(command(mode),input=data,capture_output=True,timeout=30,cwd=ROOT)
        assert run.returncode==0,(mode,run.returncode,run.stderr)
        if mode=='echo':
            value=json.loads(run.stdout)
            assert value==dict(count=len(data),sum=sum(data),identity=True,readable=True,writable=True,fd=[0,1,2],tty=[False]*3),value
            assert run.stderr==b'ACK',run.stderr
        else: assert run.stdout==data and run.stderr==b'ENDED:false',(mode,len(run.stdout),run.stderr)
    for mode in ('unref','ref','broken') if broken else ('unref','ref'):
        p=subprocess.Popen(command(mode),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT)
        try:
            ready=line(p.stderr if mode=='broken' else p.stdout)
            assert ready==b'READY\n',(mode,ready)
            if mode=='ref':
                time.sleep(.1);assert p.poll() is None,'stdin.ref did not keep the process alive'
                p.stdin.write(b'go');p.stdin.close();p.stdin=None
            elif mode=='broken':
                p.stdout.close();p.stdout=None
                p.stdin.write(b'go');p.stdin.close();p.stdin=None
            else: p.wait(timeout=20)
            stdout,stderr=p.communicate(timeout=20)
            assert p.returncode==0,(mode,p.returncode,stderr)
            if mode=='ref': assert stdout==b'DONE\n' and not stderr,(stdout,stderr)
            if mode=='broken': assert json.loads(stderr.removeprefix(b'ERROR '))==dict(name='Error',code='EPIPE',syscall='write'),stderr
        finally:
            if p.poll() is None:p.kill();p.wait()
            for pipe in (p.stdin,p.stdout,p.stderr):
                if pipe:pipe.close()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qjs',required=True,type=Path)
    parser.add_argument('--compiled',required=True,type=Path)
    parser.add_argument('--sdk',required=True,type=Path)
    parser.add_argument('--node',type=Path)
    args=parser.parse_args()
    if args.node:check(lambda mode:[str(args.node.resolve()),str(FIXTURE),mode])
    check(lambda mode:ape_command(args.qjs.resolve(),['-m',str(FIXTURE),mode],args.qjs.resolve().parent))
    check(lambda mode:ape_command(args.compiled.resolve(),[mode],args.qjs.resolve().parent))
    check(lambda mode:ape_command(args.sdk.resolve(),[str(FIXTURE),mode],args.qjs.resolve().parent))
    teardown=subprocess.run(ape_command(args.sdk.resolve(),[str(FIXTURE),'teardown'],args.qjs.resolve().parent),input=b'',capture_output=True,timeout=30,cwd=ROOT)
    assert teardown.returncode==0,(teardown.returncode,teardown.stderr)
    print('PASS stdio all entries: binary input, backpressure, output lifetime, references and EPIPE')

if __name__=='__main__':main()
