import * as std from 'std';
import * as os from 'os';
import timers from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { finish } from './assert.js';

assert.equal(timers.setTimeout, globalThis.setTimeout);
const clockBefore = Number(process.hrtime.bigint()) / 1e6;
const osClock = os.now();
const clockAfter = Number(process.hrtime.bigint()) / 1e6;
assert(osClock >= clockBefore - 1 && osClock <= clockAfter + 1);
const controller = new AbortController();
const timer = delay(10000, undefined, { signal: controller.signal });
const rejection = assert.rejects(timer, { name: 'AbortError', code: 'ABORT_ERR' });
controller.abort('cancelled'); await rejection;
const temporary = setInterval(() => { throw Error('Unref interval kept the runtime alive'); }, 10000).unref();
assert.equal(temporary.hasRef(), false);
const worker = new os.Worker('./fixtures/scheduling-worker.mjs');
const watchdog = os.setTimeout(() => { std.err.puts('Scheduling Worker timed out\n'); std.exit(1); }, 10000);
try {
    const reply = await new Promise(resolve => {
        worker.onmessage = ({ data }) => resolve(data);
        worker.postMessage('inspect');
    });
    worker.onmessage = null;
    assert.equal(reply.order.join(','), 'tick,micro,promise,timer');
    assert.equal(reply.identity, true); assert.equal(reply.ref, false);
    assert.equal(reply.monotonic, true);
    assert.equal(reply.aborted, true);
} finally { worker.onmessage = null; os.clearTimeout(watchdog); }
const failing = new os.Worker('./fixtures/scheduling-worker.mjs'), phases = [];
const failureWatchdog = os.setTimeout(() => std.exit(1), 10000);
try {
    await new Promise(resolve => {
        failing.onmessage = ({ data }) => { phases.push(data.phase); if (data.phase === 'error-recorded') resolve(); };
        failing.postMessage('fail');
    });
    await delay(10);
    assert.equal(phases.join(','), 'error-recorded');
} finally { failing.onmessage = null; os.clearTimeout(failureWatchdog); }
std.gc();
await delay(1);
finish('runtime-scheduling');
