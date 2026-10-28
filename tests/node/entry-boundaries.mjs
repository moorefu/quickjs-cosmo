import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const errors={};
for(const [key,specifier] of [['builtin','node:fs\0ignored'],['bare','fs\0ignored'],['file','./esm.mjs\0ignored']]) {
    try { await import(specifier); errors[key]='ACCEPTED'; }
    catch(error) { errors[key]={name:error.name,code:error.code}; }
}
const cwd=process.cwd();
console.log('NODE_COMPAT_RESULT '+JSON.stringify({errors,metadata:{filename:import.meta.filename===fileURLToPath(import.meta.url),dirname:import.meta.dirname===path.dirname(import.meta.filename),main:import.meta.main},realpath:{sync:fs.realpathSync(cwd)===cwd,async:await fs.promises.realpath(cwd)===cwd}}));
