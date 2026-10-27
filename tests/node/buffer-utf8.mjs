import { Buffer } from 'node:buffer';
import { result } from './fixtures/result.mjs';

let hash = 2166136261, hash2 = 5381, count = 0;
function observe(text) {
    for (let i = 0; i < text.length; i++) {
        hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        hash2 = (Math.imul(hash2, 33) ^ text.charCodeAt(i)) | 0;
    }
    hash = Math.imul(hash ^ 0xffff, 16777619); count++;
}
// Exhaust every two-byte UTF-8 sequence, not only valid text.
for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++)
    observe(Buffer.from([a, b]).toString());
// Every UTF-16 code unit, including both surrogate ranges.
for (let unit = 0; unit < 65536; unit++) observe(Buffer.from(String.fromCharCode(unit)).toString('hex'));
for (const bytes of [[0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xef, 0xbb, 0xbf],
    [0xf0, 0x80, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf4, 0x8f, 0xbf, 0xbf],
    [0xf0, 0x9f, 0x98], [0xe1, 0x80, 0x41], [0xe1, 0x41, 0x80], [0xf1, 0x80, 0x41, 0x80]])
    observe(Buffer.from(bytes).toString());
result({ count, hash: hash >>> 0, hash2: hash2 >>> 0 });
