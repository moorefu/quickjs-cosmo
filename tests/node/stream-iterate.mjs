import {Readable,PassThrough,Writable} from 'node:stream';
import sp from 'node:stream/promises';
import assert from 'node:assert/strict';
const output={},sleep=()=>new Promise(resolve=>setTimeout(resolve,2));
for(const [encoding,hex] of [['utf8','efbbbf41e4b8adf09f988042e282'],['utf16le','41003dd800de2d4e3dd8'],['base64','01020304050607'],['base64url','fbffff01'],['latin1','8081ff'],['ascii','8081ff'],['hex','0102ff']]) {
    const r=new Readable({read(){}}).setEncoding(encoding),text=[];
    const done=(async()=>{for await(const value of r)text.push(value);})();
    const bytes=Buffer.from(hex,'hex');for(const byte of bytes){r.push(Buffer.from([byte]));await sleep();}r.push(null);await done;output[encoding]=text.join('');
}
{
    const r=new Readable({read(){}});r.push(Buffer.from('e4b8','hex'));r.setEncoding('utf8');r.push(Buffer.from('ad','hex'));r.push(null);output.buffered='';for await(const value of r)output.buffered+=value;
    const values=[];for await(const value of Readable.from([Promise.resolve(1),2,3]))values.push(value);output.from=values;
    async function* generate(){try{yield 'a';yield 'b';yield 'c';}finally{output.returned=true;}}
    const source=Readable.from(generate(),{highWaterMark:1});for await(const value of source){output.first=value;break;}output.break=[source.destroyed,source.closed,source.errored?.code??null];
    const keep=Readable.from([1,2,3],{highWaterMark:1});for await(const value of keep.iterator({destroyOnReturn:false})){output.keptFirst=value;break;}output.keptDestroyed=keep.destroyed;output.kept=[];for await(const value of keep)output.kept.push(value);
}
{
    async function* bad(){yield 1;throw new Error('iterator-failure');}
    const r=Readable.from(bad());try{for await(const value of r){} }catch(e){output.iteratorFailure=e.message;}
    const nulls=Readable.from([null]);try{for await(const value of nulls){} }catch(e){output.nullValue=e.code;}
}
{
    const r=Readable.from(['z']);const p=sp.finished(r,{cleanup:true});r.resume();await p;output.listenerCleanup=['end','finish','error','close'].map(name=>r.listenerCount(name));
    const p2=new PassThrough();p2.on('error',()=>{});await p2[Symbol.asyncDispose]();output.disposed=[p2.destroyed,p2.closed,p2.errored?.code??null];
    const objects=[];await sp.pipeline([Readable.from([1,2]),new Writable({objectMode:true,write(c,e,cb){objects.push(c);cb();}})]);output.arrayPipeline=objects;
}
assert.equal(JSON.stringify(output.from),'[1,2,3]');assert.equal(output.utf8,'\ufeffA中😀B\ufffd');
console.log('NODE_COMPAT_RESULT '+JSON.stringify(output));
