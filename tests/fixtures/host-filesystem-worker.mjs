import * as os from 'os';import {probe} from './host-filesystem-probe.mjs';
os.Worker.parent.onmessage=async({data})=>{try{os.Worker.parent.postMessage({value:await probe(data)});}catch(e){os.Worker.parent.postMessage({error:String(e.stack)});}finally{os.Worker.parent.onmessage=null;}};
