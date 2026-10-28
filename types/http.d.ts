declare module 'node:http' {
    import {Stream,Readable,Writable} from 'node:stream';import type {Socket,TcpNetConnectOpts} from 'node:net';import type {URL} from 'node:url';
    export type OutgoingHttpHeader=string|number|readonly string[];
    export type OutgoingHttpHeaders=Record<string,OutgoingHttpHeader|undefined>;
    export interface IncomingHttpHeaders {[name:string]:string|string[]|undefined;}
    export interface AgentOptions {keepAlive?:boolean;maxSockets?:number;maxTotalSockets?:number;maxFreeSockets?:number;timeout?:number;}
    export interface RequestOptions extends Partial<TcpNetConnectOpts> {protocol?:'http:';hostname?:string;path?:string;method?:string;headers?:OutgoingHttpHeaders|readonly string[];auth?:string;agent?:Agent|false;maxHeaderSize?:number;setHost?:boolean;joinDuplicateHeaders?:boolean;}
    export class Agent {constructor(options?:AgentOptions);options:AgentOptions;keepAlive:boolean;maxSockets:number;maxTotalSockets:number;maxFreeSockets:number;readonly totalSocketCount:number;readonly protocol:string;readonly defaultPort:number;
        sockets:Record<string,Socket[]>;freeSockets:Record<string,Socket[]>;requests:Record<string,ClientRequest[]>;
        getName(options:RequestOptions):string;createConnection(options:TcpNetConnectOpts,callback?:(error:Error|null,socket:Socket)=>void):Socket;destroy():void;
    }
    export interface ClientRequest extends Writable {}
    export class ClientRequest extends Stream {
        constructor(options?:RequestOptions,callback?:(response:IncomingMessage)=>void);
        constructor(url:string|URL,options?:RequestOptions,callback?:(response:IncomingMessage)=>void);
        method:string;path:string;host:string;protocol:string;socket:Socket|null;connection:Socket|null;agent:Agent;res:IncomingMessage|null;
        reusedSocket:boolean;aborted:boolean;maxHeadersCount:number;readonly headersSent:boolean;readonly finished:boolean;
        setHeader(name:string,value:OutgoingHttpHeader):this;appendHeader(name:string,value:OutgoingHttpHeader):this;removeHeader(name:string):void;
        getHeader(name:string):OutgoingHttpHeader|undefined;getHeaders():OutgoingHttpHeaders;getHeaderNames():string[];getRawHeaderNames():string[];hasHeader(name:string):boolean;
        flushHeaders():void;abort():void;setTimeout(timeout:number,callback?:()=>void):this;setNoDelay(noDelay?:boolean):void;setSocketKeepAlive(enable?:boolean,initialDelay?:number):void;
    }
    export class IncomingMessage extends Readable {private constructor();socket:Socket;connection:Socket;req:ClientRequest;statusCode:number;statusMessage:string;httpVersion:string;httpVersionMajor:number;httpVersionMinor:number;
        headers:IncomingHttpHeaders;headersDistinct:Record<string,string[]>;rawHeaders:string[];trailers:IncomingHttpHeaders;trailersDistinct:Record<string,string[]>;rawTrailers:string[];complete:boolean;aborted:boolean;setTimeout(timeout:number,callback?:()=>void):this;
    }
    export function request(options:RequestOptions,callback?:(response:IncomingMessage)=>void):ClientRequest;
    export function request(url:string|URL,callback?:(response:IncomingMessage)=>void):ClientRequest;
    export function request(url:string|URL,options:RequestOptions,callback?:(response:IncomingMessage)=>void):ClientRequest;
    export const get:typeof request;export let globalAgent:Agent;export const maxHeaderSize:number;
    export function validateHeaderName(name:string):void;export function validateHeaderValue(name:string,value:unknown):void;
    const http:{request:typeof request;get:typeof get;Agent:typeof Agent;ClientRequest:typeof ClientRequest;IncomingMessage:typeof IncomingMessage;globalAgent:Agent;maxHeaderSize:number;validateHeaderName:typeof validateHeaderName;validateHeaderValue:typeof validateHeaderValue;};export default http;
}
declare module 'http' {export * from 'node:http';export {default} from 'node:http';}
