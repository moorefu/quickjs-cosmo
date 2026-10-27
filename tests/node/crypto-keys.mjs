import c from 'node:crypto';
import {promisify} from 'node:util';
import {check,result,errorOf} from './fixtures/result.mjs';
const output={};
const privateKey=(algorithm,hex)=>c.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b65'+(algorithm==='ed25519'?'70':'6e')+'04220420','hex'),Buffer.from(hex,'hex')]),format:'der',type:'pkcs8'});
// RFC 8032 section 7.1, TEST 1.
const seed='9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const privateEd=privateKey('ed25519',seed),publicEd=c.createPublicKey(privateEd),signature=c.sign(null,Buffer.alloc(0),privateEd);
const expectedSignature='e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';
check(signature.toString('hex')===expectedSignature,'RFC 8032 Ed25519 signature');
output.ed25519=[publicEd.export({format:'der',type:'spki'}).subarray(-32).toString('hex'),signature.toString('hex'),c.verify(null,Buffer.alloc(0),publicEd,signature),c.verify(undefined,Buffer.alloc(0),privateEd,signature)];
output.metadata=[privateEd instanceof c.KeyObject,publicEd instanceof c.KeyObject,privateEd.type,publicEd.type,privateEd.asymmetricKeyType,privateEd.asymmetricKeyDetails,privateEd.constructor.name,publicEd.constructor.name];
const privatePem=privateEd.export({format:'pem',type:'pkcs8'}),publicPem=publicEd.export({format:'pem',type:'spki'});
output.pem=[privatePem,publicPem,c.createPrivateKey(privatePem.replace(/\n/g,'\r\n')).equals(privateEd),c.createPublicKey(publicPem).equals(publicEd),c.createPublicKey({key:privateEd.export({format:'der',type:'pkcs8'}),format:'der',type:'pkcs8'}).equals(publicEd)];
const mutable=Buffer.from('secret'),secret=c.createSecretKey(mutable);mutable.fill(0);
const exported=secret.export();exported.fill(1);
output.secret=[secret.type,secret.symmetricKeySize,secret.constructor.name,Object.prototype.toString.call(secret),secret.export().toString(),secret.equals(c.createSecretKey('secret')),secret.equals(c.createSecretKey('other')),secret.equals(privateEd)];
output.hmac=c.createHmac('sha256',secret).update('message').digest('hex');
output.hkdf=Buffer.from(c.hkdfSync('sha256',secret,'salt','info',32)).toString('hex');
output.zeroSecret=[c.createSecretKey(Buffer.alloc(0)).symmetricKeySize,c.createSecretKey(Buffer.alloc(0)).export().length];
// RFC 7748 section 6.1.
const alice=privateKey('x25519','77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
const bob=privateKey('x25519','5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
const shared=c.diffieHellman({privateKey:alice,publicKey:c.createPublicKey(bob)});
check(shared.toString('hex')==='4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742','RFC 7748 shared secret');
output.x25519=[c.createPublicKey(alice).export({format:'der',type:'spki'}).subarray(-32).toString('hex'),c.createPublicKey(bob).export({format:'der',type:'spki'}).subarray(-32).toString('hex'),shared.toString('hex'),shared.equals(c.diffieHellman({privateKey:bob,publicKey:c.createPublicKey(alice)}))];
const clamped=Buffer.from(alice.export({format:'der',type:'pkcs8'}));clamped[clamped.length-32]^=1;
output.equals=[alice.equals(c.createPrivateKey({key:clamped,format:'der',type:'pkcs8'})),alice.equals(c.createPublicKey(alice)),privateEd.equals(c.createPrivateKey(privatePem))];
for(const type of ['ed25519','x25519']){
    const pair=c.generateKeyPairSync(type);output[type+'Generation']=[pair.privateKey.type,pair.publicKey.type,pair.privateKey.asymmetricKeyType,c.createPublicKey(pair.privateKey).equals(pair.publicKey)];
}
const encoded=c.generateKeyPairSync('ed25519',{privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'der',type:'spki'}});
output.generationEncoding=[typeof encoded.privateKey,Buffer.isBuffer(encoded.publicKey),c.verify(null,'generated',c.createPublicKey({key:encoded.publicKey,format:'der',type:'spki'}),c.sign(null,'generated',encoded.privateKey))];
output.errors={publicPublic:errorOf(()=>c.createPublicKey(publicEd)),privatePrivate:errorOf(()=>c.createPrivateKey(privateEd)),wrongSecret:errorOf(()=>c.createPublicKey(secret)),rawSeed:errorOf(()=>c.createPrivateKey(Buffer.from(seed,'hex'))),digest:errorOf(()=>c.sign('sha256','x',privateEd)),constructor:errorOf(()=>new c.KeyObject())};
const signatureCopy=Buffer.from(signature);signatureCopy[0]^=1;output.tampered=c.verify(null,Buffer.alloc(0),publicEd,signatureCopy);
output.asyncSignature=(await promisify(c.sign)(null,Buffer.alloc(0),privateEd)).equals(signature);
output.asyncVerify=await promisify(c.verify)(null,Buffer.alloc(0),publicEd,signature);
output.asyncShort=await Promise.all([0,1,63,65].map(length=>promisify(c.verify)(null,'message',publicEd,Buffer.alloc(length))));
output.asyncDerive=(await promisify(c.diffieHellman)({privateKey:alice,publicKey:c.createPublicKey(bob)})).equals(shared);
let ticks=0;const timer=setInterval(()=>ticks++,1);
try{await promisify(c.sign)(null,Buffer.alloc(4*1024*1024,65),privateEd);output.nonblocking=ticks>0;}finally{clearInterval(timer);}
check(output.nonblocking,'async Ed25519 must allow timer progress');
result(output);
