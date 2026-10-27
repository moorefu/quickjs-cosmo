declare module 'node:stream' {
    import {EventEmitter} from 'node:events';
    import type {BufferEncoding} from 'node:buffer';
    export type StreamCallback=(error?:Error|null)=>void;
    export interface StreamOptions {
        highWaterMark?:number;objectMode?:boolean;autoDestroy?:boolean;emitClose?:boolean;signal?:AbortSignal;
        construct?:(this:Stream,callback:StreamCallback)=>void;
        destroy?:(this:Stream,error:Error|null,callback:StreamCallback)=>void;
    }
    export interface ReadableOptions extends StreamOptions {
        readable?:boolean;readableObjectMode?:boolean;readableHighWaterMark?:number;encoding?:BufferEncoding;
        read?:(this:Readable,size:number)=>void;
    }
    export interface WriteVEntry {chunk:any;encoding:string;}
    export interface WritableOptions extends StreamOptions {
        writable?:boolean;writableObjectMode?:boolean;writableHighWaterMark?:number;decodeStrings?:boolean;defaultEncoding?:BufferEncoding;
        write?:(this:Writable,chunk:any,encoding:string,callback:StreamCallback)=>void;
        writev?:(this:Writable,chunks:WriteVEntry[],callback:StreamCallback)=>void;
        final?:(this:Writable,callback:StreamCallback)=>void;
    }
    export interface DuplexOptions extends ReadableOptions,WritableOptions {allowHalfOpen?:boolean;}
    export type TransformCallback=(error?:Error|null,data?:any)=>void;
    export interface TransformOptions extends DuplexOptions {
        transform?:(this:Transform,chunk:any,encoding:string,callback:TransformCallback)=>void;
        flush?:(this:Transform,callback:TransformCallback)=>void;
    }
    export class Stream extends EventEmitter {
        readonly destroyed:boolean;readonly closed:boolean;readonly errored:Error|null;
        destroy(error?:Error):this;
        _destroy(error:Error|null,callback:StreamCallback):void;
        [Symbol.asyncDispose]():Promise<void>;
        static Stream:typeof Stream;static Readable:typeof Readable;static Writable:typeof Writable;
        static Duplex:typeof Duplex;static Transform:typeof Transform;static PassThrough:typeof PassThrough;
        static pipeline:typeof pipeline;static finished:typeof finished;static addAbortSignal:typeof addAbortSignal;
        static promises:typeof import('node:stream/promises');
    }
    export class Readable extends Stream implements AsyncIterable<any> {
        constructor(options?:ReadableOptions);
        static from(iterable:Iterable<any>|AsyncIterable<any>|string|ArrayBufferView,options?:ReadableOptions):Readable;
        readonly readable:boolean;readonly readableEnded:boolean;readonly readableLength:number;
        readonly readableHighWaterMark:number;readonly readableObjectMode:boolean;readonly readableEncoding:BufferEncoding|null;
        readableFlowing:boolean|null;
        _read(size:number):void;
        push(chunk:any,encoding?:BufferEncoding):boolean;
        unshift(chunk:any,encoding?:BufferEncoding):boolean;
        read(size?:number):any;
        setEncoding(encoding:BufferEncoding):this;
        pause():this;resume():this;isPaused():boolean;
        pipe<T extends Writable>(destination:T,options?:{end?:boolean}):T;
        unpipe(destination?:Writable):this;
        iterator(options?:{destroyOnReturn?:boolean}):AsyncIterableIterator<any>;
        [Symbol.asyncIterator]():AsyncIterableIterator<any>;
    }
    export class Writable extends Stream {
        constructor(options?:WritableOptions);
        readonly writable:boolean;readonly writableEnded:boolean;readonly writableFinished:boolean;readonly writableLength:number;
        readonly writableHighWaterMark:number;readonly writableObjectMode:boolean;readonly writableNeedDrain:boolean;readonly writableCorked:number;
        _write(chunk:any,encoding:string,callback:StreamCallback):void;
        write(chunk:any,callback?:StreamCallback):boolean;
        write(chunk:any,encoding:BufferEncoding,callback?:StreamCallback):boolean;
        end(callback?:StreamCallback):this;
        end(chunk:any,callback?:StreamCallback):this;
        end(chunk:any,encoding:BufferEncoding,callback?:StreamCallback):this;
        cork():void;uncork():void;setDefaultEncoding(encoding:BufferEncoding):this;
    }
    export class Duplex extends Readable {constructor(options?:DuplexOptions);allowHalfOpen:boolean;}
    export interface Duplex extends Writable {}
    export class Transform extends Duplex {
        constructor(options?:TransformOptions);
        _transform(chunk:any,encoding:string,callback:TransformCallback):void;
    }
    export class PassThrough extends Transform {}
    export interface FinishedOptions {readable?:boolean;writable?:boolean;error?:boolean;signal?:AbortSignal;cleanup?:boolean;}
    export interface PipelineOptions {signal?:AbortSignal;end?:true;}
    export function finished(stream:Stream,callback:StreamCallback):()=>void;
    export function finished(stream:Stream,options:FinishedOptions,callback:StreamCallback):()=>void;
    export function pipeline<T extends Writable>(source:Readable|Iterable<any>|AsyncIterable<any>,destination:T,callback:StreamCallback):T;
    export function pipeline<T extends Writable>(source:Readable|Iterable<any>|AsyncIterable<any>,transform:Duplex,destination:T,callback:StreamCallback):T;
    export function pipeline<T extends Writable>(source:Readable|Iterable<any>|AsyncIterable<any>,...streams:[...Duplex[],T,StreamCallback]):T;
    export function pipeline(streams:Stream[],callback:StreamCallback):Writable;
    export function addAbortSignal<T extends Stream>(signal:AbortSignal,stream:T):T;
    export const promises:typeof import('node:stream/promises');
    export default Stream;
}
declare module 'stream' {export * from 'node:stream';export {default} from 'node:stream';}
declare module 'node:stream/promises' {
    import type {Readable,Writable,Duplex,Stream,FinishedOptions,PipelineOptions} from 'node:stream';
    export function finished(stream:Stream,options?:FinishedOptions):Promise<void>;
    export function pipeline(source:Readable|Iterable<any>|AsyncIterable<any>,destination:Writable,options?:PipelineOptions):Promise<void>;
    export function pipeline(source:Readable|Iterable<any>|AsyncIterable<any>,transform:Duplex,destination:Writable,options?:PipelineOptions):Promise<void>;
    export function pipeline(source:Readable|Iterable<any>|AsyncIterable<any>,...streams:[...Duplex[],Writable]):Promise<void>;
    export function pipeline(source:Readable|Iterable<any>|AsyncIterable<any>,...streams:[...Duplex[],Writable,PipelineOptions]):Promise<void>;
    export function pipeline(streams:Stream[],options?:PipelineOptions):Promise<void>;
    const promises:{finished:typeof finished;pipeline:typeof pipeline};export default promises;
}
declare module 'stream/promises' {export * from 'node:stream/promises';export {default} from 'node:stream/promises';}
