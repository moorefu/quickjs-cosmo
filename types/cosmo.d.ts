declare module 'cosmo:runtime' {
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
    }
    export function runtimeInfo(): RuntimeInfo;
}
