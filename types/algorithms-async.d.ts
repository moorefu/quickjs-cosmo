declare module 'node:crypto' {
    import type {Buffer} from 'node:buffer';
    export type CryptoCallback<T>=(error:Error|null,value:T)=>void;
    export function hkdf(digest:string,ikm:BinaryLike,salt:BinaryLike,info:BinaryLike,keylen:number,callback:CryptoCallback<ArrayBuffer>):void;
    export function pbkdf2(password:BinaryLike,salt:BinaryLike,iterations:number,keylen:number,digest:string,callback:CryptoCallback<Buffer>):void;
    export function randomBytes(size:number,callback:CryptoCallback<Buffer>):void;
    export function randomFill<T extends ArrayBuffer|SharedArrayBuffer|ArrayBufferView>(buffer:T,callback:CryptoCallback<T>):void;
    export function randomFill<T extends ArrayBuffer|SharedArrayBuffer|ArrayBufferView>(buffer:T,offset:number,callback:CryptoCallback<T>):void;
    export function randomFill<T extends ArrayBuffer|SharedArrayBuffer|ArrayBufferView>(buffer:T,offset:number,size:number,callback:CryptoCallback<T>):void;
}
declare module 'node:zlib' {
    import type {Buffer} from 'node:buffer';
    export interface AsyncOptions extends Options {signal?:AbortSignal;}
    export interface AsyncZstdOptions extends ZstdOptions {signal?:AbortSignal;}
    export type CompressCallback=(error:Error|null,value:Buffer)=>void;
    export interface AsyncCompression {
        (input:InputType,callback:CompressCallback):void;
        (input:InputType,options:AsyncOptions,callback:CompressCallback):void;
    }
    export interface AsyncZstd {
        (input:InputType,callback:CompressCallback):void;
        (input:InputType,options:AsyncZstdOptions,callback:CompressCallback):void;
    }
    export const gzip:AsyncCompression,gunzip:AsyncCompression,deflate:AsyncCompression,inflate:AsyncCompression,
        deflateRaw:AsyncCompression,inflateRaw:AsyncCompression,unzip:AsyncCompression;
    export const zstdCompress:AsyncZstd,zstdDecompress:AsyncZstd;
    export interface AsyncZlibMethods {gzip:typeof gzip;gunzip:typeof gunzip;deflate:typeof deflate;inflate:typeof inflate;
        deflateRaw:typeof deflateRaw;inflateRaw:typeof inflateRaw;unzip:typeof unzip;zstdCompress:typeof zstdCompress;zstdDecompress:typeof zstdDecompress;}
}
declare module 'cosmo:compression' {
    import type {InputType,CompressCallback} from 'node:zlib';
    export interface AsyncLz4Options extends Lz4Options {signal?:AbortSignal;}
    export interface AsyncBzip2Options extends Bzip2Options {signal?:AbortSignal;}
    export function lz4Compress(input:InputType,callback:CompressCallback):void;
    export function lz4Compress(input:InputType,options:AsyncLz4Options,callback:CompressCallback):void;
    export const lz4Decompress:typeof lz4Compress;
    export function bzip2Compress(input:InputType,callback:CompressCallback):void;
    export function bzip2Compress(input:InputType,options:AsyncBzip2Options,callback:CompressCallback):void;
    export const bzip2Decompress:typeof bzip2Compress;
}
