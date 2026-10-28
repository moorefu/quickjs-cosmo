import net,{Socket} from 'node:net';import dns from 'node:dns';import dp from 'node:dns/promises';
import {URL,pathToFileURL,fileURLToPath,URLSearchParams} from 'node:url';import fs from 'node:fs';
dns.lookup('localhost',{all:true},(error,addresses)=>addresses.forEach(a=>a.address.toUpperCase()));
dp.lookup('localhost',{all:true}).then(addresses=>addresses.map(a=>a.family));
const socket:Socket=net.connect({port:1234,signal:new AbortController().signal,highWaterMark:4096});
socket.setKeepAlive(true,1000).setNoDelay().setTimeout(100,()=>socket.destroy()).unref();socket.end('hello');
const file=pathToFileURL('/tmp/test');fs.readFileSync(file);const name:string=fileURLToPath(file);
const url=new URL('../a','https://example.com/path');url.searchParams.set('name',name);
const params=new URLSearchParams([['a','1']]);const count:number=params.size;
const globalURL=new globalThis.URL('https://example.com');globalURL.searchParams.append('a','b');
// @ts-expect-error No TCP server API in the client subset.
net.createServer();
// @ts-expect-error DNS record resolution is a separate API.
dns.resolve4('example.com');
// @ts-expect-error Socket port must be numeric or string.
socket.connect({port:true});
// @ts-expect-error Blob URLs have not been admitted.
URL.createObjectURL({});
