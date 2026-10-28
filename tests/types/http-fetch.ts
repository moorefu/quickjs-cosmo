import http from 'node:http';import type {ClientRequest,IncomingMessage} from 'node:http';
const agent=new http.Agent({keepAlive:true,maxSockets:1,maxTotalSockets:8});
const request:ClientRequest=http.request('http://localhost:8080',{agent,method:'POST',headers:{'X-Count':2}},(response:IncomingMessage)=>{response.on('data',chunk=>{});response.resume();});
request.setHeader('X-Value',['a','b']).end('hello');request.getHeaderNames().map(name=>name.toLowerCase());
const headers=new Headers([['accept','text/plain']]);headers.getSetCookie();
const response=Response.json({ok:true},{status:201});response.clone().json().then(value=>value.ok);
const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array([65]));c.close();}});
const body:CosmoWeb.ReadableStream<Uint8Array>=stream;body.getReader().read().then(value=>value.done);
fetch(new Request('http://localhost:8080',{method:'POST',body:stream,duplex:'half'})).then(async value=>{for await(const part of value.body??[])part.byteLength;return value.text();});
const subset:CosmoFetch.RequestInit={redirect:'manual',body:'hello'};
// @ts-expect-error Only the audited default-reader subset is enabled.
body.getReader({mode:'byob'});
// @ts-expect-error Blob/FormData are outside the explicit body subset.
const unsupported:CosmoFetch.RequestInit={body:{blob:true}};
// @ts-expect-error HTTP servers are outside the client module.
http.createServer();
