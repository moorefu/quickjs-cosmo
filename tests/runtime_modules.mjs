import * as std from 'std';
import * as qstd from 'qjs:std';
import * as os from 'os';
import * as qos from 'qjs:os';
import { runtimeInfo } from 'cosmo:runtime';
import * as direct from './node/fixtures/value.mjs';
import * as normalized from './node/fixtures/../fixtures/value.mjs';
import { equal, assert, finish } from './assert.js';

assert(std === qstd && os === qos, 'QuickJS aliases share module namespace identity');
assert(direct === normalized && direct.default === normalized.default, 'Internal parent paths are canonical');
const dynamic = await import('cosmo:runtime');
assert(dynamic.runtimeInfo === runtimeInfo, 'Static and dynamic builtins share exports');
equal(Object.keys(dynamic).join(','), 'runtimeInfo', 'Explicit named exports');
const info = runtimeInfo();
equal(info.engine, 'quickjs');
equal(info.nodeApiTarget, 'v24.21.0');
equal(info.platform, os.platform);
assert(info.arch === 'x64' || info.arch === 'arm64');
assert(/^[a-f0-9]{40}$/.test(info.quickjsCommit));
assert(/^[a-f0-9]{40}$/.test(info.cosmopolitanCommit));
equal(info.builtinModules.join(','), 'std,os,cosmo:runtime');
info.builtinModules.push('node:not-implemented');
equal(runtimeInfo().builtinModules.length, 3, 'Metadata cannot mutate the native registry');
for (const name of ['node:no-such-builtin', 'node:fs', 'cosmo:missing', 'qjs:missing', '@runtime/crypto']) {
    let failure;
    try { await import(name); } catch (error) { failure = error; }
    assert(failure instanceof Error, name + ' must reject');
    equal(failure.code, 'ERR_UNKNOWN_BUILTIN_MODULE', name);
    assert(failure.message.includes(name), 'Unknown builtin error identifies the module');
}
const worker = new os.Worker('./fixtures/registry-worker.mjs');
const watchdog = os.setTimeout(() => {
    std.err.puts('FAIL module registry Worker timed out\n');
    std.exit(1);
}, 10000);
try {
    const response = await new Promise(resolve => {
        worker.onmessage = ({ data }) => resolve(data);
        worker.postMessage('inspect');
    });
    worker.onmessage = null;
    equal(response.engine, 'quickjs');
    equal(response.arch, runtimeInfo().arch);
    assert(response.aliases, 'Worker aliases');
    equal(response.unknownCode, 'ERR_UNKNOWN_BUILTIN_MODULE');
    equal(response.modules.join(','), 'std,os,cosmo:runtime');
} finally {
    os.clearTimeout(watchdog);
    worker.onmessage = null;
}
finish('runtime-modules');
