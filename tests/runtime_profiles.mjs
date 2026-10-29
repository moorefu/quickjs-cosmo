import assert from 'node:assert/strict';
import {runtimeInfo} from 'cosmo:runtime';
import * as z from 'node:zlib';
import * as c from 'cosmo:compression';
const info=runtimeInfo(),caps=info.capabilities;
assert(['base','full'].includes(caps.profile));
assert(['fat','x64','arm64'].includes(caps.architecture));
const full=caps.profile==='full';
for(const name of ['zstdCompressSync','zstdDecompressSync','zstdCompress','zstdDecompress','ZstdCompress','ZstdDecompress','createZstdCompress','createZstdDecompress']){
    assert.equal(Object.hasOwn(z,name),full,name+' named export');
    assert.equal(Object.hasOwn(z.default,name),full,name+' default export');
}
for(const name of ['lz4CompressSync','lz4DecompressSync','bzip2CompressSync','bzip2DecompressSync','lz4Compress','lz4Decompress','bzip2Compress','bzip2Decompress']){
    assert.equal(Object.hasOwn(c,name),full,name+' named export');
    assert.equal(Object.hasOwn(c.default,name),full,name+' default export');
}
assert.equal(Object.keys(z.constants).some(name=>name.startsWith('ZSTD_')),full);
assert.equal(c.codecInfo().map(value=>value.name).join(','),full?'zlib,zstd,lz4,bzip2':'zlib');
for(const id of ['zstd','lz4','bzip2'])assert.equal(caps.backends.some(value=>value.id===id),full);
for(const module of caps.modules.filter(value=>['node:zlib','cosmo:compression'].includes(value.specifier))){
    const actual=module.specifier==='node:zlib'?z:c;
    for(const [name,status] of Object.entries(module.apis)){
        if(['partial','supported'].includes(status) && !name.includes('.'))assert.equal(Object.hasOwn(actual,name),true,name+' advertised export');
        if(!full)assert(!/zstd|lz4|bzip2/i.test(name),name+' absent base capability');
    }
}
assert.equal(z.gunzipSync(z.gzipSync('profile TLS/Fetch/zlib contract')).toString(),'profile TLS/Fetch/zlib contract');
assert.equal(z.crc32('123456789'),0xcbf43926);
console.log('PASS runtime-profiles '+JSON.stringify({profile:caps.profile,architecture:caps.architecture,entry:info.entry}));
