import c from 'node:crypto';
import {promisify} from 'node:util';
import * as os from 'os';
os.Worker.parent.onmessage=async({data})=>{
    let result;
    try{
        const pair=c.generateKeyPairSync('ed25519'),signature=await promisify(c.sign)(null,data,pair.privateKey);
        const verified=await promisify(c.verify)(null,data,pair.publicKey,signature);
        const key=c.createSecretKey(c.randomBytes(32)),iv=c.randomBytes(12),cipher=c.createCipheriv('chacha20-poly1305',key,iv);
        const encrypted=Buffer.concat([cipher.update(data),cipher.final()]),tag=cipher.getAuthTag();
        const decipher=c.createDecipheriv('chacha20-poly1305',key,iv);decipher.setAuthTag(tag);
        const text=Buffer.concat([decipher.update(encrypted),decipher.final()]).toString();
        let missingTag=false;try{c.createDecipheriv('chacha20-poly1305',key,iv).final();}catch{missingTag=true;}
        result={text,verified,missingTag};
    }catch(e){result={error:e.stack??String(e)};}
    os.Worker.parent.onmessage=null;os.Worker.parent.postMessage(result);
};
