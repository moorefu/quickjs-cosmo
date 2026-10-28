import c from 'node:crypto';
import * as os from 'os';
os.Worker.parent.onmessage=({data})=>{
    const value=c.createHash('shake256',{outputLength:200}).update(data);
    os.Worker.parent.postMessage({shake:value.copy({outputLength:200}).digest('hex'),blake:c.hash('blake2s256',data)});
    os.Worker.parent.onmessage=null;
};
