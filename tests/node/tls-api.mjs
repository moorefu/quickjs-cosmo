import tls,{connect,TLSSocket} from 'node:tls';import bare from 'tls';
import {Socket} from 'node:net';import {Duplex} from 'node:stream';
const socket=new TLSSocket(),trace=[];
const initial={alias:tls===bare&&tls.connect===connect&&tls.TLSSocket===TLSSocket,dynamic:(await import('node:tls')).default===tls,
    socket:socket instanceof Socket,duplex:socket instanceof Duplex,encrypted:socket.encrypted,authorized:socket.authorized,
    authorizationError:socket.authorizationError};
await new Promise(resolve=>{socket.on('error',error=>trace.push(error.code));socket.on('close',hadError=>{trace.push('close:'+hadError);resolve();});socket.destroy();});
console.log('NODE_COMPAT_RESULT '+JSON.stringify({initial,trace}));
