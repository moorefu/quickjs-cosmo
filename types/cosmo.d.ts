declare module 'cosmo:bundle' {
    /** Resolve inside the current mounted QJB; never falls back to the host. */
    export function resolve(specifier:string,baseURL:string):string;
    /** Fresh bytes; requires a canonical mounted address. */
    export function readFileSync(bundleURL:string):import('node:buffer').Buffer;
    /** Strict UTF-8; malformed input throws ERR_QJB_UTF8. */
    export function readTextSync(bundleURL:string):string;
}

declare module 'cosmo:runtime' {
    export type APIStatus='planned'|'partial'|'supported'|'blocked'|'unsupported';
    export interface RuntimeCapabilities {
        format:1;nodeApiTarget:string;inventorySha256:string;backendLocks:Record<string,string>;
        scope:{modules:'ESM';commonJS:false;npmResolution:false;tlsVersions:string[];serverNetworking:false;stdioOutput:string;workerStdin:false};
        limits:{terminal:{scope:'process';devices:number;owners:number;legacyDepth:number;resizePollMs:number;lineCharacters:number;iteratorLines:number;historyEntries:number};nativeTasks:{scope:'runtime';threads:number;tasks:number;reservedBytes:number};sockets:{scope:'runtime';count:number;inputBytes:number;outputBytes:number;tlsArenaBytes:number};childProcesses:{scope:'runtime';count:number};stdio:{scope:'process';readers:number;writeChunkBytes:number;pollIntervalMs:number}};
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
