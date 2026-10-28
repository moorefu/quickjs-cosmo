import net from 'node:net';import bareNet from 'net';
import dns from 'node:dns';import bareDNS from 'dns';import dp from 'node:dns/promises';
import url from 'node:url';import bareURL from 'url';
import fs from 'node:fs';import fsp from 'node:fs/promises';
import assert from 'node:assert/strict';import * as os from 'os';
const port=Number(process.env.NODE_COMPAT_NETWORK_PORT);assert(port>0);
if(process.argv.includes('unref')){
    const socket=net.connect({host:'127.0.0.1',port});socket.on('error',()=>{});
    socket.on('connect',()=>{socket.unref();console.log('PASS network-unref');});
}else{
    assert.equal(net,bareNet);assert.equal(dns,bareDNS);assert.equal(dns.promises,dp);assert.equal(url,bareURL);
    assert.equal((await import('node:net')).default,net);assert.equal((await import('node:dns/promises')).default,dp);
    assert.equal(url.URL,URL);assert.equal(url.URLSearchParams,URLSearchParams);
    const host=await dp.lookup('localhost',{family:4});assert.equal(host.family,4);
    const socket=net.connect({host:host.address,port}),parts=[];
    socket.on('data',chunk=>parts.push(chunk));
    await new Promise((resolve,reject)=>{socket.once('error',reject);socket.once('connect',()=>socket.end('source/qjsc 网络'));socket.once('close',resolve);});
    assert.equal(Buffer.concat(parts).toString(),'source/qjsc 网络');
    const filename=process.cwd()+'/.network-url-中文-#%.txt',file=url.pathToFileURL(filename);
    try{fs.writeFileSync(file,'file URL');assert.equal(await fsp.readFile(file,'utf8'),'file URL');await fsp.writeFile(file,'async URL');assert.equal(fs.readFileSync(file,'utf8'),'async URL');}
    finally{if(fs.existsSync(file))fs.unlinkSync(file);}
    const worker=new os.Worker('./fixtures/network-worker.mjs');
    const message=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('network Worker timeout')),15000);worker.onmessage=({data})=>{clearTimeout(timer);worker.onmessage=null;resolve(data);};worker.postMessage(port);});
    assert.equal(message.error,undefined);assert.equal(message.echo,'worker 网络');assert.equal(message.url,'http://example.com/worker?%E4%B8%AD=%E6%96%87');
    console.log('PASS runtime-network');
}
