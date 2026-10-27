import * as os from 'os';
import timers from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
const parent = os.Worker.parent;
parent.onmessage = async ({ data }) => {
    if (data === 'fail') {
        setTimeout(async () => { parent.postMessage({ phase: 'error-recorded' }); throw Error('SCHEDULER_EXPECTED_WORKER_ERROR'); }, 1);
        setTimeout(() => parent.postMessage({ phase: 'wrong' }), 1);
        parent.onmessage = null;
        return;
    }
    const order = [];
    const before = Number(process.hrtime.bigint()) / 1e6;
    const clock = os.now();
    const after = Number(process.hrtime.bigint()) / 1e6;
    process.nextTick(() => order.push('tick'));
    queueMicrotask(() => order.push('micro'));
    Promise.resolve().then(() => order.push('promise'));
    const unref = setTimeout(() => { throw Error('Unref Worker timer fired'); }, 10000).unref();
    const controller = new AbortController(); controller.abort();
    await delay(2); order.push('timer');
    parent.postMessage({ order, monotonic: clock >= before - 1 && clock <= after + 1,
        identity: timers.setTimeout === setTimeout, ref: unref.hasRef(), aborted: controller.signal.aborted });
    parent.onmessage = null;
};
