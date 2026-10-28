import crypto from 'node:crypto';
import {Buffer} from 'node:buffer';
const hash=crypto.createHash('shake256',{outputLength:200});
const copy=hash.copy({outputLength:0});
const bytes:Buffer=hash.update('abc').digest();
const empty:Buffer=copy.digest();
const encoded:string=crypto.hash('shake128','abc',{outputLength:17});
const buffer:Buffer=crypto.hash('shake128','abc',{outputEncoding:'buffer',outputLength:17});
// @ts-expect-error SHAKE length is a number.
crypto.createHash('shake128',{outputLength:'17'});
// @ts-expect-error Length is supplied through HashOptions, not digest(length).
hash.digest(17);
