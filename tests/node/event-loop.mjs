import timers from 'node:timers';
import * as timerExports from 'node:timers';
import promises from 'node:timers/promises';
import { promisify } from 'node:util';
import { check, result } from './fixtures/result.mjs';

check(timers.setTimeout === globalThis.setTimeout && timers.setImmediate === globalThis.setImmediate, 'Timer global identities');
check(timers.promises === promises && timerExports.setInterval === timers.setInterval, 'Timer namespace identities');
check(promisify(timers.setTimeout) === promises.setTimeout && promisify(timers.setImmediate) === promises.setImmediate, 'Promisify timer identity');
const rows = [], trace = [];
trace.push('esm');
process.nextTick(() => { trace.push('tick1'); process.nextTick(() => trace.push('tick2')); queueMicrotask(() => trace.push('micro-from-tick')); });
Promise.resolve().then(() => { trace.push('promise1'); process.nextTick(() => trace.push('tick-from-promise')); });
queueMicrotask(() => { trace.push('micro1'); Promise.resolve().then(() => trace.push('promise2')); });
await promises.setTimeout(10);
rows.push(['initial-order', trace.splice(0)]);

await new Promise(resolve => {
    setTimeout(function (a, b) {
        trace.push(['timeout1', a, b, this === handle]);
        Promise.resolve().then(() => { trace.push('promise'); process.nextTick(() => trace.push('tick-from-promise')); });
        queueMicrotask(() => trace.push('micro'));
        process.nextTick(() => { trace.push('tick'); process.nextTick(() => trace.push('nested-tick')); });
    }, 1, 'arg', 7);
    const handle = setTimeout(function () {
        trace.push(['timeout2', this === handle]); resolve();
    }, 1);
});
rows.push(['callback-order', trace.splice(0)]);

await new Promise(resolve => {
    setImmediate(function (a) {
        trace.push(['immediate1', a, this === immediate]);
        queueMicrotask(() => trace.push('micro'));
        process.nextTick(() => trace.push('tick'));
        setImmediate(() => trace.push('new-immediate'));
    }, 9);
    const immediate = setImmediate(() => { trace.push('immediate2'); resolve(); });
});
await promises.setImmediate();
rows.push(['immediate-order', trace.splice(0)]);

const cancelled = setTimeout(() => { throw Error('cancelled timer fired'); }, 10);
rows.push(['timeout-handle', typeof +cancelled, cancelled.hasRef(), cancelled.unref() === cancelled,
    cancelled.hasRef(), cancelled.ref() === cancelled, cancelled.hasRef(), cancelled.refresh() === cancelled]);
clearTimeout(String(+cancelled));
rows.push(['cancelled-hasRef', cancelled.hasRef()]);
cancelled.refresh();
const immediate = setImmediate(() => { throw Error('cancelled immediate fired'); });
rows.push(['immediate-handle', immediate.hasRef(), immediate.unref() === immediate, immediate.hasRef(), immediate.ref() === immediate]);
clearImmediate(immediate);
rows.push(['cancelled-immediate-hasRef', immediate.hasRef()]);
const disposed = setTimeout(() => { throw Error('disposed timer fired'); }, 10);
disposed[Symbol.dispose]();
rows.push(['dispose', disposed.hasRef()]);
const closed = setTimeout(() => { throw Error('closed timer fired'); }, 10);
rows.push(['close', closed.close() === closed, closed.hasRef()]);
const disposedImmediate = setImmediate(() => { throw Error('disposed immediate fired'); });
disposedImmediate[Symbol.dispose]();
rows.push(['immediate-dispose', disposedImmediate.hasRef()]);
let count = 0;
await new Promise(resolve => {
    const interval = setInterval(function (value) {
        trace.push([++count, value, this === interval]);
        if (count === 3) { clearInterval(interval); resolve(); }
    }, 1, 'interval');
});
rows.push(['interval', trace.splice(0)]);
rows.push(['promise-value', await promises.setTimeout(1, 'value')]);
const iterator = promises.setInterval(1, 'iteration');
const values = [];
for await (const value of iterator) { values.push(value); if (values.length === 2) break; }
rows.push(['async-interval', values]);
const controller = new AbortController();
const pending = promises.setTimeout(10000, 'unused', { signal: controller.signal });
controller.abort('reason');
try { await pending; } catch (error) { rows.push(['aborted', error.name, error.code, error.cause]); }
const preAborted = AbortSignal.abort('already');
try { await promises.setImmediate('unused', { signal: preAborted }); }
catch (error) { rows.push(['already-aborted', error.name, error.code, error.cause]); }
for (const [label, call] of [
    ['timeout-callback', () => setTimeout(1)], ['interval-callback', () => setInterval(null)],
    ['immediate-callback', () => setImmediate('text')], ['microtask-callback', () => queueMicrotask(1)],
    ['tick-callback', () => process.nextTick(null)], ['bigint-delay', () => setTimeout(() => {}, 1n)]
]) {
    try { call(); rows.push([label, 'unexpected-success']); }
    catch (error) { rows.push([label, error.name, error.code ?? null]); }
}
for (const value of [null, '1', [], {}, true, 1n]) {
    try { await promises.setTimeout(value); rows.push(['promise-delay', 'unexpected-success']); }
    catch (error) { rows.push(['promise-delay', error.name, error.code ?? null]); }
}
for (const options of [null, [], 1, { ref: 0 }, { signal: {} }]) {
    try { await promises.setTimeout(1, undefined, options); rows.push(['promise-options', 'unexpected-success']); }
    catch (error) { rows.push(['promise-options', error.name, error.code ?? null]); }
}
try { await promises.setInterval('1').next(); rows.push(['interval-delay', 'unexpected-success']); }
catch (error) { rows.push(['interval-delay', error.name, error.code ?? null]); }
await promises.setTimeout(15);
result(rows);
