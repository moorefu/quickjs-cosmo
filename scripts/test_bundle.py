#!/usr/bin/env python3
"""Independent ZIP interoperability, bounded failures and transported QJB applications."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zipfile
from host_runtime import ape_command

ROOT=Path(__file__).resolve().parents[1]
PACKAGES=tuple('build/qjb/'+name+'.qjb' for name in ('store','deflate','descriptor','self-store','self-deflate','script'))


def run(executable,args,cwd,*,env=None,success=True,contains=None,timeout=15):
    command=ape_command(executable,args,ROOT/'dist')
    result=subprocess.run(list(map(str,command)),cwd=cwd,env=env,text=True,encoding='utf-8',errors='replace',
                          stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    if (result.returncode==0)!=success or (contains and contains not in result.stdout):
        raise AssertionError(f'{command!r}: exit {result.returncode}\n{result.stdout[:4000]}')
    return result


class DescriptorStream(io.BytesIO):
    def seek(self,*args):
        raise OSError('nonseekable ZIP producer')


def archive(files,method=zipfile.ZIP_STORED,descriptor=False):
    stream=DescriptorStream() if descriptor else io.BytesIO()
    with zipfile.ZipFile(stream,'w',compression=method) as z:
        for name,content in files:
            z.writestr(name,content)
    return stream.getvalue()


def prepare(qjs):
    target=ROOT/'build/qjb';target.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='qjb source 中文 ',dir=ROOT/'build') as temporary:
        source=Path(temporary)/'app';shutil.copytree(ROOT/'tests/fixtures/qjb-app',source)
        (source/'assets/bytes.bin').write_bytes(bytes([0,1,255,128]))
        files=[(p.relative_to(source).as_posix(),p.read_bytes()) for p in sorted(source.rglob('*')) if p.is_file()]
        for name,method,descriptor in [('store',0,False),('deflate',8,False),('descriptor',8,True)]:
            (target/(name+'.qjb')).write_bytes(archive(files,method,descriptor))
        for name,options in [('self-store',[]),('self-deflate',['--deflate'])]:
            output=target/(name+'.qjb')
            run(qjs,[ROOT/'tools/qjb-pack.mjs',source,'-o',output,*options],ROOT,contains='"format":"qjb"')
            first=output.read_bytes()
            run(qjs,[ROOT/'tools/qjb-pack.mjs',source,'-o',output,*options],ROOT)
            assert output.read_bytes()==first,'Packer output is not reproducible'
            with zipfile.ZipFile(output) as z:
                assert z.testzip() is None
                assert {n:z.read(n) for n in z.namelist() if not n.endswith('/')}==dict(files),'Source bytes changed during packaging'
                assert all(z.read(n)==b'' for n in z.namelist() if n.endswith('/'))
        # Existing output and temporary output must not be collected into themselves.
        inside=source/'inside.qjb';inside.write_bytes(b'old output')
        run(qjs,[ROOT/'tools/qjb-pack.mjs',source,'-o',inside],ROOT)
        with zipfile.ZipFile(inside) as z:
            assert 'inside.qjb' not in z.namelist() and not any('.qjb-tmp-' in n for n in z.namelist())
        run(qjs,[ROOT/'tools/qjb-pack.mjs',source,'-o',target/'missing-parent'/'bad.qjb'],ROOT,success=False,contains='qjb-pack:')
        assert not list(target.glob('**/*.qjb-tmp-*')),'Failed packaging left temporary files'
        # An exclusive-create failure must preserve a preexisting temporary file.
        wrapper=Path(temporary)/'existing-temp.mjs';existing=Path(temporary)/'existing.qjb'
        wrapper.write_text("import fs from 'node:fs';import process from 'node:process';"+
                           "const tmp=process.argv[4]+'.qjb-tmp-'+process.pid;fs.writeFileSync(tmp,'keep');"+
                           'await import('+json.dumps((ROOT/'tools/qjb-pack.mjs').as_posix())+');'+
                           "if(fs.readFileSync(tmp,'utf8')!=='keep')throw Error('temporary was removed');console.log('existing temporary preserved');",encoding='utf-8')
        run(qjs,[wrapper,source,'-o',existing],ROOT,success=False,contains='existing temporary preserved')
        (source/'bundle.json').write_text('{}',encoding='utf-8')
        run(qjs,[ROOT/'tools/qjb-pack.mjs',source,'-o',target/'invalid.qjb'],ROOT,success=False,contains='Expected QJB')
        assert not (target/'invalid.qjb').exists()
    script=[('bundle.json',json.dumps(dict(format='qjb',formatVersion=1,entry='main.js',type='script'))),
            ('main.js',"globalThis.classicScript=true;import('./dependency.js').then(m=>console.log('PASS qjb-script',m.answer));"),
            ('dependency.js',"if(!globalThis.classicScript)throw Error('not script mode');export const answer=42;")]
    (target/'script.qjb').write_bytes(archive(script,8))
    (target/'packages.json').write_text(json.dumps({p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in PACKAGES},indent=2)+'\n',encoding='utf-8')


def negative(qjs,folder):
    manifest=json.dumps(dict(format='qjb',formatVersion=1,entry='main.mjs')).encode()
    files=[('bundle.json',manifest),('main.mjs',b"console.log('SHOULD_NOT_RUN')")]
    original=archive(files)
    cases=[]
    def changed(label,offset,fmt,value,code='ERR_QJB_FORMAT'):
        data=bytearray(original);struct.pack_into(fmt,data,offset,value);cases.append((label,data,code))
    cd=original.index(b'PK\x01\x02');end=original.rindex(b'PK\x05\x06')
    cases.append(('truncated',original[:-3],'ERR_QJB_FORMAT'))
    changed('multivolume',end+4,'<H',1)
    changed('zip64',end+16,'<I',0xffffffff)
    changed('encryption',cd+8,'<H',1)
    changed('symlink',cd+38,'<I',0o120777<<16)
    changed('local-mismatch',8,'<H',8)
    changed('method',cd+10,'<H',99)
    changed('version',cd+6,'<H',45)
    changed('member-limit',cd+24,'<I',8*1024*1024+1,'ERR_QJB_LIMIT')
    changed('bad-range',cd+42,'<I',len(original)+1)
    for name in ['../escape','/absolute','x/../a','x//a','C:x']:
        cases.append(('path-'+str(len(cases)),archive(files+[(name,b'x')]),'ERR_QJB_PATH'))
    # zipfile normalizes backslashes on Windows; mutate both actual ZIP names.
    cases.append(('backslash',archive(files+[('x-a',b'x')]).replace(b'x-a',b'x\\a'),'ERR_QJB_PATH'))
    cases.append(('name-utf8',archive(files+[('x-a',b'x')]).replace(b'x-a',b'x\xffa'),'ERR_QJB_PATH'))
    cases.append(('name-nul',archive(files+[('x-a',b'x')]).replace(b'x-a',b'x\x00a'),'ERR_QJB_PATH'))
    for additions in [[('main.mjs',b'other')],[('src',b'x'),('src/x.mjs',b'y')],[('src/',b''),('src',b'x')]]:
        cases.append(('conflict-'+str(len(cases)),archive(files+additions),'ERR_QJB_PATH'))
    data=bytearray(original);data[original.index(b'SHOULD_NOT_RUN')]=ord('X');cases.append(('crc',data,'ERR_QJB_FORMAT'))
    # Both declared sizes fit quotas, but DEFLATE actually yields more bytes.
    bomb=bytearray(archive([('bundle.json',manifest),('main.mjs',b'x'*100000)],8))
    last=bomb.index(b'PK\x01\x02',bomb.index(b'PK\x01\x02')+1);local=struct.unpack_from('<I',bomb,last+42)[0]
    struct.pack_into('<I',bomb,last+24,1);struct.pack_into('<I',bomb,local+22,1)
    cases.append(('actual-size',bomb,'ERR_QJB_FORMAT'))
    for content in [b'{}',b'{',b'\xff',json.dumps(dict(format='qjb',formatVersion=2,entry='main.mjs')).encode(),
                    json.dumps(dict(format='qjb',formatVersion=1,entry='main.mjs',type='script')).encode(),
                    json.dumps(dict(format='qjb\x00bad',formatVersion=1,entry='main.mjs')).encode(),
                    json.dumps(dict(format='qjb',formatVersion=1,entry='main.mjs',type='module\x00bad')).encode(),
                    json.dumps(dict(format='qjb',formatVersion=1,entry='../outside')).encode()]:
        cases.append(('manifest-'+str(len(cases)),archive([('bundle.json',content),files[1]]),None))
    cases.append(('missing-entry',archive([files[0]]),'ERR_QJB_MEMBER'))
    cases.append(('count-limit',archive(files+[(f'd/{i}',b'') for i in range(4096)]),'ERR_QJB_LIMIT'))
    cases.append(('total-limit',archive(files+[(f'd/{i}',b'0'*(8*1024*1024)) for i in range(9)],8),'ERR_QJB_LIMIT'))
    cases.append(('names-limit',archive(files+[(str(i)+'x'*1000,b'') for i in range(1100)]),'ERR_QJB_LIMIT'))
    for label,data,code in cases:
        filename=folder/(label+'.qjb');filename.write_bytes(data)
        run(qjs,['--bundle',filename],folder,success=False,contains=code)
    # Snapshot budget fails before allocating/reading a large archive.
    large=folder/'large.qjb'
    with large.open('wb') as f:f.truncate(64*1024*1024+1)
    run(qjs,['--bundle',large],folder,success=False,contains='ERR_QJB_LIMIT')
    for label,source,marker in [('rejected',"await Promise.reject(Error('bundle rejection'));",'bundle rejection'),
                                ('unsettled','await new Promise(()=>{});',None),
                                ('stack',"throw Error('bundle stack');",'qjb://')]:
        filename=folder/(label+'.qjb');filename.write_bytes(archive([files[0],('main.mjs',source)]))
        run(qjs,['--bundle',filename],folder,success=False,contains=marker)
    run(qjs,['--bundle'],folder,success=False,contains='requires a filename')
    run(qjs,['-e','1','--bundle',folder/'stack.qjb'],folder,success=False,contains='cannot be combined')
    return len(cases)+6


def verify(qjs,sdk=None,full=False):
    locked=json.loads((ROOT/'build/qjb/packages.json').read_text(encoding='utf-8'))
    for name,digest in locked.items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest
    with tempfile.TemporaryDirectory(prefix='qjb runtime 中文 ',dir=ROOT/'build') as temporary:
        folder=Path(temporary);(folder/'src').mkdir();(folder/'src/missing.mjs').write_text("throw Error('HOST FALLBACK');",encoding='utf-8')
        env=dict(os.environ,QJB_EXPECT_CWD=str(folder))
        for package in PACKAGES:
            for executable,prefix in [(qjs,['--bundle']),*([(sdk,[])] if sdk else [])]:
                marker='PASS qjb-script 42' if package.endswith('/script.qjb') else 'PASS qjb-application'
                run(executable,[*prefix,ROOT/package,'--','--fixture','中文 space'],folder,env=env,contains=marker)
        # Only scratch copies are replaced; transported packages remain byte-identical.
        for executable,prefix in [(qjs,['--bundle']),*([(sdk,[])] if sdk else [])]:
            filename=folder/'外部 replacement.qjb';shutil.copyfile(ROOT/PACKAGES[1],filename)
            run(executable,[*prefix,filename,'--','--fixture','中文 space'],folder,env=dict(env,QJB_MUTATE='1'),contains='PASS qjb-application')
            assert filename.read_bytes()==b'external replacement'
        if sdk:
            valid=folder/'ownership.qjb';invalid=folder/'ownership-invalid.qjb'
            valid.write_bytes(archive([('bundle.json',json.dumps(dict(format='qjb',formatVersion=1,entry='main.mjs'))),
                                       ('main.mjs','globalThis.bundleURL=import.meta.url;')]))
            invalid.write_bytes(archive([('bundle.json','{}')]))
            run(sdk,['--ownership',valid,invalid],folder,contains='PASS qjb-ownership')
        count=negative(qjs,folder) if full else 0
    for name,digest in locked.items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest
    print(f'PASS qjb: six shared packages, source removed, immutable Worker snapshot, SDK={bool(sdk)}, negative cases={count}')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qjs',type=Path,required=True);parser.add_argument('--sdk',type=Path)
    parser.add_argument('--prepare',action='store_true');parser.add_argument('--full',action='store_true')
    args=parser.parse_args();qjs=args.qjs.resolve()
    if args.prepare:prepare(qjs)
    verify(qjs,args.sdk.resolve() if args.sdk else None,args.full)


if __name__=='__main__':main()
