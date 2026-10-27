import c from 'node:crypto';
import {Readable,Writable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {check,result} from './fixtures/result.mjs';
const output={},names=['aes-128-gcm','aes-192-gcm','aes-256-gcm','chacha20-poly1305'];
output.ciphers=names.every(name=>c.getCiphers().includes(name));
for(const [index,name] of names.entries()){
    const key=Buffer.from(Array.from({length:[16,24,32,32][index]},(_,i)=>i)),iv=Buffer.from('000102030405060708090a0b','hex');
    const data=Buffer.from('中文😀-incremental-AEAD\0'.repeat(35)),aad=Buffer.from('associated metadata');
    const cipher=c.createCipheriv(name,c.createSecretKey(key),iv);cipher.setAAD(aad.subarray(0,3));cipher.setAAD(aad.subarray(3));
    const chunks=[];for(let offset=0;offset<data.length;offset++)chunks.push(cipher.update(data.subarray(offset,offset+1)));chunks.push(cipher.final());
    const ciphertext=Buffer.concat(chunks),tag=cipher.getAuthTag();
    const decipher=c.createDecipheriv(name,key,iv);decipher.setAAD(aad);decipher.setAuthTag(tag);
    const plain=[];for(let offset=0;offset<ciphertext.length;offset+=7)plain.push(decipher.update(ciphertext.subarray(offset,offset+7)));plain.push(decipher.final());
    check(Buffer.concat(plain).equals(data),name+' incremental roundtrip');
    const single=c.createCipheriv(name,key,iv);single.setAAD(aad);const once=Buffer.concat([single.update(data),single.final()]);
    check(once.equals(ciphertext)&&single.getAuthTag().equals(tag),name+' chunk boundaries must not change ciphertext/tag');
    output[name]=[cipher instanceof c.Cipheriv,cipher instanceof Transform,decipher instanceof c.Decipheriv,ciphertext.toString('hex'),tag.toString('hex'),cipher.getAuthTag().equals(tag)];
    const encoder=c.createCipheriv(name,key,iv),decoder=c.createDecipheriv(name,key,iv),received=[];
    encoder.setAAD(aad);decoder.setAAD(aad);encoder.once('end',()=>decoder.setAuthTag(encoder.getAuthTag()));
    await pipeline(Readable.from([data.subarray(0,11),data.subarray(11)]),encoder,decoder,new Writable({write(chunk,encoding,cb){received.push(Buffer.from(chunk));cb();}}));
    output[name+'Stream']=Buffer.concat(received).equals(data);
}
// NIST SP 800-38D common zero-key/zero-IV test vectors.
for(const data of [Buffer.alloc(0),Buffer.alloc(16)]){
    const cipher=c.createCipheriv('aes-128-gcm',Buffer.alloc(16),Buffer.alloc(12));
    const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);
    output['zero'+data.length]=[encrypted.toString('hex'),cipher.getAuthTag().toString('hex')];
}
check(output.zero0[1]==='58e2fccefa7e3061367f1d57a4e7455a','AES-GCM empty vector');
check(output.zero16[0]==='0388dace60b6a392f328c2b971b2fe78'&&output.zero16[1]==='ab6e47d42cec13bdf53a67b21257bddf','AES-GCM block vector');
// RFC 8439 section 2.8.2, independent of the Node oracle.
{
    const key=Buffer.from(Array.from({length:32},(_,i)=>0x80+i)),iv=Buffer.from('070000004041424344454647','hex');
    const cipher=c.createCipheriv('chacha20-poly1305',key,iv);
    cipher.setAAD(Buffer.from('50515253c0c1c2c3c4c5c6c7','hex'));
    const input=Buffer.from('4c616469657320616e642047656e746c656d656e206f662074686520636c617373206f66202739393a204966204920636f756c64206f6666657220796f75206f6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73637265656e20776f756c642062652069742e','hex');
    const ciphertext=Buffer.concat([cipher.update(input.subarray(0,17)),cipher.update(input.subarray(17)),cipher.final()]);
    check(ciphertext.toString('hex')==='d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116','RFC 8439 ciphertext');
    check(cipher.getAuthTag().toString('hex')==='1ae10b594f09e26a7e902ecbd0600691','RFC 8439 tag');
    output.rfc8439=true;
}
for(const size of [1,8,16,32]){
    const cipher=c.createCipheriv('aes-128-gcm',Buffer.alloc(16),Buffer.alloc(size,1));cipher.update('iv length');cipher.final();output['iv'+size]=cipher.getAuthTag().toString('hex');
}
for(const [name,length] of [['aes-128-gcm',4],['aes-128-gcm',8],['aes-128-gcm',12],['chacha20-poly1305',1],['chacha20-poly1305',8]]){
    const key=Buffer.alloc(name.startsWith('aes')?16:32),iv=Buffer.alloc(12),cipher=c.createCipheriv(name,key,iv,{authTagLength:length});
    const encrypted=Buffer.concat([cipher.update('tag length'),cipher.final()]),tag=cipher.getAuthTag();
    const decipher=c.createDecipheriv(name,key,iv,{authTagLength:length});decipher.setAuthTag(tag);
    output[name+length]=[tag.toString('hex'),Buffer.concat([decipher.update(encrypted),decipher.final()]).toString()];
}
for(const encoding of ['hex','base64','base64url','utf8','utf16le']){
    const cipher=c.createCipheriv('aes-128-gcm',Buffer.alloc(16),Buffer.alloc(12)),parts=[];
    for(const value of ['a','中文','😀','final'])parts.push(cipher.update(value,'utf8',encoding));parts.push(cipher.final(encoding));output['encoding-'+encoding]=parts.join('');
}
result(output);
