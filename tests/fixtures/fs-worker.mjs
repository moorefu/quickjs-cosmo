import * as os from 'os';
import fs from 'node:fs';
import path from 'node:path';
const parent=os.Worker.parent;
parent.onmessage=({data})=>{
    const name=path.join(data.directory,'worker 中文 😀');
    fs.writeFileSync(name,Buffer.from([0,1,2,255]));
    const big=fs.statSync(name,{bigint:true});
    parent.postMessage({data:fs.readFileSync(name).toString('hex'),size:String(big.size),
        type:typeof big.mtimeNs,dirent:fs.readdirSync(data.directory,{withFileTypes:true}).find(d=>d.name===path.basename(name)).isFile()});
    parent.onmessage=null;
};
