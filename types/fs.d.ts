declare module 'node:fs' {
    import type { Buffer, BufferEncoding } from 'node:buffer';
    /** Requires a host URL constructor until the URL milestone. */
    export interface FileURLPath { readonly href: string; readonly protocol: string; readonly hostname: string; readonly pathname: string; }
    export type PathLike = string | Uint8Array | FileURLPath;
    export interface StatsBase<T extends number | bigint> {
        dev:T; ino:T; mode:T; nlink:T; uid:T; gid:T; rdev:T; size:T; blksize:T; blocks:T;
        atimeMs:T; mtimeMs:T; ctimeMs:T; birthtimeMs:T;
        atime:Date; mtime:Date; ctime:Date; birthtime:Date;
        isFile():boolean; isDirectory():boolean; isBlockDevice():boolean; isCharacterDevice():boolean;
        isSymbolicLink():boolean; isFIFO():boolean; isSocket():boolean;
    }
    export interface Stats extends StatsBase<number> {}
    export interface BigIntStats extends StatsBase<bigint> { atimeNs:bigint; mtimeNs:bigint; ctimeNs:bigint; birthtimeNs:bigint; }
    export const Stats: { new(...values: (number | undefined)[]): Stats; prototype: Stats; };
    export class Dirent<T extends string | Buffer = string> {
        constructor(name:T,type:number,parentPath:string|Uint8Array);
        name:T; parentPath:string|Uint8Array; readonly path:string|Uint8Array;
        isFile():boolean; isDirectory():boolean; isBlockDevice():boolean; isCharacterDevice():boolean;
        isSymbolicLink():boolean; isFIFO():boolean; isSocket():boolean;
    }
    export const constants: Readonly<{
        O_RDONLY:number; O_WRONLY:number; O_RDWR:number; O_CREAT:number; O_EXCL:number; O_TRUNC:number; O_APPEND:number;
        O_SYNC?:number; O_DSYNC?:number; O_DIRECTORY?:number; O_NOFOLLOW?:number; O_NONBLOCK?:number; O_NOCTTY?:number;
        S_IFMT:number; S_IFREG:number; S_IFDIR:number; S_IFCHR:number; S_IFIFO:number; S_IFLNK:number;
        S_IRUSR:number; S_IWUSR:number; F_OK:number; R_OK:number; W_OK:number; X_OK:number;
        COPYFILE_EXCL:1; COPYFILE_FICLONE:2; COPYFILE_FICLONE_FORCE:4;
    }>;
    export type Mode = number | string;
    export type OpenMode = number | 'r' | 'r+' | 'rs' | 'sr' | 'rs+' | 'sr+' | 'w' | 'w+' | 'wx' | 'xw' | 'wx+' | 'xw+' |
        'a' | 'a+' | 'ax' | 'xa' | 'ax+' | 'xa+' | 'as' | 'sa' | 'as+' | 'sa+';
    export interface ReadOptions { offset?:number; length?:number; position?:number|bigint|null; }
    export interface WriteOptions { offset?:number; length?:number; position?:number|null; }
    export interface ReadFileOptions { encoding?:BufferEncoding|null; flag?:OpenMode; buffer?:ArrayBufferView|((size:number)=>ArrayBufferView); }
    export interface WriteFileOptions { encoding?:BufferEncoding|null; flag?:OpenMode; mode?:Mode; flush?:boolean; }
    export interface RmOptions { recursive?:boolean; force?:boolean; maxRetries?:number; retryDelay?:number; }
    export function openSync(path:PathLike,flags?:OpenMode,mode?:Mode):number;
    export function closeSync(fd:number):void;
    export function readSync(fd:number,buffer:ArrayBufferView,options?:ReadOptions|null):number;
    export function readSync(fd:number,buffer:ArrayBufferView,offset:number,length:number,position?:number|bigint|null):number;
    export function writeSync(fd:number,buffer:ArrayBufferView,options?:WriteOptions|null):number;
    export function writeSync(fd:number,buffer:ArrayBufferView,offset?:number|null,length?:number,position?:number|null):number;
    export function writeSync(fd:number,value:string,position?:number|null,encoding?:BufferEncoding):number;
    export function readFileSync(path:PathLike|number,options?:null|{encoding?:null;flag?:OpenMode;buffer?:ReadFileOptions['buffer']}):Buffer;
    export function readFileSync(path:PathLike|number,options:BufferEncoding|{encoding:BufferEncoding;flag?:OpenMode;buffer?:ReadFileOptions['buffer']}):string;
    export function readFileSync(path:PathLike|number,options:ReadFileOptions):Buffer|string;
    export function writeFileSync(path:PathLike|number,data:string|ArrayBufferView,options?:BufferEncoding|WriteFileOptions|null):void;
    export const appendFileSync:typeof writeFileSync;
    export function existsSync(path:PathLike):boolean;
    export function accessSync(path:PathLike,mode?:number):void;
    export function statSync(path:PathLike,options?:{bigint?:false;throwIfNoEntry?:true}):Stats;
    export function statSync(path:PathLike,options:{bigint:true;throwIfNoEntry?:true}):BigIntStats;
    export function statSync(path:PathLike,options:{bigint?:false;throwIfNoEntry:false}):Stats|undefined;
    export function statSync(path:PathLike,options:{bigint:true;throwIfNoEntry:false}):BigIntStats|undefined;
    export const lstatSync:typeof statSync;
    export function fstatSync(fd:number,options?:{bigint?:false}):Stats;
    export function fstatSync(fd:number,options:{bigint:true}):BigIntStats;
    export function mkdirSync(path:PathLike,options:Mode|{mode?:Mode;recursive?:false}):void;
    export function mkdirSync(path:PathLike):void;
    export function mkdirSync(path:PathLike,options:{mode?:Mode;recursive:true}):string|undefined;
    export function readdirSync(path:PathLike,options?:BufferEncoding|{encoding?:BufferEncoding;recursive?:boolean;withFileTypes?:false}|null):string[];
    export function readdirSync(path:PathLike,options:'buffer'|{encoding:'buffer';recursive?:boolean;withFileTypes?:false}):Buffer[];
    export function readdirSync(path:PathLike,options:{encoding?:BufferEncoding;recursive?:boolean;withFileTypes:true}):Dirent[];
    export function readdirSync(path:PathLike,options:{encoding:'buffer';recursive?:boolean;withFileTypes:true}):Dirent<Buffer>[];
    export function renameSync(oldPath:PathLike,newPath:PathLike):void;
    export function unlinkSync(path:PathLike):void;
    export function rmdirSync(path:PathLike,options?:Omit<RmOptions,'force'>):void;
    export function rmSync(path:PathLike,options?:RmOptions):void;
    export function copyFileSync(source:PathLike,destination:PathLike,mode?:number):void;
    export function realpathSync(path:PathLike,options?:BufferEncoding|{encoding?:BufferEncoding}|null):string;
    export function realpathSync(path:PathLike,options:'buffer'|{encoding:'buffer'}):Buffer;
    export namespace realpathSync { const native:typeof realpathSync; }
    export function mkdtempSync(prefix:PathLike,options?:BufferEncoding|{encoding?:BufferEncoding}|null):string;
    export function mkdtempSync(prefix:PathLike,options:'buffer'|{encoding:'buffer'}):Buffer;
    export function ftruncateSync(fd:number,length?:number):void;
    export function fsyncSync(fd:number):void;
    const fs: { constants:typeof constants; Stats:typeof Stats; Dirent:typeof Dirent;
        openSync:typeof openSync; closeSync:typeof closeSync; readSync:typeof readSync; writeSync:typeof writeSync;
        readFileSync:typeof readFileSync; writeFileSync:typeof writeFileSync; appendFileSync:typeof appendFileSync;
        existsSync:typeof existsSync; accessSync:typeof accessSync; statSync:typeof statSync; lstatSync:typeof lstatSync; fstatSync:typeof fstatSync;
        mkdirSync:typeof mkdirSync; readdirSync:typeof readdirSync; renameSync:typeof renameSync; unlinkSync:typeof unlinkSync;
        rmdirSync:typeof rmdirSync; rmSync:typeof rmSync; copyFileSync:typeof copyFileSync; realpathSync:typeof realpathSync;
        mkdtempSync:typeof mkdtempSync; ftruncateSync:typeof ftruncateSync; fsyncSync:typeof fsyncSync; };
    export default fs;
}
declare module 'fs' { export * from 'node:fs'; export {default} from 'node:fs'; }
