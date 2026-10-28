import {spawn} from 'node:child_process';
const source=`import net from 'node:net';
const sockets=new Set(),servers=[];
function server(host,action){return new Promise((resolve,reject)=>{const s=net.createServer({allowHalfOpen:true},c=>{
 sockets.add(c);c.on('error',()=>{});c.on('close',()=>sockets.delete(c));
 if(action==='echo'){c.on('data',d=>c.write(d));c.on('end',()=>c.end());}
 if(action==='half'){let text='';c.end('peer-finished');c.on('data',d=>text+=d);c.on('end',()=>{console.log(JSON.stringify({receipt:text}));c.destroy();});}
 if(action==='reset')c.once('data',()=>c.resetAndDestroy());
});s.once('error',reject);s.listen(0,host,()=>{servers.push(s);resolve(s.address().port);});});}
const echo=await server('127.0.0.1','echo'),idle=await server('127.0.0.1','idle'),half=await server('127.0.0.1','half'),reset=await server('127.0.0.1','reset');let ipv6=null;try{ipv6=await server('::1','echo');}catch(e){if(e.code!=='EAFNOSUPPORT'&&e.code!=='EADDRNOTAVAIL')throw e;}
console.log(JSON.stringify({echo,idle,half,reset,ipv6}));process.stdin.resume();process.stdin.on('end',()=>{for(const c of sockets)c.destroy();for(const s of servers)s.close();});`;
export async function networkService(){
    const child=spawn(process.env.NODE_COMPAT_CHILD_EXECUTABLE,['--input-type=module','-e',source],{stdio:['pipe','pipe','pipe']});
    let pending='',stderr='',ports;const receipts=[],waiters=[];
    const closed=new Promise(resolve=>child.once('close',resolve));
    const ready=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('network service startup timeout '+stderr)),20000);child.once('error',reject);
        child.stdout.on('data',chunk=>{pending+=chunk;for(;;){const newline=pending.indexOf('\n');if(newline<0)break;const value=JSON.parse(pending.slice(0,newline));pending=pending.slice(newline+1);if(value.echo){ports=value;clearTimeout(timer);resolve();}else if(value.receipt!==undefined){if(waiters.length)waiters.shift()(value.receipt);else receipts.push(value.receipt);}}});
    });
    child.stderr.on('data',chunk=>stderr+=chunk);await ready;
    return {ports,receipt:()=>receipts.length?Promise.resolve(receipts.shift()):new Promise(resolve=>waiters.push(resolve)),async close(){child.stdin.end();await closed;}};
}
