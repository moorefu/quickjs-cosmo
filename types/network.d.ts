declare module 'node:dns' {
    export type ResultOrder='verbatim'|'ipv4first'|'ipv6first';
    export interface LookupOptions {family?:0|4|6|'IPv4'|'IPv6';hints?:number;all?:boolean;verbatim?:boolean;order?:ResultOrder;}
    export interface LookupAddress {address:string;family:number;}
    export interface DNSError extends Error {code:string;errno:number;syscall:string;hostname:string;}
    export function lookup(hostname:string,callback:(error:DNSError|null,address:string,family:number)=>void):void;
    export function lookup(hostname:string,options:LookupOptions&{all:true},callback:(error:DNSError|null,addresses:LookupAddress[])=>void):void;
    export function lookup(hostname:string,options:LookupOptions|number,callback:(error:DNSError|null,address:string,family:number)=>void):void;
    export function getDefaultResultOrder():ResultOrder;
    export function setDefaultResultOrder(order:ResultOrder):void;
    export const ADDRCONFIG:number,ALL:number,V4MAPPED:number;
    export const promises:typeof import('node:dns/promises').default;
    const dns:{lookup:typeof lookup;getDefaultResultOrder:typeof getDefaultResultOrder;setDefaultResultOrder:typeof setDefaultResultOrder;
        ADDRCONFIG:number;ALL:number;V4MAPPED:number;promises:typeof promises;};export default dns;
}
declare module 'dns' {export * from 'node:dns';export {default} from 'node:dns';}
declare module 'node:dns/promises' {
    import type {LookupOptions,LookupAddress,ResultOrder} from 'node:dns';
    export function lookup(hostname:string,options:LookupOptions&{all:true}):Promise<LookupAddress[]>;
    export function lookup(hostname:string,options?:LookupOptions|number):Promise<LookupAddress>;
    export function getDefaultResultOrder():ResultOrder;
    export function setDefaultResultOrder(order:ResultOrder):void;
    const dns:{lookup:typeof lookup;getDefaultResultOrder:typeof getDefaultResultOrder;setDefaultResultOrder:typeof setDefaultResultOrder;};export default dns;
}
declare module 'dns/promises' {export * from 'node:dns/promises';export {default} from 'node:dns/promises';}
declare module 'node:net' {
    import {Duplex} from 'node:stream';import type {DuplexOptions} from 'node:stream';
    import type {LookupOptions,LookupAddress} from 'node:dns';
    export interface SocketConstructorOpts extends DuplexOptions {timeout?:number;noDelay?:boolean;keepAlive?:boolean;keepAliveInitialDelay?:number;}
    export interface TcpNetConnectOpts extends SocketConstructorOpts {
        port:number|string;host?:string;family?:0|4|6;hints?:number;localAddress?:string;localPort?:number;
        autoSelectFamily?:boolean;autoSelectFamilyAttemptTimeout?:number;
        lookup?:(hostname:string,options:LookupOptions,callback:(error:Error|null,address:string|LookupAddress[],family?:number)=>void)=>void;
    }
    export interface AddressInfo {address:string;family:string;port:number;}
    export class Socket extends Duplex {
        constructor(options?:SocketConstructorOpts);
        connect(options:TcpNetConnectOpts,connectListener?:()=>void):this;
        connect(port:number|string,host?:string,connectListener?:()=>void):this;
        connect(port:number|string,connectListener?:()=>void):this;
        setTimeout(timeout:number,callback?:()=>void):this;setNoDelay(noDelay?:boolean):this;
        setKeepAlive(enable?:boolean,initialDelay?:number):this;ref():this;unref():this;destroySoon():this;
        address():AddressInfo|{};
        readonly connecting:boolean;readonly pending:boolean;readonly bytesRead:number;readonly bytesWritten:number;readonly bufferSize:number;
        readonly timeout:number|undefined;readonly readyState:'opening'|'open'|'readOnly'|'writeOnly'|'closed';
        readonly localAddress:string|undefined;readonly localPort:number|undefined;readonly localFamily:string|undefined;
        readonly remoteAddress:string|undefined;readonly remotePort:number|undefined;readonly remoteFamily:string|undefined;
        autoSelectFamilyAttemptedAddresses:string[];
    }
    export function createConnection(options:TcpNetConnectOpts,connectListener?:()=>void):Socket;
    export function createConnection(port:number|string,host?:string,connectListener?:()=>void):Socket;
    export function createConnection(port:number|string,connectListener?:()=>void):Socket;
    export const connect:typeof createConnection;
    export function isIP(input:string):0|4|6;export function isIPv4(input:string):boolean;export function isIPv6(input:string):boolean;
    export function getDefaultAutoSelectFamily():boolean;export function setDefaultAutoSelectFamily(value:boolean):void;
    export function getDefaultAutoSelectFamilyAttemptTimeout():number;export function setDefaultAutoSelectFamilyAttemptTimeout(value:number):void;
    const net:{Socket:typeof Socket;connect:typeof connect;createConnection:typeof createConnection;isIP:typeof isIP;isIPv4:typeof isIPv4;isIPv6:typeof isIPv6;
        getDefaultAutoSelectFamily:typeof getDefaultAutoSelectFamily;setDefaultAutoSelectFamily:typeof setDefaultAutoSelectFamily;
        getDefaultAutoSelectFamilyAttemptTimeout:typeof getDefaultAutoSelectFamilyAttemptTimeout;setDefaultAutoSelectFamilyAttemptTimeout:typeof setDefaultAutoSelectFamilyAttemptTimeout;};export default net;
}
declare module 'net' {export * from 'node:net';export {default} from 'node:net';}
declare module 'node:url' {
    export class URLSearchParams implements Iterable<[string,string]> {
        constructor(init?:string|URLSearchParams|Record<string,string>|Iterable<readonly [string,string]>);
        readonly size:number;append(name:string,value:string):void;delete(name:string,value?:string):void;
        get(name:string):string|null;getAll(name:string):string[];has(name:string,value?:string):boolean;set(name:string,value:string):void;sort():void;
        entries():IterableIterator<[string,string]>;keys():IterableIterator<string>;values():IterableIterator<string>;
        [Symbol.iterator]():IterableIterator<[string,string]>;
        forEach(callbackfn:(value:string,key:string,parent:URLSearchParams)=>void,thisArg?:any):void;toString():string;
    }
    export class URL {
        constructor(input:string|URL,base?:string|URL);
        href:string;protocol:string;username:string;password:string;host:string;hostname:string;port:string;pathname:string;search:string;hash:string;
        readonly origin:string;readonly searchParams:URLSearchParams;toString():string;toJSON():string;
        static canParse(input:string|URL,base?:string|URL):boolean;static parse(input:string|URL,base?:string|URL):URL|null;
    }
    export function fileURLToPath(url:string|URL,options?:{windows?:boolean}):string;
    export function pathToFileURL(path:string,options?:{windows?:boolean}):URL;
    export function domainToASCII(domain:string):string;export function domainToUnicode(domain:string):string;
    const url:{URL:typeof URL;URLSearchParams:typeof URLSearchParams;fileURLToPath:typeof fileURLToPath;pathToFileURL:typeof pathToFileURL;domainToASCII:typeof domainToASCII;domainToUnicode:typeof domainToUnicode;};export default url;
}
declare module 'url' {export * from 'node:url';export {default} from 'node:url';}
// Resolve to the DOM declarations when they are present, retaining standalone ES support.
interface URL extends importURL {}
type importURL=import('node:url').URL;
declare var URL:typeof globalThis extends {onmessage:any;URL:infer T}?T:typeof import('node:url').URL;
interface URLSearchParams extends importURLSearchParams {}
type importURLSearchParams=import('node:url').URLSearchParams;
declare var URLSearchParams:typeof globalThis extends {onmessage:any;URLSearchParams:infer T}?T:typeof import('node:url').URLSearchParams;
