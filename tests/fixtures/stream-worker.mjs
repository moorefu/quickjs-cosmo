import {Readable,Writable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import * as os from 'os';
os.Worker.parent.onmessage=async({data})=>{
    const result=[];
    await pipeline(Readable.from(data),new Transform({objectMode:true,transform(value,encoding,cb){cb(null,value*2);}}),new Writable({objectMode:true,highWaterMark:1,write(value,encoding,cb){result.push(value);setTimeout(cb,1);}}));
    os.Worker.parent.onmessage=null;os.Worker.parent.postMessage(result);
};
