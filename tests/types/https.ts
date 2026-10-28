import https from 'node:https';import type {ClientRequest,IncomingMessage} from 'node:http';
const agent=new https.Agent({ca:'PEM',keepAlive:true,maxCachedSessions:0});
const request:ClientRequest=https.get('https://localhost',{agent,ca:new Uint8Array(),servername:'localhost',minVersion:'TLSv1.2'},(response:IncomingMessage)=>response.resume());
agent.createConnection({host:'localhost',port:443}).getProtocol();request.setTimeout(1000);
// @ts-expect-error HTTPS servers are outside the admitted client subset.
https.createServer();
// @ts-expect-error Session caching has not been admitted.
new https.Agent({maxCachedSessions:10});
// @ts-expect-error Mandatory certificate verification.
https.get({rejectUnauthorized:false});
