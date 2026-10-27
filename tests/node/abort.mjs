import { setTimeout as delay } from 'node:timers/promises';
import { check, result } from './fixtures/result.mjs';
const rows = [], trace = [];
const controller = new AbortController(), signal = controller.signal;
check(signal instanceof AbortSignal && signal instanceof EventTarget, 'Signal inheritance');
rows.push(['initial', signal.aborted, signal.reason ?? null, Object.prototype.toString.call(signal)]);
const listener = function (event) { trace.push(['abort', this === signal, event.type, event.target === signal,
    event.currentTarget === signal, event.isTrusted, event.eventPhase, event.composedPath()[0] === signal]); };
signal.addEventListener('abort', listener, { once: true });
signal.onabort = () => trace.push('onabort');
controller.abort('reason'); controller.abort('ignored');
try { signal.throwIfAborted(); } catch (error) { rows.push(['throw-reason', error]); }
rows.push(['aborted', signal.aborted, signal.reason, trace.splice(0)]);
const defaultSignal = AbortSignal.abort();
rows.push(['default-reason', defaultSignal.reason instanceof DOMException, defaultSignal.reason instanceof Error,
    defaultSignal.reason.name, defaultSignal.reason.code, defaultSignal.reason.message]);
const target = new EventTarget(), stop = new AbortController();
function removed() { trace.push('removed'); }
target.addEventListener('event', removed, { signal: stop.signal });
target.addEventListener('event', () => trace.push('once'), { once: true });
target.addEventListener('event', event => { trace.push('prevent'); event.preventDefault(); });
stop.abort();
const event = new Event('event', { cancelable: true });
rows.push(['dispatch', target.dispatchEvent(event), target.dispatchEvent(new Event('event')), event.defaultPrevented,
    event.currentTarget, event.target === target, event.composedPath().length, trace.splice(0)]);
const a = new AbortController(), b = new AbortController(), combined = AbortSignal.any([a.signal, b.signal]);
combined.onabort = () => trace.push('combined');
a.signal.onabort = () => trace.push(['source', combined.aborted]);
a.abort('first'); b.abort('second');
rows.push(['any', combined.aborted, combined.reason, trace.splice(0)]);
const timed = AbortSignal.timeout(1);
await delay(10);
rows.push(['timeout', timed.aborted, timed.reason.name, timed.reason.code]);
for (const [label, call] of [['constructor', () => new AbortSignal()], ['any-type', () => AbortSignal.any(null)],
    ['any-element', () => AbortSignal.any([{}])], ['timeout-type', () => AbortSignal.timeout('1')],
    ['timeout-range', () => AbortSignal.timeout(-1)]]) {
    try { call(); rows.push([label, 'unexpected-success']); } catch (error) { rows.push([label, error.name, error.code ?? null]); }
}
result(rows);
