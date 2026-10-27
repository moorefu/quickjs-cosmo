import util, { promisify, TextEncoder, TextDecoder } from 'node:util';
import assert, { strictEqual } from 'node:assert';
import strict from 'node:assert/strict';
import { check, result } from './fixtures/result.mjs';

check(util.promisify === promisify && globalThis.TextEncoder === TextEncoder && globalThis.TextDecoder === TextDecoder, 'Util globals');
check(strict === assert.strict && strict.equal === strictEqual && assert.ok === assert, 'Assert default and strict identity');
const rows = [];
async function record(label, call) {
    try { const value = await call(); rows.push([label, value === undefined ? 'undefined' : value]); }
    catch (error) { rows.push([label, { name: error.name, code: error.code ?? null, operator: error.operator ?? null }]); }
}
function callback(a, b, done) { done(null, this.base + a + b, 'ignored'); }
const wrapped = promisify(callback);
rows.push(['promisify-metadata', wrapped.name, wrapped.length, wrapped[promisify.custom] === wrapped]);
await record('promisify-context', () => wrapped.call({ base: 10 }, 2, 3));
await record('callback-error', () => promisify(done => done(new TypeError('bad')))());
await record('sync-error', () => promisify(() => { throw new RangeError('sync'); })());
await record('promisify-type', () => promisify(1));
function original() {}
const custom = (...args) => Promise.resolve({ stdout: args.join(','), stderr: '' });
original[promisify.custom] = custom;
rows.push(['custom-identity', promisify(original) === custom, promisify(original)[promisify.custom] === custom]);
await record('custom-multiple', () => promisify(original)('a', 'b'));
original[promisify.custom] = true;
await record('invalid-custom', () => promisify(original));
for (const [name, fn] of [['ok', assert], ['equal', assert.equal], ['strictEqual', assert.strictEqual],
    ['notStrictEqual', assert.notStrictEqual], ['strict.equal', strict.equal]])
    for (const [a, b] of [[0, false], [1, '1'], [NaN, NaN], [0, -0], [1, 2], [true, true]])
        await record([name, String(a), String(b)], () => fn(a, b));
for (const expected of [undefined, TypeError, RangeError, /bad/, { name: 'TypeError', message: /bad/ },
    error => error.message === 'bad', error => false, {}, 1, 'custom message'])
    await record(['throws', rows.length], () => assert.throws(() => { throw new TypeError('bad'); }, expected));
await record('throws-missing', () => assert.throws(() => {}));
await record('throws-type', () => assert.throws(1));
const sentinel = new Error('sentinel');
try { assert(false, sentinel); } catch (error) { rows.push(['message-identity', error === sentinel]); }
await record('rejects', () => assert.rejects(Promise.reject(new TypeError('bad')), TypeError));
await record('rejects-function', () => assert.rejects(async () => { throw new TypeError('bad'); }, /bad/));
await record('rejects-missing', () => assert.rejects(Promise.resolve(1)));
await record('rejects-sync', () => assert.rejects(() => { throw new TypeError('bad'); }, TypeError));
await record('rejects-invalid-return', () => assert.rejects(() => 1));
await record('rejects-invalid-arg', () => assert.rejects(1));
await record('notEqual-pass', () => assert.notEqual(1, 2));
await record('notEqual-nan', () => assert.notEqual(NaN, NaN));
await record('fail', () => assert.fail('explicit failure'));
const explicit = new assert.AssertionError({ actual: 1, expected: 2, operator: 'strictEqual', message: 'explicit' });
rows.push(['AssertionError', explicit instanceof Error, explicit.name, explicit.code, explicit.actual,
    explicit.expected, explicit.operator, explicit.generatedMessage, explicit.message.startsWith('explicit')]);
result(rows);
