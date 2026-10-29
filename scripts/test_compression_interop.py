#!/usr/bin/env python3
"""Independent two-way compression checks; test tools never enter the SDK."""
import argparse
import bz2
import ctypes
import gzip
import json
import platform
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import zlib

from build_config import load_config
from host_runtime import ape_command
from node_contract import ROOT, read_json
from prepare_native import fetch, prepare_node, sha256, source_name, write_member
from test_node_compat import node_identity, run_command, write_report


def lz4_oracle(offline):
    lock = read_json(ROOT / 'compat/dev-tools.json')['lz4_interop']
    archive = ROOT / '.cache/dev-tools' / lock['archive']
    fetch(lock['url'], archive, lock['sha256'], offline)
    destination = ROOT / 'toolchains' / ('lz4-interop-' + lock['version'])
    names = {}
    with tarfile.open(archive, 'r:gz') as bundle:
        for member in bundle:
            name = source_name(member.name, lock['root'])
            if name == 'LICENSE' or name.startswith('lib/') and name.endswith(('.c', '.h')):
                if name in names: raise ValueError('Duplicate LZ4 oracle source')
                target = destination / name
                if not target.resolve().is_relative_to(destination.resolve()): raise ValueError('LZ4 oracle path escapes tool directory')
                write_member(bundle, member, target)
                names[name] = sha256(target)
    library = ROOT / 'build/interop/liblz4-oracle.so'
    library.parent.mkdir(parents=True, exist_ok=True)
    compiler = shutil.which('cc')
    if not compiler: raise ValueError('Host C compiler required for the locked LZ4 test oracle')
    command = [compiler, '-O2', '-fPIC', '-shared', '-I' + str(destination / 'lib'),
               *[str(destination / 'lib' / name) for name in ('lz4.c', 'lz4hc.c', 'lz4frame.c', 'xxhash.c')], '-o', str(library)]
    subprocess.run(command, check=True, capture_output=True, timeout=120)
    api = ctypes.CDLL(str(library))
    size = ctypes.c_size_t
    pointer = ctypes.c_void_p
    api.LZ4_versionNumber.restype = ctypes.c_int
    if api.LZ4_versionNumber() != 11000: raise ValueError('LZ4 oracle version mismatch')
    api.LZ4F_compressFrameBound.argtypes = [size, pointer]; api.LZ4F_compressFrameBound.restype = size
    api.LZ4F_compressFrame.argtypes = [pointer,size,pointer,size,pointer]; api.LZ4F_compressFrame.restype = size
    api.LZ4F_createDecompressionContext.argtypes = [ctypes.POINTER(pointer),ctypes.c_uint]; api.LZ4F_createDecompressionContext.restype = size
    api.LZ4F_decompress.argtypes = [pointer,pointer,ctypes.POINTER(size),pointer,ctypes.POINTER(size),pointer]; api.LZ4F_decompress.restype = size
    api.LZ4F_freeDecompressionContext.argtypes = [pointer]; api.LZ4F_freeDecompressionContext.restype = size
    api.LZ4F_isError.argtypes = [size]; api.LZ4F_isError.restype = ctypes.c_uint
    def checked(code):
        if api.LZ4F_isError(code): raise ValueError('Independent LZ4 oracle rejected the frame')
        return code
    def compress(data):
        source = ctypes.create_string_buffer(data)
        output = ctypes.create_string_buffer(api.LZ4F_compressFrameBound(len(data),None))
        count = checked(api.LZ4F_compressFrame(output,len(output),source,len(data),None))
        return output.raw[:count]
    def decompress(data):
        source = ctypes.create_string_buffer(data); context = pointer()
        checked(api.LZ4F_createDecompressionContext(ctypes.byref(context),100))
        chunks = []; offset = 0
        try:
            while True:
                output = ctypes.create_string_buffer(65536)
                produced, consumed = size(len(output)), size(len(data)-offset)
                remaining = checked(api.LZ4F_decompress(context,output,ctypes.byref(produced),
                    ctypes.cast(ctypes.byref(source,offset),pointer),ctypes.byref(consumed),None))
                chunks.append(output.raw[:produced.value]); offset += consumed.value
                if not remaining: break
                if not consumed.value and not produced.value: raise ValueError('Truncated oracle frame')
            if offset != len(data): raise ValueError('Unexpected trailing oracle input')
            return b''.join(chunks)
        finally: api.LZ4F_freeDecompressionContext(context)
    identity = dict(input=lock, source_sha256=names, command=command, binary_sha256=sha256(library),
        compiler=subprocess.run([compiler,'--version'],check=True,capture_output=True,text=True).stdout.splitlines()[0])
    return compress,decompress,identity


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    if platform.system() != 'Linux': parser.error('Run independent oracle compilation on the Linux build host')
    settings = load_config(); node = prepare_node(offline=args.offline)
    identity = node_identity(node, ROOT, read_json(ROOT / 'compat/node-baseline.json'))
    full = settings.runtime_profile == 'full'
    lz4_identity = None
    if full:
        lz4_compress,lz4_decompress,lz4_identity = lz4_oracle(args.offline)
    codecs = {'gzip':(gzip.compress,gzip.decompress), 'zlib':(zlib.compress,zlib.decompress),
              'raw':(lambda data:(lambda encoder:encoder.compress(data)+encoder.flush())(zlib.compressobj(wbits=-15)),
                     lambda data:zlib.decompress(data,wbits=-15))}
    if full:
        codecs.update(bzip2=(bz2.compress,bz2.decompress),lz4=(lz4_compress,lz4_decompress))
    cases = []
    with tempfile.TemporaryDirectory(prefix='compression-interop-',dir=ROOT / 'build') as directory:
        scratch = Path(directory); source=scratch/'source.bin'; encoded=scratch/'encoded.bin'; decoded=scratch/'decoded.bin'
        fixture = ROOT / 'tests/fixtures/compression-interop.mjs'
        def execute(runtime, operation, codec, input_path, output_path, options=None):
            arguments = [fixture,operation,codec,input_path,output_path,json.dumps(options or {})]
            command = [node,*arguments] if runtime=='node' else ape_command(settings.dist/'qjs.exe',['-m',*arguments],settings.dist)
            process = run_command(command,ROOT,60)
            if process['failure'] or process['exit_code']:
                raise ValueError(f'{runtime}/{codec}/{operation}: '+process['stderr'][-2000:])
        payloads = [b'',b'a',bytes(range(256)),b'abc\0def'*19000,bytes((i*131+i//257)%256 for i in range(131073))]
        for codec,(compress,decompress) in codecs.items():
            for data in payloads:
                source.write_bytes(data); encoded.write_bytes(compress(data))
                execute('qjs','decompress',codec,encoded,decoded)
                if decoded.read_bytes()!=data: raise ValueError(codec+' failed independent decode')
                for options in ({},{'maxOutputLength':max(1024,len(data)*2+1024)}):
                    execute('qjs','compress',codec,source,encoded,options)
                    if decompress(encoded.read_bytes())!=data: raise ValueError(codec+' failed independent encode')
                cases.append(dict(codec=codec,length=len(data),directions=['external-to-qjs','qjs-to-external'],passed=True))
                if codec in ('gzip','zlib','raw'):
                    encoded.write_bytes(compress(data))
                    execute('qjs','decompress',codec,encoded,decoded,{'stream':True})
                    if decoded.read_bytes()!=data: raise ValueError(codec+' stream failed independent decode')
                    execute('qjs','compress',codec,source,encoded,{'stream':True})
                    if decompress(encoded.read_bytes())!=data: raise ValueError(codec+' stream failed independent encode')
                    cases.append(dict(codec=codec,stream=True,length=len(data),directions=['external-to-qjs','qjs-to-external'],passed=True))
        for data in payloads if full else ():
            source.write_bytes(data)
            for encoder,decoder in (('node','qjs'),('qjs','node')):
                execute(encoder,'compress','zstd',source,encoded,{'params':{'201':1}})
                execute(decoder,'decompress','zstd',encoded,decoded)
                if decoded.read_bytes()!=data: raise ValueError('Zstd cross-runtime mismatch')
            cases.append(dict(codec='zstd',length=len(data),directions=['node-to-qjs','qjs-to-node'],passed=True))
            for encoder,decoder in (('node','qjs'),('qjs','node')):
                execute(encoder,'compress','zstd',source,encoded,{'stream':True,'params':{'201':1}})
                execute(decoder,'decompress','zstd',encoded,decoded,{'stream':True})
                if decoded.read_bytes()!=data: raise ValueError('Zstd stream cross-runtime mismatch')
            cases.append(dict(codec='zstd',stream=True,length=len(data),directions=['node-to-qjs','qjs-to-node'],passed=True))
    path=ROOT/'build/interop/compression.json'
    write_report(path,dict(format=1,passed=True,node=identity,lz4=lz4_identity,
        python=dict(version=platform.python_version(),zlib=zlib.ZLIB_RUNTIME_VERSION),cases=cases))
    print(f'PASS compression interoperability: {len(cases)} payload/codec pairs, both directions; report: {path}')


if __name__ == '__main__':
    main()
