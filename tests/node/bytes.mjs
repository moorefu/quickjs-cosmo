import { check, result } from './fixtures/result.mjs';

const storage = new ArrayBuffer(16);
const words = new DataView(storage);
words.setUint32(3, 0x12345678, false);
const view = new Uint8Array(storage, 3, 4);
check(view.join(',') === '18,52,86,120', 'Byte offset and endian contract');
const text = '中文😀a\0b';
result({ bytes: [...view], offset: view.byteOffset, bytesLength: view.byteLength,
         codePoints: [...text].map(c => c.codePointAt(0)),
         normalized: 'e\u0301'.normalize('NFC'),
         error: (() => { try { new Uint8Array(storage, 17); } catch (e) { return e.name; } })() });
