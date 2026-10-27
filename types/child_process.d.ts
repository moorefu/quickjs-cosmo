declare module 'node:child_process' {
    import {Buffer,BufferEncoding} from 'node:buffer';
    export type Signal = 'SIGHUP' | 'SIGINT' | 'SIGQUIT' | 'SIGILL' | 'SIGTRAP' | 'SIGABRT' | 'SIGIOT' |
        'SIGBUS' | 'SIGFPE' | 'SIGKILL' | 'SIGUSR1' | 'SIGSEGV' | 'SIGUSR2' | 'SIGPIPE' | 'SIGALRM' |
        'SIGTERM' | 'SIGCHLD' | 'SIGCONT' | 'SIGSTOP' | 'SIGTSTP' | 'SIGTTIN' | 'SIGTTOU' | 'SIGURG' |
        'SIGXCPU' | 'SIGXFSZ' | 'SIGVTALRM' | 'SIGPROF' | 'SIGWINCH' | 'SIGSYS' | 'SIGBREAK';
    export type StdioEntry = 'pipe' | 'ignore' | 'inherit' | 'overlapped' | number | {fd:number} | null;
    export type StdioOptions = 'pipe' | 'ignore' | 'inherit' | 'overlapped' | readonly [StdioEntry?,StdioEntry?,StdioEntry?];
    export interface SpawnSyncOptions {
        cwd?: string | Uint8Array; env?: Record<string,string | undefined>; argv0?: string;
        input?: string | ArrayBufferView; stdio?: StdioOptions;
        timeout?: number; maxBuffer?: number; killSignal?: Signal | number;
        encoding?: BufferEncoding | 'buffer' | null; shell?: boolean | string;
        uid?: number; gid?: number; windowsHide?: boolean; windowsVerbatimArguments?: boolean;
        /** Complete detached-process behavior is outside this subset. */
        detached?: false;
    }
    export interface SpawnSyncError extends Error {code?: string; errno?: number; syscall?: string; path?: string; spawnargs?: string[];}
    export interface SpawnSyncReturns<T> {
        pid: number; status: number | null; signal: Signal | null; error?: SpawnSyncError;
        output: [null,T | null,T | null] | null; stdout: T | null | undefined; stderr: T | null | undefined;
    }
    export interface SpawnSyncOptionsWithStringEncoding extends SpawnSyncOptions {encoding:BufferEncoding;}
    export interface SpawnSyncOptionsWithBufferEncoding extends SpawnSyncOptions {encoding?:'buffer' | null;}
    export function spawnSync(file:string,args:readonly string[],options:SpawnSyncOptionsWithStringEncoding):SpawnSyncReturns<string>;
    export function spawnSync(file:string,options:SpawnSyncOptionsWithStringEncoding):SpawnSyncReturns<string>;
    export function spawnSync(file:string,args?:readonly string[],options?:SpawnSyncOptionsWithBufferEncoding):SpawnSyncReturns<Buffer>;
    export function spawnSync(file:string,options?:SpawnSyncOptionsWithBufferEncoding):SpawnSyncReturns<Buffer>;
    export function spawnSync(file:string,args:readonly string[],options:SpawnSyncOptions):SpawnSyncReturns<Buffer | string>;
    export function execFileSync(file:string,args:readonly string[],options:SpawnSyncOptionsWithStringEncoding):string;
    export function execFileSync(file:string,options:SpawnSyncOptionsWithStringEncoding):string;
    export function execFileSync(file:string,args?:readonly string[],options?:SpawnSyncOptionsWithBufferEncoding):Buffer;
    export function execFileSync(file:string,options?:SpawnSyncOptionsWithBufferEncoding):Buffer;
    export function execSync(command:string,options:SpawnSyncOptionsWithStringEncoding):string;
    export function execSync(command:string,options?:SpawnSyncOptionsWithBufferEncoding):Buffer;
    const childProcess:{spawnSync:typeof spawnSync;execFileSync:typeof execFileSync;execSync:typeof execSync}&AsyncChildProcessMethods;
    export default childProcess;
}
declare module 'child_process' {export * from 'node:child_process';export {default} from 'node:child_process';}
