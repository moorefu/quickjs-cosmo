declare module 'node:crypto' {
    import { Buffer, BufferEncoding } from 'node:buffer';
    import {Transform, TransformOptions} from 'node:stream';
    export type BinaryLike = string | ArrayBuffer | SharedArrayBuffer | ArrayBufferView;
    /** SHAKE output bytes; fixed digests only accept their normal length. Copy without options resets SHAKE to its default. */
    export interface HashOptions extends TransformOptions { outputLength?: number; }
    export interface HmacOptions extends TransformOptions {encoding?: BufferEncoding;}
    export class Hash extends Transform {
        constructor(algorithm: string, options?: HashOptions);
        update(data: string | ArrayBufferView, inputEncoding?: BufferEncoding): this;
        digest(): Buffer;
        digest(encoding: 'buffer'): Buffer;
        digest(encoding: BufferEncoding): string;
        copy(options?: HashOptions): Hash;
    }
    export class Hmac extends Transform {
        constructor(algorithm: string, key: BinaryLike|KeyObject, options?: HmacOptions);
        update(data: string | ArrayBufferView, inputEncoding?: BufferEncoding): this;
        digest(): Buffer;
        digest(encoding: 'buffer'): Buffer;
        digest(encoding: BufferEncoding): string;
    }
    export function createHash(algorithm: string, options?: HashOptions): Hash;
    export function createHmac(algorithm: string, key: BinaryLike|KeyObject, options?: HmacOptions): Hmac;
    export function getHashes(): string[];
    export function hkdfSync(digest: string, ikm: BinaryLike|KeyObject, salt: BinaryLike, info: BinaryLike, keylen: number): ArrayBuffer;
    export function pbkdf2Sync(password: BinaryLike, salt: BinaryLike, iterations: number, keylen: number, digest: string): Buffer;
    export function timingSafeEqual(a: Exclude<BinaryLike, string>, b: Exclude<BinaryLike, string>): boolean;
    export function randomBytes(size: number): Buffer;
    export function randomFillSync<T extends ArrayBuffer | SharedArrayBuffer | ArrayBufferView>(buffer: T, offset?: number, size?: number): T;
    export function randomUUID(options?: {disableEntropyCache?: boolean}): `${string}-${string}-${string}-${string}-${string}`;
    export function hash(algorithm: string, data: string | ArrayBufferView, outputEncoding?: BufferEncoding): string;
    export function hash(algorithm: string, data: string | ArrayBufferView, outputEncoding: 'buffer'): Buffer;
    export function hash(algorithm: string, data: string | ArrayBufferView, options: {outputEncoding: 'buffer'; outputLength?: number}): Buffer;
    export function hash(algorithm: string, data: string | ArrayBufferView, options: {outputEncoding?: BufferEncoding; outputLength?: number}): string;
    const crypto: {Hash: typeof Hash; Hmac: typeof Hmac; createHash: typeof createHash; createHmac: typeof createHmac;
        getHashes: typeof getHashes; hkdfSync: typeof hkdfSync; pbkdf2Sync: typeof pbkdf2Sync;
        timingSafeEqual: typeof timingSafeEqual; randomBytes: typeof randomBytes;
        randomFillSync: typeof randomFillSync; randomUUID: typeof randomUUID; hash: typeof hash;
        hkdf:typeof hkdf;pbkdf2:typeof pbkdf2;randomFill:typeof randomFill} & AdvancedCryptoMethods;
    export default crypto;
}
declare module 'crypto' { export * from 'node:crypto'; export {default} from 'node:crypto'; }
declare module 'cosmo:crypto' {
    import { Buffer } from 'node:buffer';
    import { BinaryLike } from 'node:crypto';
    /** True BLAKE2b with a 32-byte output parameter, not truncated BLAKE2b-512. */
    export function blake2b256(data: BinaryLike): Buffer;
    const crypto: {blake2b256: typeof blake2b256};
    export default crypto;
}
