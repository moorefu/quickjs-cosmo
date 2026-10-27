import zlib from 'node:zlib';
import {gzipSync} from 'zlib';
import compression from 'cosmo:compression';
const zipped:Buffer=gzipSync('abc',{level:9,windowBits:15,maxOutputLength:1000});
const restored:Buffer=zlib.unzipSync(zipped);
const zstd:Buffer=zlib.zstdCompressSync(new DataView(new ArrayBuffer(4)),{params:{[zlib.constants.ZSTD_c_checksumFlag]:true}});
const lz4:Buffer=compression.lz4CompressSync('abc',{blockSize:4,checksum:true});
const bz:Buffer=compression.bzip2DecompressSync(compression.bzip2CompressSync('abc'),{small:true});
const version:string=compression.codecInfo('lz4').version;
const check:number=zlib.crc32(new Uint8Array(4));
void [zipped,restored,zstd,lz4,bz,version,check];
zlib.gzip('abc',()=>{});
// @ts-expect-error Engine stream objects belong to M3-05.
gzipSync('abc',{info:true});
// @ts-expect-error CRC32 accepts views but no plain ArrayBuffer.
zlib.crc32(new ArrayBuffer(1));
// @ts-expect-error Brotli is outside this plan.
zlib.constants.BROTLI_PARAM_QUALITY;
// @ts-expect-error LZ4 raw blocks are not the Frame API.
compression.lz4CompressSync('abc',{blockSize:3});
