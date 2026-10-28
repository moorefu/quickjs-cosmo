declare module 'node:https' {
    import * as http from 'node:http';import type {ConnectionOptions,TLSSocket} from 'node:tls';import type {URL} from 'node:url';
    export interface AgentOptions extends http.AgentOptions,Partial<ConnectionOptions> {maxCachedSessions?:0;}
    export interface RequestOptions extends Omit<http.RequestOptions,'protocol'>,Partial<ConnectionOptions> {protocol?:'https:';}
    export class Agent extends http.Agent {constructor(options?:AgentOptions);readonly maxCachedSessions:0;
        getName(options:http.RequestOptions|RequestOptions):string;
        createConnection(options:ConnectionOptions,callback?:(error:Error|null,socket:TLSSocket)=>void):TLSSocket;
    }
    export function request(options:RequestOptions,callback?:(response:http.IncomingMessage)=>void):http.ClientRequest;
    export function request(url:string|URL,callback?:(response:http.IncomingMessage)=>void):http.ClientRequest;
    export function request(url:string|URL,options:RequestOptions,callback?:(response:http.IncomingMessage)=>void):http.ClientRequest;
    export const get:typeof request;export let globalAgent:Agent;
    const https:{request:typeof request;get:typeof get;Agent:typeof Agent;globalAgent:Agent;};export default https;
}
declare module 'https' {export * from 'node:https';export {default} from 'node:https';}
