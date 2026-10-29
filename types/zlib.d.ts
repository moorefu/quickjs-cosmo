declare module 'node:zlib' {
    import {Buffer} from 'node:buffer';
    export type InputType = string | ArrayBuffer | SharedArrayBuffer | ArrayBufferView;
    export interface Options {
        level?: number; windowBits?: number; memLevel?: number; strategy?: number;
        chunkSize?: number; flush?: number; finishFlush?: number; maxOutputLength?: number;
        dictionary?: Exclude<InputType,string>; rejectGarbageAfterEnd?: boolean;
        /** Engine objects require the stream milestone. */
        info?: false;
    }
    export function gzipSync(input: InputType, options?: Options): Buffer;
    export function gunzipSync(input: InputType, options?: Options): Buffer;
    export function deflateSync(input: InputType, options?: Options): Buffer;
    export function inflateSync(input: InputType, options?: Options): Buffer;
    export function deflateRawSync(input: InputType, options?: Options): Buffer;
    export function inflateRawSync(input: InputType, options?: Options): Buffer;
    export function unzipSync(input: InputType, options?: Options): Buffer;
    export function crc32(data: string | ArrayBufferView, value?: number): number;
    export const codes: Readonly<Record<string | number,string | number>>;
    export const constants: CompressionConstants;
    export interface CompressionConstants {
        readonly Z_NO_FLUSH: number;
        readonly Z_PARTIAL_FLUSH: number;
        readonly Z_SYNC_FLUSH: number;
        readonly Z_FULL_FLUSH: number;
        readonly Z_FINISH: number;
        readonly Z_BLOCK: number;
        readonly Z_OK: number;
        readonly Z_STREAM_END: number;
        readonly Z_NEED_DICT: number;
        readonly Z_ERRNO: number;
        readonly Z_STREAM_ERROR: number;
        readonly Z_DATA_ERROR: number;
        readonly Z_MEM_ERROR: number;
        readonly Z_BUF_ERROR: number;
        readonly Z_VERSION_ERROR: number;
        readonly Z_NO_COMPRESSION: number;
        readonly Z_BEST_SPEED: number;
        readonly Z_BEST_COMPRESSION: number;
        readonly Z_DEFAULT_COMPRESSION: number;
        readonly Z_FILTERED: number;
        readonly Z_HUFFMAN_ONLY: number;
        readonly Z_RLE: number;
        readonly Z_FIXED: number;
        readonly Z_DEFAULT_STRATEGY: number;
        readonly ZLIB_VERNUM: number;
        readonly DEFLATE: number;
        readonly INFLATE: number;
        readonly GZIP: number;
        readonly GUNZIP: number;
        readonly DEFLATERAW: number;
        readonly INFLATERAW: number;
        readonly UNZIP: number;
        readonly Z_MIN_WINDOWBITS: number;
        readonly Z_MAX_WINDOWBITS: number;
        readonly Z_DEFAULT_WINDOWBITS: number;
        readonly Z_MIN_CHUNK: number;
        readonly Z_MAX_CHUNK: number;
        readonly Z_DEFAULT_CHUNK: number;
        readonly Z_MIN_MEMLEVEL: number;
        readonly Z_MAX_MEMLEVEL: number;
        readonly Z_DEFAULT_MEMLEVEL: number;
        readonly Z_MIN_LEVEL: number;
        readonly Z_MAX_LEVEL: number;
        readonly Z_DEFAULT_LEVEL: number;
    }
    const zlib: {gzipSync: typeof gzipSync; gunzipSync: typeof gunzipSync; deflateSync: typeof deflateSync;
        inflateSync: typeof inflateSync; deflateRawSync: typeof deflateRawSync; inflateRawSync: typeof inflateRawSync;
        unzipSync: typeof unzipSync;
        crc32: typeof crc32; codes: typeof codes; constants: typeof constants} & AsyncZlibMethods;
    export default zlib;
}
declare module 'zlib' {export * from 'node:zlib'; export {default} from 'node:zlib';}
declare module 'cosmo:compression' {
    import {Buffer} from 'node:buffer';
    import {InputType} from 'node:zlib';
    export interface BaseOptions {maxOutputLength?: number; chunkSize?: number;}
    export function crc32c(data: InputType, value?: number): number;
    export function adler32(data: InputType, value?: number): number;
    export interface CodecNames {zlib:unknown;}
    export interface CodecInfo {name: keyof CodecNames; format: string; backend: string; version: string;}
    export function codecInfo(): CodecInfo[];
    export function codecInfo(name: CodecInfo['name']): CodecInfo;
    export interface CompressionMethods {crc32c:typeof crc32c;adler32:typeof adler32;codecInfo:typeof codecInfo;}
    const compression: CompressionMethods;
    export default compression;
}
