import zlib from 'node:zlib';
import {gzipSync} from 'zlib';
import compression from 'cosmo:compression';
const zipped:Buffer=gzipSync('abc',{level:9,windowBits:15,maxOutputLength:1000});
const restored:Buffer=zlib.unzipSync(zipped);
const check:number=zlib.crc32(new Uint8Array(4));
zlib.gzip('abc',()=>{});
const info:Buffer=gzipSync('abc',{info:true}).buffer;
const engine:import('node:zlib').Gzip=gzipSync('abc',{info:true}).engine;
// @ts-expect-error CRC32 accepts views but no plain ArrayBuffer.
zlib.crc32(new ArrayBuffer(1));
// @ts-expect-error Brotli is outside this plan.
zlib.constants.BROTLI_PARAM_QUALITY;
