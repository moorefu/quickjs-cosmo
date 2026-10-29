/** Optional codecs: included only by the full profile. */
declare module 'node:zlib' {
    import {Buffer} from 'node:buffer';
    import {Transform,TransformOptions,StreamCallback} from 'node:stream';
    interface AsyncZlibMethods {zstdCompressSync:typeof zstdCompressSync;zstdDecompressSync:typeof zstdDecompressSync;}
    export interface ZstdOptions {
        params?: Record<number,number | boolean>; pledgedSrcSize?: number;
        dictionary?: Exclude<InputType,string>; chunkSize?: number;
        flush?: number; finishFlush?: number; maxOutputLength?: number;
        rejectGarbageAfterEnd?: boolean; info?: false;
    }
    export function zstdCompressSync(input: InputType, options?: ZstdOptions): Buffer;
    export function zstdDecompressSync(input: InputType, options?: ZstdOptions): Buffer;
    export interface CompressionConstants {
        readonly ZSTD_DECOMPRESS: number;
        readonly ZSTD_COMPRESS: number;
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
    export interface ZstdStreamOptions extends ZstdOptions,Omit<TransformOptions,'flush'> {}
    export interface ZstdCompress extends ZlibStream {}
    export class ZstdCompress extends Transform {
        constructor(options?:ZstdStreamOptions);
    }
    export function createZstdCompress(options?:ZstdStreamOptions):ZstdCompress;
    export interface ZstdDecompress extends ZlibStream {}
    export class ZstdDecompress extends Transform {
        constructor(options?:ZstdStreamOptions);
    }
    export function createZstdDecompress(options?:ZstdStreamOptions):ZstdDecompress;
    export function zstdCompressSync(input:InputType,options:Omit<ZstdOptions,'info'>&{info:true}):ZlibResult<ZstdCompress>;
    export function zstdDecompressSync(input:InputType,options:Omit<ZstdOptions,'info'>&{info:true}):ZlibResult<ZstdDecompress>;
    interface AsyncZstd { (input:InputType,options:Omit<AsyncZstdOptions,'info'>&{info:true},callback:(error:Error|null,result:ZlibResult<ZlibStream>)=>void):void; }
    interface AsyncZlibMethods {
        ZstdCompress:typeof ZstdCompress;createZstdCompress:typeof createZstdCompress;
    }
    interface AsyncZlibMethods {
        ZstdDecompress:typeof ZstdDecompress;createZstdDecompress:typeof createZstdDecompress;
    }
    interface AsyncZlibMethods {zstdCompress:typeof zstdCompress;zstdDecompress:typeof zstdDecompress;}
    export interface AsyncZstdOptions extends ZstdOptions {signal?:AbortSignal;}
    export interface AsyncZstd {
        (input:InputType,callback:CompressCallback):void;
        (input:InputType,options:AsyncZstdOptions,callback:CompressCallback):void;
    }
    export const zstdCompress:AsyncZstd,zstdDecompress:AsyncZstd;
}
declare module 'cosmo:compression' {
    import {Buffer} from 'node:buffer';
    import {InputType,CompressCallback} from 'node:zlib';
    interface CompressionMethods {lz4CompressSync:typeof lz4CompressSync;lz4DecompressSync:typeof lz4DecompressSync;bzip2CompressSync:typeof bzip2CompressSync;bzip2DecompressSync:typeof bzip2DecompressSync;lz4Compress:typeof lz4Compress;lz4Decompress:typeof lz4Decompress;bzip2Compress:typeof bzip2Compress;bzip2Decompress:typeof bzip2Decompress;}
    interface CodecNames {zstd:unknown;lz4:unknown;bzip2:unknown;}
    export interface Lz4Options extends BaseOptions {level?: number; checksum?: boolean; blockSize?: 0 | 4 | 5 | 6 | 7;}
    export interface Bzip2Options extends BaseOptions {level?: number; small?: boolean;}
    export function lz4CompressSync(input: InputType, options?: Lz4Options): Buffer;
    export function lz4DecompressSync(input: InputType, options?: BaseOptions): Buffer;
    export function bzip2CompressSync(input: InputType, options?: Bzip2Options): Buffer;
    export function bzip2DecompressSync(input: InputType, options?: Bzip2Options): Buffer;
    export interface AsyncLz4Options extends Lz4Options {signal?:AbortSignal;}
    export interface AsyncBzip2Options extends Bzip2Options {signal?:AbortSignal;}
    export function lz4Compress(input:InputType,callback:CompressCallback):void;
    export function lz4Compress(input:InputType,options:AsyncLz4Options,callback:CompressCallback):void;
    export const lz4Decompress:typeof lz4Compress;
    export function bzip2Compress(input:InputType,callback:CompressCallback):void;
    export function bzip2Compress(input:InputType,options:AsyncBzip2Options,callback:CompressCallback):void;
    export const bzip2Decompress:typeof bzip2Compress;
}
