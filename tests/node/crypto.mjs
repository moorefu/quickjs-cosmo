import { createHash, createHmac, hkdfSync, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { check, result, errorOf } from './fixtures/result.mjs';

const hash = createHash('sha256').update('a');
const copy = hash.copy();
const digest = hash.update('bc').digest('hex');
check(digest === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA256 vector');
const hkdf = hkdfSync('sha256', 'key', 'salt', 'info', 32);
result({ digest, copied: copy.update('bc').digest('hex'),
         hmac: createHmac('sha256', 'key').update('data').digest('hex'),
         hkdfType: hkdf.constructor.name, hkdf: Buffer.from(hkdf).toString('hex'),
         pbkdf2: pbkdf2Sync('password', 'salt', 2, 32, 'sha256').toString('hex'),
         same: timingSafeEqual(Buffer.from([1, 2]), Buffer.from([1, 2])),
         lengthMismatch: errorOf(() => timingSafeEqual(Buffer.alloc(1), Buffer.alloc(0))),
         doubleDigest: errorOf(() => hash.digest()) });
