// The implemented ESM subset. This file does not declare unimplemented Node APIs.
declare module 'node:buffer' {
    export type BufferEncoding = 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'utf-16le' |
        'ucs2' | 'ucs-2' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex';
    // Intersection preserves Uint8Array assignability while allowing Buffer's
    // shared slice() contract, including views over SharedArrayBuffer.
    export type Buffer = BufferMethods & Uint8Array;
    export type TypedArray = Uint8Array | Uint8ClampedArray | Int8Array | Uint16Array | Int16Array |
        Uint32Array | Int32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array;
    export interface BufferMethods {
        toString(encoding?: BufferEncoding, start?: number, end?: number): string;
        toJSON(): { type: 'Buffer'; data: number[] };
        equals(other: Uint8Array): boolean;
        compare(target: Uint8Array, targetStart?: number, targetEnd?: number, sourceStart?: number, sourceEnd?: number): number;
        copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
        fill(value: string | number | Uint8Array, offset?: number, end?: number, encoding?: BufferEncoding): this;
        fill(value: string, encoding: BufferEncoding): this;
        slice(start?: number, end?: number): Buffer;
        subarray(start?: number, end?: number): Buffer;
        write(value: string, encoding?: BufferEncoding): number;
        write(value: string, offset: number, length?: number, encoding?: BufferEncoding): number;
        indexOf(value: string | number | Uint8Array, byteOffset?: number, encoding?: BufferEncoding): number;
        lastIndexOf(value: string | number | Uint8Array, byteOffset?: number, encoding?: BufferEncoding): number;
        includes(value: string | number | Uint8Array, byteOffset?: number, encoding?: BufferEncoding): boolean;
        swap16(): this;
        swap32(): this;
        swap64(): this;
        readonly parent: ArrayBufferLike;
        readonly offset: number;
        readUInt8(offset?: number): number;
        readInt8(offset?: number): number;
        readUInt16LE(offset?: number): number;
        readUInt16BE(offset?: number): number;
        readInt16LE(offset?: number): number;
        readInt16BE(offset?: number): number;
        readUInt32LE(offset?: number): number;
        readUInt32BE(offset?: number): number;
        readInt32LE(offset?: number): number;
        readInt32BE(offset?: number): number;
        readUIntLE(offset: number, byteLength: number): number;
        readUIntBE(offset: number, byteLength: number): number;
        readIntLE(offset: number, byteLength: number): number;
        readIntBE(offset: number, byteLength: number): number;
        readFloatLE(offset?: number): number;
        readFloatBE(offset?: number): number;
        readDoubleLE(offset?: number): number;
        readDoubleBE(offset?: number): number;
        readBigUInt64LE(offset?: number): bigint;
        readBigUInt64BE(offset?: number): bigint;
        readBigInt64LE(offset?: number): bigint;
        readBigInt64BE(offset?: number): bigint;
        writeUInt8(value: number, offset?: number): number;
        writeInt8(value: number, offset?: number): number;
        writeUInt16LE(value: number, offset?: number): number;
        writeUInt16BE(value: number, offset?: number): number;
        writeInt16LE(value: number, offset?: number): number;
        writeInt16BE(value: number, offset?: number): number;
        writeUInt32LE(value: number, offset?: number): number;
        writeUInt32BE(value: number, offset?: number): number;
        writeInt32LE(value: number, offset?: number): number;
        writeInt32BE(value: number, offset?: number): number;
        writeUIntLE(value: number, offset: number, byteLength: number): number;
        writeUIntBE(value: number, offset: number, byteLength: number): number;
        writeIntLE(value: number, offset: number, byteLength: number): number;
        writeIntBE(value: number, offset: number, byteLength: number): number;
        writeFloatLE(value: number, offset?: number): number;
        writeFloatBE(value: number, offset?: number): number;
        writeDoubleLE(value: number, offset?: number): number;
        writeDoubleBE(value: number, offset?: number): number;
        writeBigUInt64LE(value: bigint, offset?: number): number;
        writeBigUInt64BE(value: bigint, offset?: number): number;
        writeBigInt64LE(value: bigint, offset?: number): number;
        writeBigInt64BE(value: bigint, offset?: number): number;
        readUint8: BufferMethods['readUInt8'];
        readUint16LE: BufferMethods['readUInt16LE'];
        readUint16BE: BufferMethods['readUInt16BE'];
        readUint32LE: BufferMethods['readUInt32LE'];
        readUint32BE: BufferMethods['readUInt32BE'];
        readUintLE: BufferMethods['readUIntLE'];
        readUintBE: BufferMethods['readUIntBE'];
        readBigUint64LE: BufferMethods['readBigUInt64LE'];
        readBigUint64BE: BufferMethods['readBigUInt64BE'];
        writeUint8: BufferMethods['writeUInt8'];
        writeUint16LE: BufferMethods['writeUInt16LE'];
        writeUint16BE: BufferMethods['writeUInt16BE'];
        writeUint32LE: BufferMethods['writeUInt32LE'];
        writeUint32BE: BufferMethods['writeUInt32BE'];
        writeUintLE: BufferMethods['writeUIntLE'];
        writeUintBE: BufferMethods['writeUIntBE'];
        writeBigUint64LE: BufferMethods['writeBigUInt64LE'];
        writeBigUint64BE: BufferMethods['writeBigUInt64BE'];
    }
    export interface BufferConstructor {
        readonly prototype: Buffer;
        poolSize: number;
        from(value: string, encoding?: BufferEncoding): Buffer;
        from(value: ArrayBufferLike, byteOffset?: number, length?: number): Buffer;
        from(value: ArrayLike<number> | { type: 'Buffer'; data: number[] }): Buffer;
        alloc(size: number, fill?: string | number | Uint8Array, encoding?: BufferEncoding): Buffer;
        allocUnsafe(size: number): Buffer;
        allocUnsafeSlow(size: number): Buffer;
        isBuffer(value: unknown): value is Buffer;
        isEncoding(value: unknown): value is BufferEncoding;
        byteLength(value: string | ArrayBufferLike | ArrayBufferView, encoding?: BufferEncoding): number;
        concat(list: readonly Uint8Array[], totalLength?: number): Buffer;
        compare(a: Uint8Array, b: Uint8Array): number;
        copyBytesFrom(view: TypedArray, offset?: number, length?: number): Buffer;
    }
    export const Buffer: BufferConstructor;
    export function SlowBuffer(length: number): Buffer;
    export const kMaxLength: number;
    export const kStringMaxLength: number;
    export const constants: Readonly<{ MAX_LENGTH: number; MAX_STRING_LENGTH: number }>;
    const api: { Buffer: BufferConstructor; SlowBuffer: typeof SlowBuffer; kMaxLength: number;
                 kStringMaxLength: number; constants: typeof constants };
    export default api;
}
declare module 'buffer' {
    export * from 'node:buffer';
    import api from 'node:buffer';
    export default api;
}
declare var Buffer: import('node:buffer').BufferConstructor;
type Buffer = import('node:buffer').Buffer;
