import timers, { type Timeout, type Immediate } from 'node:timers';
import { setTimeout as delay, setInterval as interval } from 'node:timers/promises';
const timeout: Timeout = timers.setTimeout((text: string, count: number) => console.log(text, count), 1, 'value', 7);
timeout.unref().ref().refresh()[Symbol.dispose]();
const immediate: Immediate = setImmediate(() => {});
immediate.unref().ref()[Symbol.dispose]();
const controller = new AbortController();
const signal: AbortSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(100)]);
const value: Promise<string> = delay(1, 'value', { signal, ref: false });
const sequence: AsyncGenerator<string, void, unknown> = interval(1, 'value', { signal });
signal.addEventListener('abort', event => console.log(event.type), { once: true });
controller.abort(new DOMException('cancelled', 'AbortError'));
process.nextTick((n: number) => console.log(n), 7);
queueMicrotask(() => {});
void [value, sequence, timers.promises, timeout.hasRef()];
// @ts-expect-error String evaluation is outside the Node timer contract.
timers.setTimeout('code', 1);
// @ts-expect-error Timer arguments preserve callback types.
timers.setTimeout((n: number) => {}, 1, 'bad');
// @ts-expect-error Abort option must be a signal.
delay(1, 'value', { signal: {} });
// @ts-expect-error Timeout and Immediate handles are distinct.
immediate.refresh();
