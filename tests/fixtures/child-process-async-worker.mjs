import {exec,ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import * as os from 'os';
os.Worker.parent.onmessage=async()=>{const promise=promisify(exec)('echo runtime-child-worker',{windowsHide:true});const result=await promise;os.Worker.parent.onmessage=null;os.Worker.parent.postMessage({text:result.stdout.trim(),child:promise.child instanceof ChildProcess});};
