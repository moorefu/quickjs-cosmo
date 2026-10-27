import './node/fs.mjs';
import './node/fs-overloads.mjs';
import fs from 'node:fs';
import path from 'node:path';
import * as os from 'os';
import * as std from 'std';
import assert from 'node:assert/strict';
const cwd=process.cwd(),root=fs.mkdtempSync(path.join(cwd,'.fs-worker-'));
assert.equal(path.dirname(root),cwd);
const worker=new os.Worker('./fixtures/fs-worker.mjs');
const timeout=os.setTimeout(()=>std.exit(1),10000);
try {
    const result=await new Promise(resolve=>{worker.onmessage=({data})=>resolve(data);worker.postMessage({directory:root});});
    worker.onmessage=null;
    assert.equal(result.data,'000102ff'); assert.equal(result.size,'4'); assert.equal(result.type,'bigint'); assert(result.dirent);
    assert.equal(fs.readFileSync(path.join(root,'worker 中文 😀')).toString('hex'),'000102ff');
} finally {
    worker.onmessage=null; os.clearTimeout(timeout);
    assert.equal(path.dirname(root),cwd); fs.rmSync(root,{recursive:true,force:true});
}
console.log('PASS runtime-fs');
