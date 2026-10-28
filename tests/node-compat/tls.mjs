import tls,{connect,TLSSocket} from 'node:tls';
import {Socket} from 'node:net';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import process from 'node:process';
const mode=process.env.NODE_COMPAT_TLS_MODE??'echo',trace=[];
const options={host:process.env.NODE_COMPAT_TLS_HOST??'127.0.0.1',port:Number(process.env.NODE_COMPAT_TLS_PORT),minVersion:'TLSv1.2',maxVersion:'TLSv1.2'};
if(mode!=='untrusted')options.ca=readFileSync(process.env.NODE_COMPAT_TLS_CA);
if(!['no-sni','ipv6','wrong-ip','dns-ip','cn-ip'].includes(mode))options.servername='localhost';
const controller=new AbortController();if(mode==='abort')options.signal=controller.signal;
const data=Buffer.alloc(240123,97),hash=createHash('sha256');let bytes=0,failure=null,metadata=null,finished=false,closed=null;
await new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>reject(Error('TLS test timeout: '+trace)),10000);
    const socket=connect(options,()=>{
        trace.push('secureConnect');metadata={authorized:socket.authorized,authorizationError:socket.authorizationError,alpn:socket.alpnProtocol,protocol:socket.getProtocol(),cipher:socket.getCipher(),encrypted:socket.encrypted,reused:socket.isSessionReused(),socket:socket instanceof Socket,tlsSocket:socket instanceof TLSSocket,alias:tls.connect===connect};
        if(['echo','no-sni','ipv6'].includes(mode))socket.end(data.subarray(17));else socket.end();
    });
    socket.on('connect',()=>trace.push('connect'));
    socket.on('data',chunk=>{bytes+=chunk.length;hash.update(chunk);});
    socket.on('finish',()=>{finished=true;trace.push('finish');});socket.on('end',()=>trace.push('end'));
    socket.on('error',error=>{failure={name:error.name,code:error.code};trace.push('error');});
    socket.on('close',hadError=>{trace.push('close:'+hadError);closed={protocol:socket.getProtocol(),cipher:socket.getCipher(),authorized:socket.authorized,authorizationError:socket.authorizationError};clearTimeout(deadline);resolve();});
    if(['echo','no-sni','ipv6'].includes(mode))socket.write(data.subarray(0,17));
    if(mode==='abort')setTimeout(()=>controller.abort(),40);
    if(mode==='timeout')socket.setTimeout(40,()=>{trace.push('timeout');socket.destroy();});
});
console.log('NODE_COMPAT_RESULT '+JSON.stringify({trace,bytes,digest:hash.digest('hex'),failure,metadata,finished,closed}));
