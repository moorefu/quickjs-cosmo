declare module 'node:child_process' {
    import {EventEmitter} from 'node:events';
    import {Readable,Writable} from 'node:stream';
    import {promisify} from 'node:util';
    import type {Buffer,BufferEncoding} from 'node:buffer';
    export interface SpawnOptions extends Omit<SpawnSyncOptions,'input'|'maxBuffer'|'encoding'> {signal?:AbortSignal;}
    export interface ChildReadable extends Readable {ref():this;unref():this;}
    export interface ChildWritable extends Writable {ref():this;unref():this;}
    export class ChildProcess extends EventEmitter {
        constructor();
        pid:number|undefined;spawnfile:string|undefined;spawnargs:string[];
        exitCode:number|null;signalCode:Signal|null;killed:boolean;connected:false;
        stdin:ChildWritable|null;stdout:ChildReadable|null;stderr:ChildReadable|null;
        stdio:[ChildWritable|null,ChildReadable|null,ChildReadable|null];
        kill(signal?:Signal|number):boolean;
        ref():void;unref():void;
        [Symbol.dispose]():void;
    }
    export function spawn(file:string,args?:readonly string[],options?:SpawnOptions):ChildProcess;
    export function spawn(file:string,options?:SpawnOptions):ChildProcess;
    export interface ExecFileOptions extends SpawnOptions {encoding?:BufferEncoding|'buffer'|null;maxBuffer?:number;}
    export interface ExecFileException extends Error {code?:string|number|null;errno?:number;syscall?:string;path?:string;spawnargs?:string[];signal?:Signal|null;killed?:boolean;cmd?:string;stdout?:string|Buffer;stderr?:string|Buffer;}
    export type ExecCallback<T>=(error:ExecFileException|null,stdout:T,stderr:T)=>void;
    export interface ExecFilePromise<T> extends Promise<{stdout:T;stderr:T}> {child:ChildProcess;}
    export interface ExecFilePromisified {
        (file:string,args?:readonly string[],options?:ExecFileOptions&{encoding?:BufferEncoding}):ExecFilePromise<string>;
        (file:string,options?:ExecFileOptions&{encoding?:BufferEncoding}):ExecFilePromise<string>;
        (file:string,args:readonly string[],options:ExecFileOptions&{encoding:'buffer'|null}):ExecFilePromise<Buffer>;
        (file:string,options:ExecFileOptions&{encoding:'buffer'|null}):ExecFilePromise<Buffer>;
        (file:string,args:readonly string[],options:ExecFileOptions):ExecFilePromise<string|Buffer>;
    }
    export interface ExecFileFunction {
        (file:string,callback?:ExecCallback<string>):ChildProcess;
        (file:string,args:readonly string[],callback?:ExecCallback<string>):ChildProcess;
        (file:string,options:ExecFileOptions&{encoding?:BufferEncoding},callback?:ExecCallback<string>):ChildProcess;
        (file:string,args:readonly string[],options:ExecFileOptions&{encoding?:BufferEncoding},callback?:ExecCallback<string>):ChildProcess;
        (file:string,options:ExecFileOptions&{encoding:'buffer'|null},callback?:ExecCallback<Buffer>):ChildProcess;
        (file:string,args:readonly string[],options:ExecFileOptions&{encoding:'buffer'|null},callback?:ExecCallback<Buffer>):ChildProcess;
        readonly [promisify.custom]:ExecFilePromisified;
    }
    export const execFile:ExecFileFunction;
    export interface ExecPromisified {
        (command:string,options?:ExecFileOptions&{encoding?:BufferEncoding}):ExecFilePromise<string>;
        (command:string,options:ExecFileOptions&{encoding:'buffer'|null}):ExecFilePromise<Buffer>;
    }
    export interface ExecFunction {
        (command:string,callback?:ExecCallback<string>):ChildProcess;
        (command:string,options:ExecFileOptions&{encoding?:BufferEncoding},callback?:ExecCallback<string>):ChildProcess;
        (command:string,options:ExecFileOptions&{encoding:'buffer'|null},callback?:ExecCallback<Buffer>):ChildProcess;
        readonly [promisify.custom]:ExecPromisified;
    }
    export const exec:ExecFunction;
    export interface AsyncChildProcessMethods {ChildProcess:typeof ChildProcess;spawn:typeof spawn;execFile:typeof execFile;exec:typeof exec;}
}
