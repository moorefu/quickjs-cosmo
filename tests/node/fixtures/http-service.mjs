import {spawn} from 'node:child_process';
const source=`import http from 'node:http';import net from 'node:net';import zlib from 'node:zlib';
let serial=0;const sockets=new Set(),servers=[];
const server=http.createServer(async(req,res)=>{
res.setHeader('x-connection',String(req.socket.id));
if(req.url==='/stall')return;
if(req.url==='/stall-body'){res.writeHead(200);res.write('first');return;}
if(req.url==='/chunk'){res.writeHead(200,{'x-case':['One','Two'],'set-cookie':['a=1','b=2']});res.write(Buffer.alloc(70003,65));setImmediate(()=>{res.addTrailers({'x-trailer':'done'});res.end('end');});return;}
if(req.url==='/slow'){res.writeHead(200);res.write('first');setTimeout(()=>res.end('last'),60);return;}
if(req.url==='/gzip'){res.setHeader('content-encoding','gzip');res.end(zlib.gzipSync(Buffer.from('compressed 中文')));return;}
if(req.url==='/deflate'||req.url==='/raw-deflate'){res.setHeader('content-encoding','deflate');res.end((req.url==='/deflate'?zlib.deflateSync:zlib.deflateRawSync)(Buffer.from('deflated 中文')));return;}
if(req.url==='/corrupt'){res.setHeader('content-encoding','gzip');res.end(Buffer.from('not a gzip frame'));return;}
if(req.url==='/redirect'){res.writeHead(302,{location:'/echo'});res.end();return;}
if(req.url==='/redirect307'){res.writeHead(307,{location:'/echo'});res.end();return;}
if(req.url==='/loop'){res.writeHead(302,{location:'/loop'});res.end();return;}
if(req.url==='/cross'){res.writeHead(302,{location:'http://localhost:'+server.address().port+'/echo'});res.end();return;}
if(req.url==='/empty'){res.writeHead(204);res.end();return;}
const chunks=[];try{for await(const chunk of req)chunks.push(chunk);}catch{return;}const body=Buffer.concat(chunks);
res.setHeader('content-type','application/json');res.end(JSON.stringify({method:req.method,path:req.url,body:body.toString('hex'),headers:{length:req.headers['content-length']??null,transfer:req.headers['transfer-encoding']??null,custom:req.headers['x-custom']??null,cookie:req.headers.cookie??null,auth:req.headers.authorization??null}}));});
function track(s){s.on('connection',c=>{c.id=++serial;sockets.add(c);c.on('error',()=>{});c.on('close',()=>sockets.delete(c));});servers.push(s);}
track(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const raw=net.createServer(c=>{let input=Buffer.alloc(0);c.on('data',d=>{input=Buffer.concat([input,d]);if(!input.includes('\\r\\n\\r\\n'))return;c.removeAllListeners('data');const path=input.toString().split(' ')[1];let wire;
if(path==='/eof')wire=Buffer.from('HTTP/1.1 200 OK\\r\\nConnection: close\\r\\n\\r\\nclose body');
else if(path==='/early')wire=Buffer.from('HTTP/1.1 200 OK\\r\\nContent-Length: 100\\r\\nConnection: close\\r\\n\\r\\nshort');
else if(path==='/badcl')wire=Buffer.from('HTTP/1.1 200 OK\\r\\nContent-Length: 1\\r\\nContent-Length: 1\\r\\n\\r\\nx');
else if(path==='/badchunk')wire=Buffer.from('HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\nConnection: close\\r\\n\\r\\nz\\r\\nx\\r\\n');
else if(path==='/info')wire=Buffer.from('HTTP/1.1 100 Continue\\r\\n\\r\\nHTTP/1.1 103 Early Hints\\r\\nLink: </x>\\r\\n\\r\\nHTTP/1.1 200 Good\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\nok');
else wire=Buffer.concat([Buffer.from('HTTP/1.1 200 Fine\\r\\nX-Bytes: '),Buffer.from([0xe9,0x80]),Buffer.from('\\r\\nContent-Length: 4\\r\\nConnection: close\\r\\n\\r\\nbody')]);
c.write(wire.subarray(0,9));setTimeout(()=>{c.write(wire.subarray(9,33));setTimeout(()=>c.end(wire.subarray(33)),2);},2);});});track(raw);await new Promise(r=>raw.listen(0,'127.0.0.1',r));
console.log(JSON.stringify({port:server.address().port,raw:raw.address().port}));process.stdin.resume();process.stdin.on('end',()=>{for(const c of sockets)c.destroy();for(const s of servers)s.close();});`;
export async function httpService(){
    const child=spawn(process.env.NODE_COMPAT_CHILD_EXECUTABLE,['--input-type=module','-e',source],{stdio:['pipe','pipe','pipe']});
    let stderr='';child.stderr.on('data',c=>stderr+=c);const closed=new Promise(resolve=>child.once('close',resolve));
    const ports=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('HTTP service startup: '+stderr)),15000);child.once('error',reject);child.stdout.on('data',c=>{text+=c;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.split('\n',1)[0]));}});});
    return {...ports,async close(){child.stdin.end();await closed;}};
}
