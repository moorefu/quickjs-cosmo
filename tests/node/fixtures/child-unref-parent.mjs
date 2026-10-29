import {spawn} from 'node:child_process';
import fs from 'node:fs';
const executable=process.env.NODE_COMPAT_CHILD_EXECUTABLE,fixture=process.env.QJS_UNREF_SCRIPT,marker=process.env.QJS_UNREF_MARKER;
const child=spawn(executable,[fixture,'unref-marker',marker],{stdio:'ignore',windowsHide:true});
child.on('error',error=>{console.error(error.code,error.message);process.exitCode=1;});child.unref();
const deadline=Date.now()+10000;
while(!fs.existsSync(marker+'.ready')) {
    if(process.exitCode||Date.now()>deadline)throw Error('unref child did not become ready');
    await new Promise(resolve=>setTimeout(resolve,20));
}
