import * as os from 'os';
import * as qos from 'qjs:os';
import { runtimeInfo } from 'cosmo:runtime';
import { Buffer } from 'node:buffer';

const parent = os.Worker.parent;
parent.onmessage = async () => {
    let unknownCode;
    try { await import('node:no-such-builtin'); } catch (error) { unknownCode = error.code; }
    const info = runtimeInfo();
    if(info.entry!=='worker'||info.capabilities.format!==1||!info.capabilities.modules.some(m=>m.specifier==='node:https'))throw Error('Invalid Worker capability contract');
    parent.postMessage({ engine: info.engine, arch: info.arch, modules: info.builtinModules,
                         aliases: os === qos, unknownCode,
                         buffer: globalThis.Buffer === Buffer && Buffer.from('😀').toString('hex') === 'f09f9880' &&
                                 new TextDecoder().decode(new TextEncoder().encode('中文')) === '中文' });
    parent.onmessage = null;
};
