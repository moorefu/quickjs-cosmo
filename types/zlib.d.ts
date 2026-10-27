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
    export interface ZstdOptions {
        params?: Record<number,number | boolean>; pledgedSrcSize?: number;
        dictionary?: Exclude<InputType,string>; chunkSize?: number;
        flush?: number; finishFlush?: number; maxOutputLength?: number;
        rejectGarbageAfterEnd?: boolean; info?: false;
    }
    export function gzipSync(input: InputType, options?: Options): Buffer;
    export function gunzipSync(input: InputType, options?: Options): Buffer;
    export function deflateSync(input: InputType, options?: Options): Buffer;
    export function inflateSync(input: InputType, options?: Options): Buffer;
    export function deflateRawSync(input: InputType, options?: Options): Buffer;
    export function inflateRawSync(input: InputType, options?: Options): Buffer;
    export function unzipSync(input: InputType, options?: Options): Buffer;
    export function zstdCompressSync(input: InputType, options?: ZstdOptions): Buffer;
    export function zstdDecompressSync(input: InputType, options?: ZstdOptions): Buffer;
    export function crc32(data: string | ArrayBufferView, value?: number): number;
    export const codes: Readonly<Record<string | number,string | number>>;
    export const constants: CompressionConstants;
    interface CompressionConstants {
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
        readonly ZSTD_DECOMPRESS: number;
        readonly ZSTD_COMPRESS: number;
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
        readonly ZSTD_e_continue: number;
        readonly ZSTD_e_flush: number;
        readonly ZSTD_e_end: number;
        readonly ZSTD_fast: number;
        readonly ZSTD_dfast: number;
        readonly ZSTD_greedy: number;
        readonly ZSTD_lazy: number;
        readonly ZSTD_lazy2: number;
        readonly ZSTD_btlazy2: number;
        readonly ZSTD_btopt: number;
        readonly ZSTD_btultra: number;
        readonly ZSTD_btultra2: number;
        readonly ZSTD_c_compressionLevel: number;
        readonly ZSTD_c_windowLog: number;
        readonly ZSTD_c_hashLog: number;
        readonly ZSTD_c_chainLog: number;
        readonly ZSTD_c_searchLog: number;
        readonly ZSTD_c_minMatch: number;
        readonly ZSTD_c_targetLength: number;
        readonly ZSTD_c_strategy: number;
        readonly ZSTD_c_enableLongDistanceMatching: number;
        readonly ZSTD_c_ldmHashLog: number;
        readonly ZSTD_c_ldmMinMatch: number;
        readonly ZSTD_c_ldmBucketSizeLog: number;
        readonly ZSTD_c_ldmHashRateLog: number;
        readonly ZSTD_c_contentSizeFlag: number;
        readonly ZSTD_c_checksumFlag: number;
        readonly ZSTD_c_dictIDFlag: number;
        readonly ZSTD_c_nbWorkers: number;
        readonly ZSTD_c_jobSize: number;
        readonly ZSTD_c_overlapLog: number;
        readonly ZSTD_d_windowLogMax: number;
        readonly ZSTD_CLEVEL_DEFAULT: number;
        readonly ZSTD_error_no_error: number;
        readonly ZSTD_error_GENERIC: number;
        readonly ZSTD_error_prefix_unknown: number;
        readonly ZSTD_error_version_unsupported: number;
        readonly ZSTD_error_frameParameter_unsupported: number;
        readonly ZSTD_error_frameParameter_windowTooLarge: number;
        readonly ZSTD_error_corruption_detected: number;
        readonly ZSTD_error_checksum_wrong: number;
        readonly ZSTD_error_literals_headerWrong: number;
        readonly ZSTD_error_dictionary_corrupted: number;
        readonly ZSTD_error_dictionary_wrong: number;
        readonly ZSTD_error_dictionaryCreation_failed: number;
        readonly ZSTD_error_parameter_unsupported: number;
        readonly ZSTD_error_parameter_combination_unsupported: number;
        readonly ZSTD_error_parameter_outOfBound: number;
        readonly ZSTD_error_tableLog_tooLarge: number;
        readonly ZSTD_error_maxSymbolValue_tooLarge: number;
        readonly ZSTD_error_maxSymbolValue_tooSmall: number;
        readonly ZSTD_error_stabilityCondition_notRespected: number;
        readonly ZSTD_error_stage_wrong: number;
        readonly ZSTD_error_init_missing: number;
        readonly ZSTD_error_memory_allocation: number;
        readonly ZSTD_error_workSpace_tooSmall: number;
        readonly ZSTD_error_dstSize_tooSmall: number;
        readonly ZSTD_error_srcSize_wrong: number;
        readonly ZSTD_error_dstBuffer_null: number;
        readonly ZSTD_error_noForwardProgress_destFull: number;
        readonly ZSTD_error_noForwardProgress_inputEmpty: number;
    }
    const zlib: {gzipSync: typeof gzipSync; gunzipSync: typeof gunzipSync; deflateSync: typeof deflateSync;
        inflateSync: typeof inflateSync; deflateRawSync: typeof deflateRawSync; inflateRawSync: typeof inflateRawSync;
        unzipSync: typeof unzipSync; zstdCompressSync: typeof zstdCompressSync; zstdDecompressSync: typeof zstdDecompressSync;
        crc32: typeof crc32; codes: typeof codes; constants: typeof constants} & AsyncZlibMethods;
    export default zlib;
}
declare module 'zlib' {export * from 'node:zlib'; export {default} from 'node:zlib';}
declare module 'cosmo:compression' {
    import {Buffer} from 'node:buffer';
    import {InputType} from 'node:zlib';
    export interface BaseOptions {maxOutputLength?: number; chunkSize?: number;}
    export interface Lz4Options extends BaseOptions {level?: number; checksum?: boolean; blockSize?: 0 | 4 | 5 | 6 | 7;}
    export interface Bzip2Options extends BaseOptions {level?: number; small?: boolean;}
    export function lz4CompressSync(input: InputType, options?: Lz4Options): Buffer;
    export function lz4DecompressSync(input: InputType, options?: BaseOptions): Buffer;
    export function bzip2CompressSync(input: InputType, options?: Bzip2Options): Buffer;
    export function bzip2DecompressSync(input: InputType, options?: Bzip2Options): Buffer;
    export function crc32c(data: InputType, value?: number): number;
    export function adler32(data: InputType, value?: number): number;
    export interface CodecInfo {name: 'zlib' | 'zstd' | 'lz4' | 'bzip2'; format: string; backend: string; version: string;}
    export function codecInfo(): CodecInfo[];
    export function codecInfo(name: CodecInfo['name']): CodecInfo;
    const compression: {lz4CompressSync: typeof lz4CompressSync; lz4DecompressSync: typeof lz4DecompressSync;
        bzip2CompressSync: typeof bzip2CompressSync; bzip2DecompressSync: typeof bzip2DecompressSync;
        crc32c: typeof crc32c; adler32: typeof adler32; codecInfo: typeof codecInfo;
        lz4Compress:typeof lz4Compress;lz4Decompress:typeof lz4Decompress;bzip2Compress:typeof bzip2Compress;bzip2Decompress:typeof bzip2Decompress};
    export default compression;
}
