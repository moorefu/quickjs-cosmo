import events, { EventEmitter, errorMonitor } from 'node:events';
import { check, result, errorOf } from './fixtures/result.mjs';

check(events === EventEmitter && events.EventEmitter === EventEmitter, 'Emitter default identity');
const trace = [], emitter = new EventEmitter(), symbol = Symbol('event');
function a(value) { trace.push(['a', value, this === emitter]); emitter.off('x', b); emitter.on('x', c); }
function b(value) { trace.push(['b', value]); }
function c(value) { trace.push(['c', value]); }
emitter.on('newListener', (type, listener) => { if (type === 'x') trace.push(['new', listener === a ? 'a' : listener === b ? 'b' : listener === c ? 'c' : 'once']); });
emitter.on('removeListener', (type, listener) => { if (type === 'x') trace.push(['remove', listener === b ? 'b' : listener === a ? 'a' : 'other']); });
emitter.on('x', a).on('x', b).once('x', value => trace.push(['once', value]));
trace.push(['listeners', emitter.listeners('x').length, emitter.rawListeners('x')[2].listener === emitter.listeners('x')[2]]);
trace.push(['emit1', emitter.emit('x', 1)]);
trace.push(['emit2', emitter.emit('x', 2)]);
trace.push(['count-c', emitter.listenerCount('x', c)]);
emitter.removeAllListeners('x');
trace.push(['empty', emitter.emit('x', 3)]);
emitter.on(symbol, value => trace.push(['symbol', value]));
emitter.emit(symbol, 9);
trace.push(['event-names', emitter.eventNames().map(key => typeof key === 'symbol' ? 'symbol' : key)]);
const nested = new EventEmitter();
nested.once('x', () => { trace.push('nested-once'); nested.emit('x'); });
nested.emit('x');
const order = new EventEmitter();
order.on('x', () => trace.push(3)).prependListener('x', () => trace.push(2)).prependOnceListener('x', () => trace.push(1));
order.emit('x'); order.emit('x');
const original = new Error('original'), errors = new EventEmitter();
errors.on(errorMonitor, error => trace.push(['monitor', error === original]));
try { errors.emit('error', original); } catch (error) { trace.push(['error-identity', error === original]); }
errors.on('error', error => trace.push(['handled', error === original])); errors.emit('error', original);
trace.push(['unhandled', errorOf(() => new EventEmitter().emit('error', 'payload'))]);
for (const method of ['on', 'once', 'off', 'removeListener', 'prependListener'])
    trace.push([method, errorOf(() => emitter[method]('x', 1))]);
const duplicate = new EventEmitter();
duplicate.on('x', a).on('x', a); duplicate.off('x', a);
trace.push(['duplicate', duplicate.listenerCount('x'), duplicate.listeners('x')[0] === a]);
trace.push(['static-count', events.listenerCount(duplicate, 'x')]);
trace.push(['add-alias', duplicate.addListener === duplicate.on]);
duplicate.removeAllListeners();
trace.push(['remove-all', duplicate.eventNames().length]);
const numericNames = new EventEmitter();
numericNames.on('10', () => {}).on('2', () => {}).on('a', () => {}).on(symbol, () => {});
trace.push(['numeric-names', numericNames.eventNames().map(key => typeof key === 'symbol' ? 'symbol' : key)]);
result(trace);
