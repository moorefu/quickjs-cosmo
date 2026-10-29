import zlib from 'node:zlib';
import compression from 'cosmo:compression';
const zstd:Buffer=zlib.zstdCompressSync(new DataView(new ArrayBuffer(4)),{params:{[zlib.constants.ZSTD_c_checksumFlag]:true}});
const lz4:Buffer=compression.lz4CompressSync('abc',{blockSize:4,checksum:true});
const bz:Buffer=compression.bzip2DecompressSync(compression.bzip2CompressSync('abc'),{small:true});
const version:string=compression.codecInfo('lz4').version;
void [zstd,lz4,bz,version];
// @ts-expect-error LZ4 raw blocks are not the Frame API.
compression.lz4CompressSync('abc',{blockSize:3});

zlib.zstdCompress('x',{params:{100:3}},()=>{});compression.lz4Compress('x',()=>{});compression.bzip2Decompress('x',{small:true},()=>{});
