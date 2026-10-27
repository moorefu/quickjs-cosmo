import { Buffer } from 'node:buffer';
import { check, result, errorOf } from './fixtures/result.mjs';

const bytes = Buffer.from('中文😀a\0b');
const backing = new ArrayBuffer(8);
const shared = Buffer.from(backing, 2, 3);
const copied = Buffer.from(shared);
shared[0] = 123;
check(Buffer.isBuffer(bytes), 'Encoded input must be Buffer');
check(copied[0] === 0 && new Uint8Array(backing)[2] === 123, 'Copy and view semantics');
const slice = shared.slice(0, 1);
slice[0] = 42;
result({ hex: bytes.toString('hex'), base64url: bytes.toString('base64url'),
         roundTrip: bytes.toString('utf8'), globalIdentity: globalThis.Buffer === Buffer,
         sliceShares: shared[0] === 42, byteLength: Buffer.byteLength('😀'),
         loneSurrogate: Buffer.from('\ud800').toString('hex'),
         oddHex: Buffer.from('abc', 'hex').toString('hex'),
         negativeAlloc: errorOf(() => Buffer.alloc(-1)) });
