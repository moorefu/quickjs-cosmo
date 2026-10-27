declare module 'node:fs' {
    import type {Buffer,BufferEncoding} from 'node:buffer';
    export interface ErrnoException extends Error {code?:string;errno?:number;syscall?:string;path?:string;dest?:string;}
    export type NoParamCallback=(error:ErrnoException|null)=>void;
    export type ValueCallback<T>=(error:ErrnoException|null,value:T)=>void;
    export interface AsyncReadFileOptions {encoding?:BufferEncoding|null;flag?:OpenMode;signal?:AbortSignal;}
    export interface AsyncWriteFileOptions extends WriteFileOptions {signal?:AbortSignal;}
    export interface StatOptions {bigint?:boolean;}
    export interface MkdirOptions {recursive?:boolean;mode?:Mode;}
    export interface ReaddirOptions {encoding?:BufferEncoding|'buffer';withFileTypes?:boolean;recursive?:boolean;}
    export interface AsyncReadOptions extends ReadOptions {buffer?:ArrayBufferView;}
    export interface ReadResult<T extends ArrayBufferView=Buffer> {bytesRead:number;buffer:T;}
    export interface WriteResult<T extends ArrayBufferView|string=Buffer> {bytesWritten:number;buffer:T;}
    export function open(path:PathLike,flags:OpenMode,callback:ValueCallback<number>):void;
    export function open(path:PathLike,flags:OpenMode,mode:Mode,callback:ValueCallback<number>):void;
    export function close(fd:number,callback:NoParamCallback):void;
    export function read<T extends ArrayBufferView>(fd:number,buffer:T,callback:(error:ErrnoException|null,bytesRead:number,buffer:T)=>void):void;
    export function read<T extends ArrayBufferView>(fd:number,buffer:T,options:ReadOptions,callback:(error:ErrnoException|null,bytesRead:number,buffer:T)=>void):void;
    export function read<T extends ArrayBufferView>(fd:number,buffer:T,offset:number,length:number,position:number|bigint|null,callback:(error:ErrnoException|null,bytesRead:number,buffer:T)=>void):void;
    export function read<T extends ArrayBufferView>(fd:number,buffer:T,offset:number,length:number,callback:(error:ErrnoException|null,bytesRead:number,buffer:T)=>void):void;
    export function read(fd:number,options:AsyncReadOptions,callback:(error:ErrnoException|null,bytesRead:number,buffer:ArrayBufferView)=>void):void;
    export function read(fd:number,callback:(error:ErrnoException|null,bytesRead:number,buffer:Buffer)=>void):void;
    export function write<T extends ArrayBufferView>(fd:number,buffer:T,callback:(error:ErrnoException|null,bytesWritten:number,buffer:T)=>void):void;
    export function write<T extends ArrayBufferView>(fd:number,buffer:T,options:WriteOptions,callback:(error:ErrnoException|null,bytesWritten:number,buffer:T)=>void):void;
    export function write<T extends ArrayBufferView>(fd:number,buffer:T,offset:number,length:number,position:number|null,callback:(error:ErrnoException|null,bytesWritten:number,buffer:T)=>void):void;
    export function write<T extends ArrayBufferView>(fd:number,buffer:T,offset:number,length:number,callback:(error:ErrnoException|null,bytesWritten:number,buffer:T)=>void):void;
    export function write(fd:number,buffer:string,callback:(error:ErrnoException|null,bytesWritten:number,buffer:string)=>void):void;
    export function write(fd:number,buffer:string,position:number|null,encoding:BufferEncoding,callback:(error:ErrnoException|null,bytesWritten:number,buffer:string)=>void):void;
    export function readFile(path:PathLike|number,callback:ValueCallback<Buffer>):void;
    export function readFile(path:PathLike|number,options:BufferEncoding|{encoding:BufferEncoding;flag?:OpenMode;signal?:AbortSignal},callback:ValueCallback<string>):void;
    export function readFile(path:PathLike|number,options:{encoding?:null;flag?:OpenMode;signal?:AbortSignal}|null,callback:ValueCallback<Buffer>):void;
    export function readFile(path:PathLike|number,options:BufferEncoding|AsyncReadFileOptions|null,callback:ValueCallback<Buffer|string>):void;
    export function writeFile(path:PathLike|number,data:string|ArrayBufferView,callback:NoParamCallback):void;
    export function writeFile(path:PathLike|number,data:string|ArrayBufferView,options:BufferEncoding|AsyncWriteFileOptions|null,callback:NoParamCallback):void;
    export const appendFile:typeof writeFile;
    export function access(path:PathLike,callback:NoParamCallback):void;
    export function access(path:PathLike,mode:number,callback:NoParamCallback):void;
    export function stat(path:PathLike,callback:ValueCallback<Stats>):void;
    export function stat(path:PathLike,options:{bigint:true},callback:ValueCallback<BigIntStats>):void;
    export function stat(path:PathLike,options:{bigint?:false},callback:ValueCallback<Stats>):void;
    export const lstat:typeof stat;
    export function fstat(fd:number,callback:ValueCallback<Stats>):void;
    export function fstat(fd:number,options:{bigint:true},callback:ValueCallback<BigIntStats>):void;
    export function fstat(fd:number,options:{bigint?:false},callback:ValueCallback<Stats>):void;
    export function mkdir(path:PathLike,callback:ValueCallback<string|undefined>):void;
    export function mkdir(path:PathLike,options:Mode|MkdirOptions,callback:ValueCallback<string|undefined>):void;
    export function readdir(path:PathLike,callback:ValueCallback<string[]>):void;
    export function readdir(path:PathLike,options:BufferEncoding|'buffer'|ReaddirOptions|null,callback:ValueCallback<string[]|Buffer[]|Dirent<string|Buffer>[]>):void;
    export function rename(oldPath:PathLike,newPath:PathLike,callback:NoParamCallback):void;
    export function unlink(path:PathLike,callback:NoParamCallback):void;
    export function rm(path:PathLike,callback:NoParamCallback):void;
    export function rm(path:PathLike,options:RmOptions,callback:NoParamCallback):void;
    export const rmdir:typeof rm;
    export function realpath(path:PathLike,callback:ValueCallback<string>):void;
    export function realpath(path:PathLike,options:BufferEncoding|'buffer'|{encoding?:BufferEncoding|'buffer'},callback:ValueCallback<string|Buffer>):void;
    export namespace realpath {const native:typeof realpath;}
    export function mkdtemp(prefix:PathLike,callback:ValueCallback<string>):void;
    export function mkdtemp(prefix:PathLike,options:BufferEncoding|'buffer'|{encoding?:BufferEncoding|'buffer'},callback:ValueCallback<string|Buffer>):void;
    export function copyFile(source:PathLike,destination:PathLike,callback:NoParamCallback):void;
    export function copyFile(source:PathLike,destination:PathLike,mode:number,callback:NoParamCallback):void;
    export function ftruncate(fd:number,callback:NoParamCallback):void;
    export function ftruncate(fd:number,length:number,callback:NoParamCallback):void;
    export function fsync(fd:number,callback:NoParamCallback):void;
    export const promises:typeof import('node:fs/promises');
    export interface AsyncFsMethods {
        promises:typeof promises;readFile:typeof readFile;writeFile:typeof writeFile;appendFile:typeof appendFile;
        open:typeof open;close:typeof close;read:typeof read;write:typeof write;access:typeof access;
        stat:typeof stat;lstat:typeof lstat;fstat:typeof fstat;mkdir:typeof mkdir;readdir:typeof readdir;
        rename:typeof rename;unlink:typeof unlink;rm:typeof rm;rmdir:typeof rmdir;realpath:typeof realpath;
        copyFile:typeof copyFile;mkdtemp:typeof mkdtemp;ftruncate:typeof ftruncate;fsync:typeof fsync;
    }
}
declare module 'node:fs/promises' {
    import type {Buffer,BufferEncoding} from 'node:buffer';
    import type {PathLike,OpenMode,Mode,Stats,BigIntStats,AsyncReadFileOptions,AsyncWriteFileOptions,
        ReadOptions,WriteOptions,AsyncReadOptions,ReadResult,WriteResult,MkdirOptions,ReaddirOptions,Dirent,RmOptions} from 'node:fs';
    export interface FileHandle {
        readonly fd:number;
        read<T extends ArrayBufferView>(buffer:T,options?:ReadOptions):Promise<ReadResult<T>>;
        read<T extends ArrayBufferView>(buffer:T,offset:number,length:number,position?:number|bigint|null):Promise<ReadResult<T>>;
        read<T extends ArrayBufferView>(options:ReadOptions&{buffer:T}):Promise<ReadResult<T>>;
        read(options?:ReadOptions):Promise<ReadResult<Buffer>>;
        write<T extends ArrayBufferView>(buffer:T,options?:WriteOptions):Promise<WriteResult<T>>;
        write<T extends ArrayBufferView>(buffer:T,offset:number,length:number,position?:number|null):Promise<WriteResult<T>>;
        write(value:string,position?:number|null,encoding?:BufferEncoding):Promise<WriteResult<string>>;
        readFile(options?:{encoding?:null;flag?:OpenMode;signal?:AbortSignal}|null):Promise<Buffer>;
        readFile(options:BufferEncoding|{encoding:BufferEncoding;flag?:OpenMode;signal?:AbortSignal}):Promise<string>;
        readFile(options:AsyncReadFileOptions):Promise<Buffer|string>;
        writeFile(data:string|ArrayBufferView,options?:BufferEncoding|AsyncWriteFileOptions|null):Promise<void>;
        appendFile(data:string|ArrayBufferView,options?:BufferEncoding|AsyncWriteFileOptions|null):Promise<void>;
        stat(options?:{bigint?:false}):Promise<Stats>;
        stat(options:{bigint:true}):Promise<BigIntStats>;
        truncate(length?:number):Promise<void>;sync():Promise<void>;close():Promise<void>;[Symbol.asyncDispose]():Promise<void>;
    }
    export function open(path:PathLike,flags?:OpenMode,mode?:Mode):Promise<FileHandle>;
    export function readFile(path:PathLike|FileHandle,options?:{encoding?:null;flag?:OpenMode;signal?:AbortSignal}|null):Promise<Buffer>;
    export function readFile(path:PathLike|FileHandle,options:BufferEncoding|{encoding:BufferEncoding;flag?:OpenMode;signal?:AbortSignal}):Promise<string>;
    export function readFile(path:PathLike|FileHandle,options:AsyncReadFileOptions):Promise<Buffer|string>;
    export function writeFile(path:PathLike|FileHandle,data:string|ArrayBufferView,options?:BufferEncoding|AsyncWriteFileOptions|null):Promise<void>;
    export const appendFile:typeof writeFile;
    export function access(path:PathLike,mode?:number):Promise<void>;
    export function stat(path:PathLike,options?:{bigint?:false}):Promise<Stats>;
    export function stat(path:PathLike,options:{bigint:true}):Promise<BigIntStats>;
    export const lstat:typeof stat;
    export function mkdir(path:PathLike,options?:Mode|MkdirOptions):Promise<string|undefined>;
    export function readdir(path:PathLike,options?:BufferEncoding|{encoding?:BufferEncoding;recursive?:boolean;withFileTypes?:false}|null):Promise<string[]>;
    export function readdir(path:PathLike,options:'buffer'|{encoding:'buffer';recursive?:boolean;withFileTypes?:false}):Promise<Buffer[]>;
    export function readdir(path:PathLike,options:ReaddirOptions&{withFileTypes:true}):Promise<Dirent<string|Buffer>[]>;
    export function rename(oldPath:PathLike,newPath:PathLike):Promise<void>;
    export function unlink(path:PathLike):Promise<void>;
    export function rm(path:PathLike,options?:RmOptions):Promise<void>;
    export const rmdir:typeof rm;
    export function realpath(path:PathLike,options?:BufferEncoding|{encoding?:BufferEncoding}|null):Promise<string>;
    export function realpath(path:PathLike,options:'buffer'|{encoding:'buffer'}):Promise<Buffer>;
    export const mkdtemp:typeof realpath;
    export function copyFile(source:PathLike,destination:PathLike,mode?:number):Promise<void>;
    export const constants:typeof import('node:fs').constants;
    const fs:{open:typeof open;readFile:typeof readFile;writeFile:typeof writeFile;appendFile:typeof appendFile;access:typeof access;
        stat:typeof stat;lstat:typeof lstat;mkdir:typeof mkdir;readdir:typeof readdir;rename:typeof rename;unlink:typeof unlink;
        rm:typeof rm;rmdir:typeof rmdir;realpath:typeof realpath;mkdtemp:typeof mkdtemp;copyFile:typeof copyFile;constants:typeof constants};
    export default fs;
}
declare module 'fs/promises' {export * from 'node:fs/promises';export {default} from 'node:fs/promises';}
