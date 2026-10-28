declare module 'node:tls' {
    import {Socket} from 'node:net';
    import type {TcpNetConnectOpts,SocketConstructorOpts} from 'node:net';
    export interface ConnectionOptions extends TcpNetConnectOpts {
        ca?:string|Uint8Array|readonly (string|Uint8Array)[];
        servername?:string;rejectUnauthorized?:true;
        minVersion?:'TLSv1.2';maxVersion?:'TLSv1.2';
    }
    export interface CipherNameAndProtocol {name:string;standardName:string;version:string;}
    export class TLSSocket extends Socket {
        constructor(socket?:undefined|null,options?:Partial<ConnectionOptions>&SocketConstructorOpts);
        readonly encrypted:true;readonly authorized:boolean;readonly authorizationError:string|null;
        readonly alpnProtocol:false;readonly servername:string|undefined;
        getProtocol():'TLSv1.2'|null;getCipher():CipherNameAndProtocol|undefined|null;
        isSessionReused():false;
    }
    export function connect(options:ConnectionOptions,callback?:()=>void):TLSSocket;
    export function connect(port:number|string,host?:string,options?:Partial<ConnectionOptions>,callback?:()=>void):TLSSocket;
    export function connect(port:number|string,options?:Partial<ConnectionOptions>,callback?:()=>void):TLSSocket;
    export function connect(port:number|string,callback?:()=>void):TLSSocket;
    const tls:{connect:typeof connect;TLSSocket:typeof TLSSocket;};export default tls;
}
declare module 'tls' {export * from 'node:tls';export {default} from 'node:tls';}
