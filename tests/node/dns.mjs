import dns from 'node:dns';
import promises from 'node:dns/promises';
import {promisify} from 'node:util';
import {check,result,errorOf} from './fixtures/result.mjs';
const output={constants:[dns.ADDRCONFIG,dns.ALL,dns.V4MAPPED],identity:dns.promises===promises};
for(const [host,options] of [['127.0.0.1',{}],['::1',{}],['127.0.0.1',{family:6}],['::1',{family:4}],['127.0.0.1',{all:true}],['',{family:6}],['',{all:true}]]){
    output[JSON.stringify([host,options])]=await new Promise(resolve=>dns.lookup(host,options,(error,address,family)=>resolve([error&&error.code,address,family])));
}
output.promise=await promises.lookup('127.0.0.1');
output.promisify=await promisify(dns.lookup)('::1');
let synchronous=true;output.timing=await new Promise(resolve=>{dns.lookup('127.0.0.1',()=>resolve(!synchronous));synchronous=false;});
const local=await promises.lookup('localhost',{all:true,order:'ipv4first'});
check(local.some(x=>x.family===4&&x.address==='127.0.0.1'),'localhost IPv4');
check(local.every(x=>x.family===4||x.family===6),'localhost families');
output.local=local.map(x=>[x.address,x.family]).sort();
for(const [name,operation] of Object.entries({family:()=>dns.lookup('localhost',{family:3},()=>{}),hints:()=>dns.lookup('localhost',{hints:1<<30},()=>{}),all:()=>dns.lookup('localhost',{all:1},()=>{}),order:()=>dns.lookup('localhost',{order:'random'},()=>{}),callback:()=>dns.lookup('localhost'),hostname:()=>dns.lookup({},()=>{})}))output[name]=errorOf(operation);
try{await promises.lookup('localhost\0invalid');}catch(error){output.nul=[error.name,error.code,error.errno,error.syscall,error.hostname];}
const saved=dns.getDefaultResultOrder();dns.setDefaultResultOrder('ipv6first');output.order=dns.getDefaultResultOrder();dns.setDefaultResultOrder(saved);
result(output);
