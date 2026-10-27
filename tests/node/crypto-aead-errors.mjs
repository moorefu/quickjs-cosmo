import c from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {check,result,errorOf} from './fixtures/result.mjs';
const output={},make=options=>c.createCipheriv('aes-128-gcm',Buffer.alloc(16),Buffer.alloc(12),options);
output.parameters={algorithm:errorOf(()=>c.createCipheriv(1,Buffer.alloc(16),Buffer.alloc(12))),unknown:errorOf(()=>c.createCipheriv('unknown-cipher',Buffer.alloc(16),Buffer.alloc(12))),keyLength:errorOf(()=>c.createCipheriv('aes-128-gcm',Buffer.alloc(15),Buffer.alloc(12))),ivLength:errorOf(()=>c.createCipheriv('aes-128-gcm',Buffer.alloc(16),Buffer.alloc(0))),chachaIV:errorOf(()=>c.createCipheriv('chacha20-poly1305',Buffer.alloc(32),Buffer.alloc(11))),tagLength:errorOf(()=>make({authTagLength:5})),tagOption:errorOf(()=>make({authTagLength:'16'}))};
const cipher=make();
output.tagBefore=errorOf(()=>cipher.getAuthTag());cipher.update(Buffer.alloc(0));output.emptyAAD=cipher.setAAD(Buffer.from('aad'))===cipher;cipher.update('data');
output.lateAAD=errorOf(()=>cipher.setAAD(Buffer.from('later')));cipher.final();
output.finalTwice=errorOf(()=>cipher.final());output.updateAfter=errorOf(()=>cipher.update('later'));output.paddingAfter=errorOf(()=>cipher.setAutoPadding(false));
{
    const encoded=make();encoded.update('a','utf8','base64');output.encodingChange=errorOf(()=>encoded.update('b','utf8','hex'));
    output.encodingInvalid=errorOf(()=>make().update('data','utf8','invalid'));output.oddHex=errorOf(()=>make().update('a','hex'));
}
for(const name of ['aes-128-gcm','chacha20-poly1305']){
    const key=Buffer.alloc(name.startsWith('aes')?16:32),iv=Buffer.alloc(12),enc=c.createCipheriv(name,key,iv),data=Buffer.from('authenticated text');
    const ciphertext=Buffer.concat([enc.update(data),enc.final()]),tag=enc.getAuthTag();
    // The pinned Node/OpenSSL ChaCha baseline accepts a missing tag (upstream
    // openssl/openssl#31285). Our stricter case has a separate runtime test.
    if(name!=='chacha20-poly1305'){const missing=c.createDecipheriv(name,key,iv);missing.update(ciphertext);output[name+'Missing']=errorOf(()=>missing.final());}
    const bad=c.createDecipheriv(name,key,iv),wrong=Buffer.from(tag);wrong[0]^=1;bad.setAuthTag(wrong);
    output[name+'UnverifiedOutput']=bad.update(ciphertext).equals(data);output[name+'Authentication']=errorOf(()=>bad.final());
    const duplicate=c.createDecipheriv(name,key,iv);duplicate.setAuthTag(tag);output[name+'DoubleTag']=errorOf(()=>duplicate.setAuthTag(tag));
    output[name+'ShortTag']=errorOf(()=>c.createDecipheriv(name,key,iv).setAuthTag(Buffer.alloc(1)));
    const supplied=Buffer.from(tag),snapshot=c.createDecipheriv(name,key,iv);snapshot.setAuthTag(supplied);supplied.fill(0);output[name+'TagSnapshot']=Buffer.concat([snapshot.update(ciphertext),snapshot.final()]).equals(data);
    const stream=c.createDecipheriv(name,key,iv),parts=[];stream.setAuthTag(wrong);
    try{await pipeline(Readable.from([ciphertext]),stream,new Writable({write(chunk,encoding,cb){parts.push(chunk);cb();}}));output[name+'StreamFailure']=false;}catch(e){output[name+'StreamFailure']=[e.code??null,stream.closed];}
    const manual=c.createCipheriv(name,key,iv);manual.destroy();output[name+'ManualAfterDestroy']=manual.update('still valid').length;manual.final();
}
const pair=c.generateKeyPairSync('x25519'),zero=c.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b656e032100','hex'),Buffer.alloc(32)]),format:'der',type:'spki'});
output.lowOrder=errorOf(()=>c.diffieHellman({privateKey:pair.privateKey,publicKey:zero}));
const ed=c.generateKeyPairSync('ed25519');output.signPublic=errorOf(()=>c.sign(null,'data',ed.publicKey));
output.secretCipher=errorOf(()=>c.createCipheriv('aes-128-gcm',ed.privateKey,Buffer.alloc(12)));
check(output.emptyAAD===true,'empty update must preserve AAD state');
result(output);
