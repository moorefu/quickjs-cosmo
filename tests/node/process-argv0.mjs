import {argv0} from 'node:process';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {result,check} from './fixtures/result.mjs';
const target=process.env.NODE_COMPAT_CHILD_EXECUTABLE||process.execPath;
const fixture=path.resolve(path.dirname(process.argv[1]),'fixtures/child.mjs');
const descriptor=Object.getOwnPropertyDescriptor(process,'argv0');
const values=['custom','with spaces','中文','trailing\\',''];
const output=values.map(value=>{
    const child=spawnSync(target,[fixture,'argv0'],{argv0:value,encoding:'utf8',windowsHide:true,timeout:10000});
    check(child.status===0,child.stderr);
    return child.stdout===value;
});
result({same:argv0===process.argv0,descriptor:{writable:descriptor.writable,enumerable:descriptor.enumerable,configurable:descriptor.configurable},custom:output});
