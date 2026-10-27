import buffer, { Buffer } from 'node:buffer';
import * as alias from 'buffer';
import { check, result } from './fixtures/result.mjs';

const rows = [];
function record(label, call) {
    try { rows.push([label, call()]); }
    catch (error) { rows.push([label, { error: error.name, code: error.code ?? null }]); }
}
check(alias.Buffer === Buffer && buffer.Buffer === Buffer && globalThis.Buffer === Buffer, 'Canonical Buffer identity');
record('prototype-descriptors', () => ['toString', 'slice', 'fill', 'readUInt32LE'].map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(Buffer.prototype, key);
    return [key, descriptor.enumerable, descriptor.writable, descriptor.configurable];
}));
const originalGlobal = globalThis.Buffer;
globalThis.Buffer = null;
check((await import('node:buffer')).Buffer === Buffer, 'Module exports survive global rebinding');
globalThis.Buffer = originalGlobal;
const encodings = ['utf8', 'UTF-8', 'utf16le', 'ucs2', 'ascii', 'latin1', 'binary', 'hex', 'base64', 'base64url', '', 'bad'];
const strings = ['', 'abc', '中文😀', '\ud800x\udc00', '\ufffd\ufeff', '\0\xff\u0100',
                 '1234abcdEF', '1g', 'a===', 'aa=aa', '!a@b#c', 'AA-_+/ \n', '\u0141A'];
for (const encoding of encodings) for (const text of strings) {
    record(['encode', text, encoding], () => Buffer.from(text, encoding).toString('hex'));
    record(['byteLength', text, encoding], () => Buffer.byteLength(text, encoding));
    record(['decode', text, encoding], () => Buffer.from(text).toString(encoding));
}
for (const value of [undefined, null, true, 1, NaN, Infinity, -1, 1.5, '2', {}, [], new Uint16Array([257, 65535]),
                     new DataView(new ArrayBuffer(4)), { length: '2', 0: 3 }, { length: -2 },
                     { type: 'Buffer', data: [1, -2, 258] }, { valueOf: () => 'abc' }, { [Symbol.toPrimitive]: () => 'xy' }]) {
    record(['from', rows.length], () => Buffer.from(value));
    record(['alloc', rows.length], () => Buffer.alloc(value));
    record(['length', rows.length], () => Buffer.byteLength(value));
    record(['encoding', rows.length], () => Buffer.isEncoding(value));
}
for (const offset of [undefined, null, 0, -1, 1.5, NaN, Infinity, '2', 8, 9])
    for (const length of [undefined, -1, 0, 2, 1.5, Infinity, '2'])
        record(['view', String(offset), String(length)], () => Buffer.from(new ArrayBuffer(8), offset, length));
const shared = new SharedArrayBuffer(8);
Buffer.from(shared, 2, 3).fill(19);
record('sharedArrayBuffer', () => [...new Uint8Array(shared)]);
const backing = Buffer.from([0, 1, 2, 3, 4, 5]);
const view = backing.subarray(1, 4), copied = Buffer.from(view);
view[0] = 99;
record('slice-copy', () => [backing, copied, backing.slice(1, 3), Buffer.isBuffer(backing.map(x => x + 1)), Buffer.isBuffer(backing.filter(x => x))]);
for (const list of [[], [Buffer.from('a'), new Uint8Array([98, 99])], [new Uint16Array([1])], [null], null])
    for (const size of [undefined, 0, 1, 5, -1, 1.5, '3'])
        record(['concat', rows.length, size], () => Buffer.concat(list, size));
for (const value of [1, 257, true, null, undefined, {}, '', 'ab', '😀', Buffer.alloc(0), Buffer.from([1, 2])])
    for (const args of [[], [1], [-1], [1, 4], [2, 1], [1.5], ['utf8'], [0, 6, 'hex']])
        record(['fill', rows.length], () => Buffer.alloc(6).fill(value, ...args));
for (const args of [[], [0, 0, 3], [1, 0, 5], [0, 3, 1], [-1], [0, 9], [0, 6], ['1', 1.5, 5.8], [Infinity], [0, 0, Infinity]])
    record(['copy', args], () => { const b = Buffer.from('abcdef'); return [b.copy(b, ...args), b]; });
for (const target of [undefined, null, 1, Buffer.alloc(0), new Uint8Array([1, 2]), Buffer.from('ab')]) {
    record(['compare', rows.length], () => Buffer.compare(Buffer.from('ab'), target));
    for (const args of [[], [0, 0], [1, 2, 0, 1], [99], [-1], [0, 99], [0, 1, 99], [1.5]])
        record(['instance-compare', rows.length], () => Buffer.from('abc').compare(target, ...args));
}
for (const encoding of [null, false, 1, '', {}, undefined])
    record(['fill-encoding', rows.length], () => Buffer.alloc(3).fill('a', 0, 3, encoding));
