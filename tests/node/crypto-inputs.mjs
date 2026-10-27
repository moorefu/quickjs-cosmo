import {createHash,createHmac,hkdfSync,pbkdf2Sync,hash,randomFillSync,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {result} from './fixtures/result.mjs';
const outcomes={};
function record(name,call) {
    try {const value=call();outcomes[name]=Buffer.isBuffer(value)?['Buffer',value.toString('hex')]:value;}
    catch(error) {outcomes[name]={name:error.name,code:error.code??null};}
}
for(const [label,value] of Object.entries({null:null,boolean:true,number:12,object:{},symbol:Symbol(),string:'abc',
    arrayBuffer:Uint8Array.of(1,2).buffer,shared:new SharedArrayBuffer(2),view:new Uint16Array([1,2]),dataView:new DataView(Uint8Array.of(1,2,3).buffer,1,2)})) {
    record('hash-'+label,()=>createHash('sha256').update(value).digest('hex'));
    record('hmac-'+label,()=>createHmac('sha256',value).update('x').digest('hex'));
    record('kdf-'+label,()=>pbkdf2Sync(value,'s',1,4,'sha256'));
}
for (const encoding of ['hex','HEX','bogus',null,undefined,12,{},'buffer']) {
    record('encoding-'+String(encoding),()=>createHash('sha256').update('ab',encoding).digest('hex'));
}
for (const options of [null,[],1,{}, {outputEncoding:'BUFFER'}, {outputEncoding:'base64'}, {outputLength:32},
    {outputLength:0}, {outputLength:1.5}, {outputEncoding:null}, {outputEncoding:12}, {outputEncoding:'bad'}]) {
    record('oneshot-'+JSON.stringify(options),()=>hash('sha256','abc',options));
}
record('fillFractionBound',()=>randomFillSync(Buffer.alloc(2),1,1.5));
record('emptyHmac',()=>createHmac('sha256','').digest('hex'));
record('emptyCompare',()=>timingSafeEqual(new ArrayBuffer(0),new SharedArrayBuffer(0)));
const detached=new ArrayBuffer(8), view=new Uint8Array(detached); detached.transfer();
record('detachedHash',()=>createHash('sha256').update(view).digest('hex'));
record('detachedCompare',()=>timingSafeEqual(view,new Uint8Array(0)));
record('detachedKey',()=>createHmac('sha256',view).digest('hex'));
record('detachedFill',()=>randomFillSync(view)===view);
record('hkdfCap',()=>Buffer.from(hkdfSync('sha256','k','s','i',8160)).length);
result(outcomes);
