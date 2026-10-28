/* With lib.dom present its ambient browser surface remains available; use
   CosmoFetch/CosmoWeb types to select the explicitly supported runtime subset. */
declare namespace CosmoWeb {
    type ReadResult<R>={done:false;value:R}|{done:true;value?:R};
    interface Reader<R> {readonly closed:Promise<void>;read():Promise<ReadResult<R>>;cancel(reason?:any):Promise<void>;releaseLock():void;}
    interface Controller<R> {readonly desiredSize:number|null;enqueue(chunk:R):void;close():void;error(reason?:any):void;}
    interface Source<R> {start?(controller:Controller<R>):unknown;pull?(controller:Controller<R>):unknown;cancel?(reason:any):unknown;}
    interface Strategy<R> {highWaterMark?:number;size?:(chunk:R)=>number;}
    interface ReadableStream<R=any> extends AsyncIterable<R> {readonly locked:boolean;getReader(options?:{mode?:never}):Reader<R>;cancel(reason?:any):Promise<void>;tee():[ReadableStream<R>,ReadableStream<R>];values(options?:{preventCancel?:boolean}):AsyncIterableIterator<R>;}
    interface ReadableStreamConstructor {readonly prototype:ReadableStream<any>;new<R=any>(source?:Source<R>,strategy?:Strategy<R>):ReadableStream<R>;}
    interface ReaderConstructor {readonly prototype:Reader<any>;new<R=any>(stream:ReadableStream<R>):Reader<R>;}
}
type _CosmoStream<R>=typeof globalThis extends {onmessage:any}?{}:CosmoWeb.ReadableStream<R>;
type _CosmoReader<R>=typeof globalThis extends {onmessage:any}?{}:CosmoWeb.Reader<R>;
interface ReadableStream<R=any> extends _CosmoStream<R>,AsyncIterable<R> {values(options?:{preventCancel?:boolean}):AsyncIterableIterator<R>;}
interface ReadableStreamDefaultReader<R=any> extends _CosmoReader<R> {}
declare var ReadableStream:typeof globalThis extends {onmessage:any;ReadableStream:infer T}?T:CosmoWeb.ReadableStreamConstructor;
declare var ReadableStreamDefaultReader:typeof globalThis extends {onmessage:any;ReadableStreamDefaultReader:infer T}?T:CosmoWeb.ReaderConstructor;
declare namespace CosmoFetch {
    interface Headers extends Iterable<[string,string]> {append(name:string,value:string):void;set(name:string,value:string):void;delete(name:string):void;get(name:string):string|null;has(name:string):boolean;getSetCookie():string[];entries():IterableIterator<[string,string]>;keys():IterableIterator<string>;values():IterableIterator<string>;forEach(callback:(value:string,key:string,headers:Headers)=>void,thisArg?:any):void;}
    type HeadersInit=Headers|Record<string,string>|Iterable<readonly [string,string]>;
    type BodyInit=string|ArrayBuffer|ArrayBufferView|URLSearchParams|CosmoWeb.ReadableStream<Uint8Array>|AsyncIterable<string|Uint8Array>;
    interface Body {readonly body:CosmoWeb.ReadableStream<Uint8Array>|null;readonly bodyUsed:boolean;arrayBuffer():Promise<ArrayBuffer>;bytes():Promise<Uint8Array>;text():Promise<string>;json():Promise<any>;}
    interface RequestInit {method?:string;headers?:HeadersInit;body?:BodyInit|null;signal?:AbortSignal|null;redirect?:'follow'|'error'|'manual';mode?:'cors'|'no-cors'|'same-origin';credentials?:'omit'|'same-origin'|'include';cache?:'default'|'no-store'|'reload'|'no-cache'|'force-cache'|'only-if-cached';referrer?:string;referrerPolicy?:''|'no-referrer'|'no-referrer-when-downgrade'|'same-origin'|'origin'|'strict-origin'|'origin-when-cross-origin'|'strict-origin-when-cross-origin'|'unsafe-url';integrity?:string;keepalive?:boolean;duplex?:'half';}
    interface Request extends Body {readonly url:string;readonly method:string;readonly headers:Headers;readonly signal:AbortSignal;readonly redirect:'follow'|'error'|'manual';readonly mode:string;readonly credentials:string;readonly cache:string;readonly referrer:string;readonly referrerPolicy:string;readonly integrity:string;readonly keepalive:boolean;readonly duplex:'half';readonly destination:'';clone():Request;}
    interface ResponseInit {status?:number;statusText?:string;headers?:HeadersInit;}
    interface Response extends Body {readonly status:number;readonly statusText:string;readonly headers:Headers;readonly ok:boolean;readonly url:string;readonly redirected:boolean;readonly type:'default'|'basic'|'error';clone():Response;}
    interface HeadersConstructor {readonly prototype:Headers;new(init?:HeadersInit):Headers;}
    interface RequestConstructor {readonly prototype:Request;new(input:string|URL|Request,init?:RequestInit):Request;}
    interface ResponseConstructor {readonly prototype:Response;new(body?:BodyInit|null,init?:ResponseInit):Response;error():Response;redirect(url:string|URL,status?:number):Response;json(data:any,init?:ResponseInit):Response;}
    type Fetch=(input:string|URL|Request,init?:RequestInit)=>Promise<Response>;
}
type _CosmoHeaders=typeof globalThis extends {onmessage:any}?{}:CosmoFetch.Headers;
type _CosmoRequest=typeof globalThis extends {onmessage:any}?{}:CosmoFetch.Request;
type _CosmoRequestInit=typeof globalThis extends {onmessage:any}?{}:CosmoFetch.RequestInit;
type _CosmoResponse=typeof globalThis extends {onmessage:any}?{}:CosmoFetch.Response;
type _CosmoResponseInit=typeof globalThis extends {onmessage:any}?{}:CosmoFetch.ResponseInit;
interface Headers extends _CosmoHeaders {}
interface Request extends _CosmoRequest {}
interface RequestInit extends _CosmoRequestInit {duplex?:'half';}
interface Response extends _CosmoResponse {}
interface ResponseInit extends _CosmoResponseInit {}
declare var Headers:typeof globalThis extends {onmessage:any;Headers:infer T}?T:CosmoFetch.HeadersConstructor;
declare var Request:typeof globalThis extends {onmessage:any;Request:infer T}?T:CosmoFetch.RequestConstructor;
declare var Response:typeof globalThis extends {onmessage:any;Response:infer T}?T:CosmoFetch.ResponseConstructor;
declare function fetch(input:string|URL|Request,init?:CosmoFetch.RequestInit):Promise<Response>;