for (const encoding of ['utf8', 'utf16le', 'latin1', 'hex', 'base64', 'bad'])
    for (const count of [0, 1, 2, 3, 4, 6])
        record(['write', encoding, count], () => { const b = Buffer.alloc(8, 46); return [b.write('😀abcd', 1, count, encoding), b]; });
for (const start of [undefined, -9, -1, 0, 1.5, NaN, Infinity, '2'])
    for (const end of [undefined, -1, 0, 2, 9, NaN, Infinity, '3']) {
        record(['toString', String(start), String(end)], () => backing.toString('hex', start, end));
        record(['slice', String(start), String(end)], () => backing.slice(start, end));
    }
for (const method of ['readUInt8', 'readInt16BE', 'readUInt32LE', 'readDoubleBE', 'readBigUInt64LE'])
    for (const offset of [undefined, -1, 0, 1.5, NaN, 1, 2, '0', Infinity])
        record([method, String(offset)], () => String(Buffer.from('0123456789').subarray(2)[method](offset)));
for (const method of ['writeUInt8', 'writeInt16BE', 'writeUInt32LE', 'writeFloatBE', 'writeDoubleLE'])
    for (const value of [-Infinity, -65537, -1, 0, 1.5, 255, 65535, 4294967296, NaN, '2'])
        record([method, String(value)], () => { const b = Buffer.alloc(8); return [b[method](value, 0), b]; });
for (const signed of ['Int', 'UInt']) for (const endian of ['LE', 'BE'])
    for (const size of [0, 1, 2, 3, 5, 6, 7]) for (const value of [-129, -1, 0, 127, 256, 65536, 2 ** 40 + 123])
        record([signed, endian, size, value], () => {
            const b = Buffer.alloc(10), suffix = signed + endian;
            const next = b['write' + suffix](value, 2, size);
            return [next, b, b['read' + suffix](2, size)];
        });
for (const value of [0n, 1n, -1n, (1n << 64n) - 1n, 1n << 64n])
    for (const suffix of ['BigInt64LE', 'BigUInt64BE'])
        record([suffix, String(value)], () => {
            const b = Buffer.alloc(8); return [b['write' + suffix](value), b.toString('hex'), String(b['read' + suffix]())];
        });
for (const needle of ['', 'a', 'ab', 'ba', '😀', 97, -1, Buffer.from('ab'), null])
    for (const offset of [undefined, -99, -2, 0, 1.5, 5, 99, NaN, Infinity, -Infinity, 'utf8'])
        for (const method of ['indexOf', 'lastIndexOf', 'includes'])
            record([method, rows.length], () => Buffer.from('ababa😀')[method](needle, offset));
for (const offset of [-1, 0, 1, 2, 3, 9])
    for (const method of ['indexOf', 'lastIndexOf'])
        record([method, 'utf16', offset], () => Buffer.from('ababa', 'utf16le')[method]('ba', offset, 'utf16le'));
for (const bits of [16, 32, 64]) for (const length of [0, 2, 4, 8, 9])
    record(['swap', bits, length], () => Buffer.from(Array.from({ length }, (_, i) => i))['swap' + bits]());
for (const method of ['from', 'copyBytesFrom']) {
    const typed = new Uint16Array([0x1234, 0xabcd, 0x5678]);
    record([method, 'Uint16Array'], () => Buffer[method](typed, 1, 1));
}
for (const size of [0, 1, 16]) {
    record(['unsafe-type', size], () => [Buffer.isBuffer(Buffer.allocUnsafe(size)), Buffer.allocUnsafe(size).length,
        Buffer.isBuffer(Buffer.allocUnsafeSlow(size)), Buffer.allocUnsafeSlow(size).length]);
    record(['slow', size], () => buffer.SlowBuffer(size));
}
for (const suffix of ['8', '16LE', '16BE', '32LE', '32BE', 'LE', 'BE'])
    record(['numeric-alias', suffix], () => [Buffer.prototype['readUInt' + suffix] === Buffer.prototype['readUint' + suffix],
        Buffer.prototype['writeUInt' + suffix] === Buffer.prototype['writeUint' + suffix]]);
const detached = new ArrayBuffer(8);
detached.transfer();
record('detached', () => Buffer.from(detached));
result(rows);
