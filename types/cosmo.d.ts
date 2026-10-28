declare module 'cosmo:runtime' {
    export type APIStatus='planned'|'partial'|'supported'|'blocked'|'unsupported';
    export interface RuntimeCapabilities {
        format:1;nodeApiTarget:string;inventorySha256:string;backendLocks:Record<string,string>;
        scope:{modules:'ESM';commonJS:false;npmResolution:false;tlsVersions:string[];serverNetworking:false;stdioOutput:string;workerStdin:false};
        limits:{nativeTasks:{scope:'runtime';threads:number;tasks:number;reservedBytes:number};sockets:{scope:'runtime';count:number;inputBytes:number;outputBytes:number;tlsArenaBytes:number};childProcesses:{scope:'runtime';count:number};stdio:{scope:'process';readers:number;writeChunkBytes:number;pollIntervalMs:number}};
        backends:Array<{id:string;delivery:string;sourceAdmission:string}>;
        modules:Array<{specifier:string;aliases:string[];apis:Record<string,APIStatus>}>;
        globals:Record<string,APIStatus>;notes:string[];
    }
    export interface RuntimeInfo {
        engine: 'quickjs';
        quickjsVersion: string;
        quickjsCommit: string;
        cosmopolitanVersion: string;
        cosmopolitanCommit: string;
        nodeApiTarget: string;
        platform: 'win32' | 'linux' | 'darwin' | 'freebsd' | 'openbsd' | 'netbsd';
        arch: 'x64' | 'arm64';
        builtinModules: string[];
        entry:'qjs'|'worker'|'qjsc'|'sdk';
        capabilities:RuntimeCapabilities;
    }
    export function runtimeInfo(): RuntimeInfo;
}
