import tls,{TLSSocket} from 'node:tls';import {Socket} from 'node:net';
const socket:TLSSocket=tls.connect({port:443,host:'localhost',servername:'localhost',ca:[new Uint8Array(), 'PEM'],rejectUnauthorized:true,minVersion:'TLSv1.2'},()=>{});
const transport:Socket=socket;transport.end('hello');socket.getCipher()?.standardName.toUpperCase();
tls.connect(443,'localhost',{ca:'PEM'},()=>{});new TLSSocket(null,{ca:'PEM'}).connect({port:443});
// @ts-expect-error Unverified certificates are not enabled.
tls.connect({port:443,rejectUnauthorized:false});
// @ts-expect-error TLS1.3 is outside the audited client policy.
tls.connect({port:443,maxVersion:'TLSv1.3'});
// @ts-expect-error Existing socket upgrades require a separate implementation.
new TLSSocket(transport);
// @ts-expect-error Server TLS is not part of the client module.
tls.createServer();
