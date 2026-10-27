import * as os from 'os';
import crypto from 'node:crypto';
import {blake2b256} from 'cosmo:crypto';
const parent=os.Worker.parent;
parent.onmessage=({data})=>{
    parent.postMessage({hash:crypto.createHash('sha256').update(data.input).digest('hex'),
        blake:blake2b256(data.input).toString('hex'),random:crypto.randomBytes(17).length});
    parent.onmessage=null;
};
