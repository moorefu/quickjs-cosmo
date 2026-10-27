import fs, {type Stats, type BigIntStats, type Dirent} from 'node:fs';
import {readFileSync} from 'fs';
const fd:number=fs.openSync('file','r+','666');
const data:Buffer=readFileSync('file');
const text:string=fs.readFileSync('file','utf8');
const big:BigIntStats=fs.statSync('file',{bigint:true});
const absent:Stats|undefined=fs.lstatSync('file',{throwIfNoEntry:false});
const count:number=fs.readSync(fd,new DataView(new ArrayBuffer(8)),{position:2n**32n,length:1});
const entries:Dirent<Buffer>[]=fs.readdirSync('dir',{encoding:'buffer',withFileTypes:true});
const first:string|undefined=fs.mkdirSync('a/b',{recursive:true});
fs.writeFileSync(fd,new Uint16Array([1,2]),{flush:true}); fs.fsyncSync(fd);fs.closeSync(fd);
void [data,text,big,absent,count,entries,first];
// @ts-expect-error String paths reject numeric values.
fs.accessSync(1);
// @ts-expect-error Read destinations must be views.
fs.readSync(fd,new ArrayBuffer(4));
fs.promises.readFile('file');
// @ts-expect-error Stats uses bigint only on request.
const wrong:bigint=fs.statSync('file').size;
