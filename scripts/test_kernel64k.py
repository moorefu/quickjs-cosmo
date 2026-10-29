#!/usr/bin/env python3
"""Boot the locked ARM64 kernel in full-system QEMU and require every entry."""
import argparse
import gzip
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess

from ape_layout import inspect
from build_config import load_config
from prepare_kernel64k import prepare
from prepare_native import sha256
from release_evidence import binding

CASES={'loader-fat','literal-argv0','bare-elf','compiled','sdk','qjsc','ca-resource','binfmt-fat','binfmt-nested'}


def newc(entries):
    result=io.BytesIO()
    for index,(name,data,mode,major,minor) in enumerate([*entries,('TRAILER!!!',b'',0,0,0)],1):
        name=name.encode()+b'\0'
        fields=[index,mode,0,0,1,0,len(data),0,0,major,minor,len(name),0]
        result.write(b'070701'+b''.join(f'{v:08x}'.encode() for v in fields));result.write(name)
        result.write(b'\0'*(-result.tell()%4));result.write(data);result.write(b'\0'*(-result.tell()%4))
    return result.getvalue()


def prepare_guest(settings,offline):
    root=settings.root;output=root/'build/kernel64k';output.mkdir(parents=True,exist_ok=True)
    inputs,provenance=prepare(offline);lock=provenance['lock'];tool=settings.toolchain/'bin'
    protected=[*settings.dist.glob('*'),settings.dist/'.aarch64/libquickjs.a',root/'versions.json',root/'native/versions.json',root/'compat/versions.json',*settings.releases.glob('*.zip')]
    before={str(p.relative_to(root)):sha256(p) for p in protected if p.is_file()}
    names={'qjs.exe':settings.dist/'qjs.exe','qjsc.exe':settings.dist/'qjsc.exe','deployment-standalone.exe':root/'build/test-linux/deployment-standalone.exe','deployment-sdk.exe':root/'build/test-linux/deployment-sdk.exe','ca-provider-sdk.exe':root/'build/test-linux/ca-provider-sdk.exe'}
    layouts={name:inspect(path) for name,path in names.items()};layouts['loader']=inspect(settings.dist/'ape-aarch64.elf')
    bare=output/'qjs.elf';shutil.copy2(names['qjs.exe'],bare)
    subprocess.run([str(tool/'assimilate'),'-e','-a','-c',str(bare)],check=True)
    layouts['bare']=inspect(bare)
    init=output/'init'
    subprocess.run([str(tool/'aarch64-linux-cosmo-gcc'),'-Os','-nostdlib','-static','-ffreestanding','-fno-builtin','-fno-stack-protector',
        '-Wl,-z,common-page-size=65536,-z,max-page-size=65536','-o',str(init),str(root/'tests/native/kernel64k_init.c')],check=True)
    layouts['init']=inspect(init)
    module=inputs/'binfmt_misc.ko';compressed=inputs/'binfmt_misc.ko.zst'
    if compressed.is_file():
        # Guest preparation is a host tool task. The pinned Node oracle supplies
        # its verified decoder even when the runtime under test is base.
        from prepare_native import prepare_node
        from test_node_compat import node_identity
        node = prepare_node(offline=offline)
        node_identity(node, root, json.loads((root/'compat/node-baseline.json').read_text()))
        code="import fs from 'node:fs';import {zstdDecompressSync} from 'node:zlib';fs.writeFileSync(process.argv[1],zstdDecompressSync(fs.readFileSync(process.argv[2])));"
        subprocess.run([str(node),'--input-type=module','-e',code,str(module),str(compressed)],check=True)
    entries=[(d,b'',stat.S_IFDIR|0o755,0,0) for d in ('bin','usr','usr/bin','app','app/fixtures','dev','proc','tmp','root')]
    entries += [('dev/console',b'',stat.S_IFCHR|0o600,5,1),('dev/null',b'',stat.S_IFCHR|0o666,1,3),('dev/zero',b'',stat.S_IFCHR|0o666,1,5)]
    files={'init':init,'bin/ape':settings.dist/'ape-aarch64.elf','usr/bin/ape':settings.dist/'ape-aarch64.elf','app/qjs.elf':bare,
           'app/kernel.mjs':root/'tests/runtime_deployment.mjs','app/fixtures/deployment-worker.mjs':root/'tests/fixtures/deployment-worker.mjs','app/ca-source.pem':root/'native/tls/ca-bundle.pem',
           **{'app/'+name:path for name,path in names.items()}}
    if module.is_file():files['bin/binfmt_misc.ko']=module
    for name,path in files.items():entries.append((name,path.read_bytes(),stat.S_IFREG|(0o644 if name.endswith(('.mjs','.pem')) else 0o755),0,0))
    entries.append(('app/immutable.json',json.dumps({'/'+name:sha256(path) for name,path in files.items()}).encode(),stat.S_IFREG|0o444,0,0))
    initrd=output/'initramfs.cpio.gz';initrd.write_bytes(gzip.compress(newc(entries),mtime=0))
    proof=dict(format=1,inputs=binding(settings),kernel=provenance,layouts=layouts,immutable=before,
        files={str(p.relative_to(output)):sha256(p) for p in (initrd,inputs/('vmlinuz-'+lock['release']))})
    (output/'preparation.json').write_text(json.dumps(proof,indent=2)+'\n')
    return proof


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline',action='store_true');parser.add_argument('--qemu',default='qemu-system-aarch64')
    parser.add_argument('--prepare-only',action='store_true');parser.add_argument('--prepared',action='store_true');args=parser.parse_args()
    settings=load_config();root=settings.root;output=root/'build/kernel64k'
    proof=json.loads((output/'preparation.json').read_text()) if args.prepared else prepare_guest(settings,args.offline)
    if args.prepare_only:print('PASS prepared 64K kernel guest');return
    if proof['inputs']!=binding(settings):raise ValueError('64K guest belongs to different runtime inputs')
    provenance=proof['kernel'];lock=provenance['lock'];layouts=proof['layouts'];before=proof['immutable']
    if lock!=json.loads((root/'compat/kernel64k.json').read_text()):raise ValueError('64K kernel lock changed')
    for name,digest in proof['files'].items():
        target=(output/name).resolve()
        if not target.is_relative_to(output.resolve()) or sha256(target)!=digest:raise ValueError('64K guest input changed: '+name)
    inputs=output/'inputs';initrd=output/'initramfs.cpio.gz'
    version=subprocess.run([args.qemu,'--version'],capture_output=True,text=True,check=True).stdout.splitlines()[0]
    command=[args.qemu,'-machine','virt','-cpu','max','-m','512','-smp','2','-nographic','-no-reboot','-nic','none',
             '-kernel',str(inputs/('vmlinuz-'+lock['release'])),'-initrd',str(initrd),'-append','console=ttyAMA0 rdinit=/init panic=-1']
    log=output/'console.log'
    with log.open('wb') as stream:
        try:run=subprocess.run(command,stdout=stream,stderr=subprocess.STDOUT,timeout=600)
        except subprocess.TimeoutExpired as error:raise ValueError('64K VM timed out; see '+str(log)) from error
    text=log.read_text(errors='replace')
    if run.returncode or 'KERNEL64K_PASS' not in text or 'KERNEL64K_FAIL' in text:raise ValueError('64K VM failed; see '+str(log))
    cases=[v.split(' ',1)[1] for v in text.splitlines() if v.startswith('KERNEL64K_CASE ')]
    aux=[json.loads(v.partition(' ')[2]) for v in text.splitlines() if v.startswith('KERNEL64K_AUXV ')]
    if len(cases)!=len(CASES) or set(cases)!=CASES or len(aux)!=1 or aux[0]!=dict(pageSize=65536,release=lock['release'],machine='aarch64'):
        raise ValueError('Incomplete actual-kernel entry or auxv evidence')
    results=[json.loads(v[18:]) for v in text.splitlines() if v.startswith('DEPLOYMENT_RESULT ')]
    if len(results)!=7 or any(not v.get('kernel') or v['main']['protocol'] for v in results):raise ValueError('Missing guest runtime/Worker/nested evidence')
    after={name:sha256(root/name) for name in before}
    if after!=before:raise ValueError('Kernel test modified protected build inputs or release payloads')
    value=dict(format=1,inputs=binding(settings),kernel=provenance,auxv=aux[0],cases=cases,results=results,layouts=layouts,
        immutable=before,qemu=dict(version=version,sha256=sha256(Path(shutil.which(args.qemu) or args.qemu)),command=command),consoleSha256=sha256(log))
    (output/'results.json').write_text(json.dumps(value,indent=2)+'\n');print('PASS kernel64k: real AT_PAGESZ=65536; nine entry cases including shared CA and concurrent SDK loading')


if __name__=='__main__':main()
