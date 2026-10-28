import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
const source=`import https from 'node:https';import http from 'node:http';import net from 'node:net';import {readFileSync} from 'node:fs';import {join} from 'node:path';import zlib from 'node:zlib';import {constants} from 'node:crypto';
const folder=process.argv[1],servers=[],sockets=new Set();let serial=0;
function handler(req,res){res.setHeader('x-connection',String(req.socket.id));
if(req.url==='/stall')return;if(req.url==='/stall-body'){res.write('first');return;}
if(req.url==='/slow'){res.write('first');setTimeout(()=>res.end('last'),80);return;}
if(req.url==='/gzip'){res.setHeader('content-encoding','gzip');res.end(zlib.gzipSync(Buffer.from('HTTPS compressed 中文')));return;}
if(req.url==='/corrupt'){res.setHeader('content-encoding','gzip');res.end('broken');return;}
if(req.url==='/bytes'){res.end(Buffer.alloc(262147,120));return;}
if(req.url==='/redirect'||req.url==='/downgrade'||req.url==='/upgrade'){const to=req.url==='/downgrade'?'http://127.0.0.1:'+plain.address().port:req.url==='/upgrade'?'https://localhost:'+secure.address().port:'';res.writeHead(302,{location:to+'/echo'});res.end();return;}
const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({method:req.method,body:Buffer.concat(chunks).toString('hex'),auth:req.headers.authorization??null,cookie:req.headers.cookie??null,sni:req.socket.servername||null}));});}
function track(s){s.on('connection',c=>{c.id=++serial;sockets.add(c);c.on('error',()=>{});c.once('close',()=>sockets.delete(c));});s.on('tlsClientError',()=>{});servers.push(s);return s;}
// Use full handshakes: the runtime's admitted TLS subset has no session cache.
function tlsOptions(cert){return {key:readFileSync(join(folder,cert+'.key')),cert:readFileSync(join(folder,cert+'.pem')),minVersion:'TLSv1.2',maxVersion:'TLSv1.2',secureOptions:constants.SSL_OP_NO_TICKET};}
const secure=track(https.createServer(tlsOptions('rsa'),handler)),bad=track(https.createServer(tlsOptions('wrong-dns'),handler)),plain=track(http.createServer(handler)),slow=track(net.createServer(c=>c.on('data',()=>{})));
for(const s of servers)await new Promise(r=>s.listen(0,'127.0.0.1',r));
console.log(JSON.stringify({port:secure.address().port,bad:bad.address().port,plain:plain.address().port,slow:slow.address().port}));process.stdin.resume();process.stdin.on('end',()=>{for(const c of sockets)c.destroy();for(const s of servers)s.close();});`;
export async function httpsService(){
    const folder=mkdtempSync(join(process.cwd(),'https-')),node=process.env.NODE_COMPAT_CHILD_EXECUTABLE;
    try{execFileSync(node,[fileURLToPath(new URL('../../fixtures/tls-certificates.mjs',import.meta.url)),folder]);}catch(e){rmSync(folder,{recursive:true,force:true});throw e;}
    const child=spawn(node,['--input-type=module','-e',source,folder],{stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',c=>stderr+=c);const closed=new Promise(r=>child.once('close',r));
    const ports=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('HTTPS service startup: '+stderr)),15000);child.once('error',reject);child.stdout.on('data',c=>{text+=c;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.split('\n',1)[0]));}});});
    return {...ports,ca:join(folder,'ca.pem'),async close(){child.stdin.end();await closed;rmSync(folder,{recursive:true,force:true});}};
}
