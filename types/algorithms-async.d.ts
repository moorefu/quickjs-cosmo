declare module 'node:crypto' {
    import type {Buffer} from 'node:buffer';
    export type CryptoCallback<T>=(error:Error|null,value:T)=>void;
    export function hkdf(digest:string,ikm:BinaryLike|KeyObject,salt:BinaryLike,info:BinaryLike,keylen:number,callback:CryptoCallback<ArrayBuffer>):void;
    export function pbkdf2(password:BinaryLike,salt:BinaryLike,iterations:number,keylen:number,digest:string,callback:CryptoCallback<Buffer>):void;
    export function randomBytes(size:number,callback:CryptoCallback<Buffer>):void;
    export function randomFill<T extends ArrayBuffer|SharedArrayBuffer|ArrayBufferView>(buffer:T,callback:CryptoCallback<T>):void;
    export function randomFill<T extends ArrayBuffer|SharedArrayBuffer|ArrayBufferView>(buffer:T,offset:number,callback:CryptoCallback<T>):void;
    export function randomFill<T extends ArrayBuffer|SharedArrayBuffer|ArrayBufferView>(buffer:T,offset:number,size:number,callback:CryptoCallback<T>):void;
}
declare module 'node:zlib' {
    import type {Buffer} from 'node:buffer';
    export interface AsyncOptions extends Options {signal?:AbortSignal;}
    export type CompressCallback=(error:Error|null,value:Buffer)=>void;
    export interface AsyncCompression {
        (input:InputType,callback:CompressCallback):void;
        (input:InputType,options:AsyncOptions,callback:CompressCallback):void;
    }
    export const gzip:AsyncCompression,gunzip:AsyncCompression,deflate:AsyncCompression,inflate:AsyncCompression,
        deflateRaw:AsyncCompression,inflateRaw:AsyncCompression,unzip:AsyncCompression;
    export interface AsyncZlibMethods {gzip:typeof gzip;gunzip:typeof gunzip;deflate:typeof deflate;inflate:typeof inflate;
        deflateRaw:typeof deflateRaw;inflateRaw:typeof inflateRaw;unzip:typeof unzip;}
}
declare module 'cosmo:compression' {
    import type {InputType,CompressCallback} from 'node:zlib';
}
