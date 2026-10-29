import { Worker } from 'os';
import { value } from '../lib/value.mjs';
import { resolve, readFileSync } from 'cosmo:bundle';
const plugin=await import('../plugins/local.mjs');
await new Promise(resolve=>setTimeout(resolve,5));
Worker.parent.onmessage=async()=>{
    Worker.parent.postMessage({value,text:await plugin.run(),url:import.meta.url,main:import.meta.main,
        bytes:[...readFileSync(resolve('../../assets/bytes.bin',import.meta.url))]});
    Worker.parent.onmessage=null;
};
