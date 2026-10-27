declare module 'node:zlib' {
    import {Transform,TransformOptions,StreamCallback} from 'node:stream';
    import {Buffer} from 'node:buffer';
    export interface ZlibOptions extends Options,Omit<TransformOptions,'flush'> {}
    export interface ZstdStreamOptions extends ZstdOptions,Omit<TransformOptions,'flush'> {}
    export interface ZlibResult<T extends Transform=Transform> {buffer:Buffer;engine:T;}
    export interface ZlibStream extends Transform {
        readonly bytesWritten:number;
        flush(callback?:StreamCallback):void;
        flush(kind:number,callback?:StreamCallback):void;
        close(callback?:()=>void):void;reset():void;
    }
    export interface Deflate extends ZlibStream {}
    export class Deflate extends Transform {
        constructor(options?:ZlibOptions);
        params(level:number,strategy:number,callback:StreamCallback):void;
    }
    export function createDeflate(options?:ZlibOptions):Deflate;
    export interface Inflate extends ZlibStream {}
    export class Inflate extends Transform {
        constructor(options?:ZlibOptions);
    }
    export function createInflate(options?:ZlibOptions):Inflate;
    export interface Gzip extends ZlibStream {}
    export class Gzip extends Transform {
        constructor(options?:ZlibOptions);
        params(level:number,strategy:number,callback:StreamCallback):void;
    }
    export function createGzip(options?:ZlibOptions):Gzip;
    export interface Gunzip extends ZlibStream {}
    export class Gunzip extends Transform {
        constructor(options?:ZlibOptions);
    }
    export function createGunzip(options?:ZlibOptions):Gunzip;
    export interface DeflateRaw extends ZlibStream {}
    export class DeflateRaw extends Transform {
        constructor(options?:ZlibOptions);
        params(level:number,strategy:number,callback:StreamCallback):void;
    }
    export function createDeflateRaw(options?:ZlibOptions):DeflateRaw;
    export interface InflateRaw extends ZlibStream {}
    export class InflateRaw extends Transform {
        constructor(options?:ZlibOptions);
    }
    export function createInflateRaw(options?:ZlibOptions):InflateRaw;
    export interface Unzip extends ZlibStream {}
    export class Unzip extends Transform {
        constructor(options?:ZlibOptions);
    }
    export function createUnzip(options?:ZlibOptions):Unzip;
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
    export function deflateSync(input:InputType,options:Omit<Options,'info'>&{info:true}):ZlibResult<Deflate>;
    export function inflateSync(input:InputType,options:Omit<Options,'info'>&{info:true}):ZlibResult<Inflate>;
    export function gzipSync(input:InputType,options:Omit<Options,'info'>&{info:true}):ZlibResult<Gzip>;
    export function gunzipSync(input:InputType,options:Omit<Options,'info'>&{info:true}):ZlibResult<Gunzip>;
    export function deflateRawSync(input:InputType,options:Omit<Options,'info'>&{info:true}):ZlibResult<DeflateRaw>;
    export function inflateRawSync(input:InputType,options:Omit<Options,'info'>&{info:true}):ZlibResult<InflateRaw>;
    export function unzipSync(input:InputType,options:Omit<Options,'info'>&{info:true}):ZlibResult<Unzip>;
    export function zstdCompressSync(input:InputType,options:Omit<ZstdOptions,'info'>&{info:true}):ZlibResult<ZstdCompress>;
    export function zstdDecompressSync(input:InputType,options:Omit<ZstdOptions,'info'>&{info:true}):ZlibResult<ZstdDecompress>;
    interface AsyncCompression { (input:InputType,options:Omit<AsyncOptions,'info'>&{info:true},callback:(error:Error|null,result:ZlibResult<ZlibStream>)=>void):void; }
    interface AsyncZstd { (input:InputType,options:Omit<AsyncZstdOptions,'info'>&{info:true},callback:(error:Error|null,result:ZlibResult<ZlibStream>)=>void):void; }
    interface AsyncZlibMethods {
        Deflate:typeof Deflate;createDeflate:typeof createDeflate;
        Inflate:typeof Inflate;createInflate:typeof createInflate;
        Gzip:typeof Gzip;createGzip:typeof createGzip;
        Gunzip:typeof Gunzip;createGunzip:typeof createGunzip;
        DeflateRaw:typeof DeflateRaw;createDeflateRaw:typeof createDeflateRaw;
        InflateRaw:typeof InflateRaw;createInflateRaw:typeof createInflateRaw;
        Unzip:typeof Unzip;createUnzip:typeof createUnzip;
        ZstdCompress:typeof ZstdCompress;createZstdCompress:typeof createZstdCompress;
        ZstdDecompress:typeof ZstdDecompress;createZstdDecompress:typeof createZstdDecompress;
    }
}
