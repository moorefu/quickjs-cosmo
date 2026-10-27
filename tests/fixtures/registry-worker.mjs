import * as os from 'os';
import * as qos from 'qjs:os';
import { runtimeInfo } from 'cosmo:runtime';

const parent = os.Worker.parent;
parent.onmessage = async () => {
    let unknownCode;
    try { await import('node:no-such-builtin'); } catch (error) { unknownCode = error.code; }
    const info = runtimeInfo();
    parent.postMessage({ engine: info.engine, arch: info.arch, modules: info.builtinModules,
                         aliases: os === qos, unknownCode });
    parent.onmessage = null;
};
