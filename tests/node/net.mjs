import net from 'node:net';
import {spawn} from 'node:child_process';
import {check,result,errorOf} from './fixtures/result.mjs';
const source=`import net from 'node:net';
const sockets=new Set(),servers=[];
function server(host,action){return new Promise((resolve,reject)=>{const s=net.createServer({allowHalfOpen:true},c=>{sockets.add(c);c.on('error',()=>{});c.on('close',()=>sockets.delete(c));if(action==='echo'){c.on('data',d=>c.write(d));c.on('end',()=>c.end());}});s.once('error',reject);s.listen(0,host,()=>{servers.push(s);resolve(s.address().port);});});}
const port4=await server('127.0.0.1','echo'),idle=await server('127.0.0.1','idle');let port6=null;try{port6=await server('::1','echo');}catch{}
const temporary=net.createServer();await new Promise(r=>temporary.listen(0,'127.0.0.1',r));const refused=temporary.address().port;await new Promise(r=>temporary.close(r));
console.log(JSON.stringify({port4,port6,idle,refused}));process.stdin.resume();process.stdin.on('end',()=>{for(const c of sockets)c.destroy();for(const s of servers)s.close();});`;
const server=spawn(process.env.NODE_COMPAT_CHILD_EXECUTABLE,['--input-type=module','-e',source],{stdio:['pipe','pipe','pipe']});
let stderr='';server.stderr.on('data',chunk=>stderr+=chunk);
const closed=new Promise(resolve=>server.once('close',resolve));
try{
    const ports=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('server startup timeout '+stderr)),15000);server.once('error',reject);server.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.split('\n')[0]));}});});
    const output={ip:['127.0.0.1','127.1','01.2.3.4','::1','::ffff:192.0.2.1','::ffff:01.2.3.4','fe80::1%eth0','bad'].map(x=>[net.isIP(x),net.isIPv4(x),net.isIPv6(x)])};
    const defaults=[net.getDefaultAutoSelectFamily(),net.getDefaultAutoSelectFamilyAttemptTimeout()];net.setDefaultAutoSelectFamily(false);net.setDefaultAutoSelectFamilyAttemptTimeout(12);output.defaults=[net.getDefaultAutoSelectFamily(),net.getDefaultAutoSelectFamilyAttemptTimeout()];net.setDefaultAutoSelectFamily(defaults[0]);net.setDefaultAutoSelectFamilyAttemptTimeout(defaults[1]);
    for(const [name,host,port] of [['ipv4','127.0.0.1',ports.port4],['ipv6','::1',ports.port6]]){
        check(port!==null,'required loopback family '+name);
        const socket=net.createConnection({host,port,autoSelectFamily:false}),events=[],chunks=[];
        const payload=Buffer.from('TCP 中文😀\0'.repeat(90));
        socket.setNoDelay(true).setKeepAlive(true);socket.on('data',chunk=>chunks.push(chunk));
        for(const event of ['connect','ready','finish','end'])socket.on(event,()=>events.push(event));
        let endpoint;socket.once('connect',()=>{endpoint=[socket.remoteAddress===host,socket.remotePort===port,socket.localPort>0,socket.address().port===socket.localPort,socket.remoteFamily,socket.readyState];});
        await new Promise((resolve,reject)=>{socket.once('error',reject);socket.once('close',hadError=>{events.push(['close',hadError]);resolve();});socket.end(payload);});
        check(Buffer.concat(chunks).equals(payload),'TCP echo '+name);
        output[name]=[events,endpoint,socket.bytesRead,socket.bytesWritten,socket.destroyed,socket.connecting];
    }
    output.refused=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:ports.refused,autoSelectFamily:false});let failure;socket.on('error',e=>failure=[e.name,e.code,e.errno,e.syscall,e.address,e.port===ports.refused]);socket.on('close',hadError=>resolve([failure,hadError,socket.destroyed]));});
    output.timeout=await new Promise((resolve,reject)=>{const events=[],socket=net.connect({host:'127.0.0.1',port:ports.idle});socket.on('error',reject);socket.setTimeout(25,()=>{events.push('timeout');socket.destroy();});socket.on('close',hadError=>resolve([events,hadError]));});
    const fresh=new net.Socket();output.fresh=[fresh.pending,fresh.readyState,fresh.address(),fresh.bytesRead,fresh.bytesWritten];
    output.freshClose=await new Promise(resolve=>{fresh.on('close',hadError=>resolve([hadError,fresh.destroyed]));fresh.destroy();});
    output.validation={port:errorOf(()=>net.connect({port:-1})),host:errorOf(()=>net.connect({port:80,host:12})),nul:errorOf(()=>net.connect({port:80,host:'a\0b'}))};
    result(output);
}finally{server.stdin.end();await closed;}
