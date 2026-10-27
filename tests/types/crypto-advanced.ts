import crypto, {KeyObject, createSecretKey, generateKeyPairSync, createPrivateKey, createPublicKey,
    sign, verify, diffieHellman, createCipheriv, createDecipheriv, Cipheriv, Decipheriv} from 'node:crypto';
import {Buffer} from 'node:buffer';
const secret:KeyObject=createSecretKey(Buffer.alloc(32));
const ed=generateKeyPairSync('ed25519');
const pkcs8:Buffer=ed.privateKey.export({format:'der',type:'pkcs8'});
const spki:string=ed.publicKey.export({format:'pem',type:'spki'});
const priv=createPrivateKey({key:pkcs8,format:'der',type:'pkcs8'});
const pub=createPublicKey(spki);
const signature:Buffer=sign(null,Buffer.alloc(0),priv);
const valid:boolean=verify(undefined,Buffer.alloc(0),pub,signature);
sign(null,Buffer.alloc(0),priv,(error,result)=>{const bytes:Buffer=result;});
verify(null,Buffer.alloc(0),pub,signature,(error,result)=>{const ok:boolean=result;});
const encoded=generateKeyPairSync('x25519',{publicKeyEncoding:{format:'pem',type:'spki'},privateKeyEncoding:{format:'der',type:'pkcs8'}});
const encodedPublic:string=encoded.publicKey;
const encodedPrivate:Buffer=encoded.privateKey;
const x=generateKeyPairSync('x25519');
const shared:Buffer=diffieHellman({privateKey:x.privateKey,publicKey:x.publicKey});
diffieHellman({privateKey:x.privateKey,publicKey:x.publicKey},(error,result)=>{const bytes:Buffer=result;});
const cipher:Cipheriv=createCipheriv('aes-256-gcm',secret,Buffer.alloc(12));
cipher.setAAD(Buffer.from('metadata'));
const encrypted:Buffer=cipher.update('message');
const tail:string=cipher.final('base64');
const tag:Buffer=cipher.getAuthTag();
const decipher:Decipheriv=createDecipheriv('aes-256-gcm',secret,Buffer.alloc(12));
decipher.setAAD(Buffer.from('metadata')).setAuthTag(tag).setAutoPadding(false);
const plain:Buffer=decipher.update(encrypted);
decipher.final();
crypto.createHmac('sha256',secret).update('message').digest();
crypto.hkdfSync('sha256',secret,Buffer.alloc(0),Buffer.alloc(0),32);
crypto.hkdf('sha256',secret,Buffer.alloc(0),Buffer.alloc(0),32,(error,result)=>{});
// @ts-expect-error KeyObject is created by factory functions.
new KeyObject();
// @ts-expect-error Authentication tags are only available on encryption objects.
decipher.getAuthTag();
// @ts-expect-error This runtime exposes Ed25519 and X25519 key generation.
generateKeyPairSync('rsa');
