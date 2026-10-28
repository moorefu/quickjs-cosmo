import c from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {check,result,errorOf} from './fixtures/result.mjs';
import vectors from './fixtures/hash-extra-vectors.mjs';
const output={};
for(const [name,cases] of Object.entries(vectors)){
    check(c.getHashes().includes(name),'advertised '+name);
    const sizes=[];
    for(const [length,expected] of Object.entries(cases)){
        const bytes=Buffer.from(Array.from({length:Number(length)},(_,i)=>(i*131+7)&255));
        const h=c.createHash(name);for(let i=0;i<bytes.length;i+=13)h.update(bytes.subarray(i,i+13));
        if(Number(length)===8193){
            const fork=h.copy().update('tail').digest('hex');
            check(fork===c.hash(name,Buffer.concat([bytes,Buffer.from('tail')])),name+' copy after committed blocks');
        }
        check(h.digest('hex')===expected,name+' boundary '+length);
        check(c.hash(name,bytes)===expected,name+' one-shot '+length);sizes.push(Number(length));
    }
    const original=c.createHash(name).update('prefix'),copy=original.copy();
    const first=original.update('-original').digest('hex'),second=copy.update('-copy').digest('hex');
    check(first===c.hash(name,'prefix-original')&&second===c.hash(name,'prefix-copy'),name+' independent copy');
    output[name]=[sizes,cases[0],first,second];
    const parts=[];await pipeline(Readable.from(['prefix','-stream']),c.createHash(name),new Writable({write(data,encoding,cb){parts.push(Buffer.from(data));cb();}}));
    check(Buffer.concat(parts).toString('hex')===c.hash(name,'prefix-stream'),name+' Transform');
}
for(const name of ['shake128','shake256']){
    output[name+'Lengths']=[];
    for(const length of [0,1,15,16,31,32,135,136,137,167,168,169,512]){
        const h=c.createHash(name,{outputLength:length}).update('abc');
        const copy=h.copy({outputLength:length});
        const bytes=h.digest(),other=copy.digest('hex');
        check(bytes.length===length&&bytes.toString('hex')===other,'SHAKE length '+length);
        check(c.hash(name,'abc',{outputEncoding:'buffer',outputLength:length}).equals(bytes),'SHAKE hash options');
        output[name+'Lengths'].push([length,other]);
    }
    const h=c.createHash(name,{outputLength:64}).update('abc');
    output[name+'CopyDefault']=[h.copy().digest().length,h.copy({}).digest().length,h.digest().length];
}
output.validation={negative:errorOf(()=>c.createHash('shake128',{outputLength:-1})),fraction:errorOf(()=>c.createHash('shake128',{outputLength:1.5})),string:errorOf(()=>c.createHash('shake128',{outputLength:'2'})),fixed:errorOf(()=>c.createHash('sha3-256',{outputLength:31})),blake:errorOf(()=>c.createHash('blake2s256',{outputLength:16}))};
const done=c.createHash('shake256',{outputLength:0});done.digest();
output.finalized=[errorOf(()=>done.digest()),errorOf(()=>done.update('a')),errorOf(()=>done.copy())];
result(output);
