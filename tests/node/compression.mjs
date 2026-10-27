import { gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync,
         inflateRawSync, crc32 } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { check, result, errorOf } from './fixtures/result.mjs';

const input = Buffer.from('中文😀a\0b');
const first = gzipSync(input);
const concatenated = gunzipSync(Buffer.concat([first, gzipSync('tail')]));
check(concatenated.equals(Buffer.concat([input, Buffer.from('tail')])), 'Concatenated gzip members');
result({ gzip: gunzipSync(first).toString('hex'),
         zlib: inflateSync(deflateSync(input)).toString('hex'),
         raw: inflateRawSync(deflateRawSync(input)).toString('hex'),
         concatenated: concatenated.toString('hex'), crc32: crc32('123456789'),
         incrementalCrc32: crc32('56789', crc32('1234')),
         truncated: errorOf(() => gunzipSync(first.subarray(0, first.length - 1))) });
