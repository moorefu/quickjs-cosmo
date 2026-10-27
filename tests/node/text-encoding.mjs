import { check, result } from './fixtures/result.mjs';

const rows = [];
function record(label, call) {
    try { rows.push([label, call()]); }
    catch (error) { rows.push([label, { error: error.name, code: error.code ?? null }]); }
}
const encoder = new TextEncoder();
check(encoder.encoding === 'utf-8', 'Encoder identity');
for (const text of ['', 'abc', '中文😀', '\ud800x\udc00', '\ufeffA', '\0a'])
    for (const size of [0, 1, 2, 3, 4, 5, 7, 12, 20])
        record(['into', text, size], () => { const bytes = new Uint8Array(size).fill(0xaa); return [encoder.encodeInto(text, bytes), [...bytes]]; });
for (const value of [undefined, null, false, 123, Symbol('x')]) {
    record(['encode', String(value)], () => [...encoder.encode(value)]);
    record(['into-type', String(value)], () => encoder.encodeInto(value, new Uint8Array(10)));
}
const inputs = [[0xef, 0xbb, 0xbf, 65], [0xf0, 0x9f, 0x98, 0x80], [0xe1, 0x80, 65],
    [0xf4, 0x90, 0x80, 0x80], [0x80, 0x81, 0x91, 0xff], [0xff, 0xfe, 0x3d, 0xd8, 0x00, 0xde],
    [0xfe, 0xff, 0xd8, 0x3d, 0xde, 0x00], [0x00, 0xd8, 0x41, 0x00], [0x00]];
for (const encoding of ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252', 'latin1', 'ascii'])
    for (const bytes of inputs) for (const fatal of [false, true]) for (const ignoreBOM of [false, true]) {
        record(['decode', encoding, bytes, fatal, ignoreBOM], () => new TextDecoder(encoding, { fatal, ignoreBOM }).decode(new Uint8Array(bytes)));
        for (let split = 0; split <= bytes.length; split++)
            record(['stream', encoding, bytes, fatal, ignoreBOM, split], () => {
                const decoder = new TextDecoder(encoding, { fatal, ignoreBOM });
                return decoder.decode(new Uint8Array(bytes.slice(0, split)), { stream: true }) +
                    decoder.decode(new Uint8Array(bytes.slice(split)), { stream: true }) + decoder.decode();
            });
    }
for (const input of [null, [], 'abc', new DataView(new Uint8Array([1, 65, 2]).buffer, 1, 1)])
    record(['decode-type', rows.length], () => new TextDecoder().decode(input));
const fatal = new TextDecoder('utf8', { fatal: true });
try { fatal.decode(new Uint8Array([255])); } catch {}
record('fatal-recovery', () => fatal.decode(new Uint8Array([65])));
const decoder = new TextDecoder();
record('bom-reset', () => [decoder.decode(new Uint8Array([239, 187, 191, 65])), decoder.decode(new Uint8Array([239, 187, 191, 66]))]);
for (const options of [null, false, 1, 'x', {}, undefined]) {
    record(['constructor-options', String(options)], () => new TextDecoder('utf8', options).fatal);
    record(['decode-options', String(options)], () => new TextDecoder().decode(new Uint8Array([65]), options));
}
result(rows);
