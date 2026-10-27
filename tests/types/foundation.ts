import process from 'node:process';
import path, { posix, win32 } from 'node:path';
import os from 'node:os';
import EventEmitter, { errorMonitor } from 'node:events';
import util, { promisify } from 'node:util';
import assert, { AssertionError } from 'node:assert';
import strict from 'node:assert/strict';
import { resolve } from 'path/posix';

const entry: string = process.argv[1];
const nanoseconds: bigint = process.hrtime.bigint();
const elapsed: [number, number] = process.hrtime();
process.env.QJS_TYPES = 'test';
delete process.env.QJS_TYPES;
process.exitCode = 0;
const joined: string = path.format(path.parse(win32.join('C:\\', 'a')));
void [joined, nanoseconds, elapsed, resolve('/tmp', entry), posix.sep, os.EOL];
const emitter = new EventEmitter({ captureRejections: false });
emitter.on('data', (value: number) => console.log(value)).once(errorMonitor, error => console.error(error));
emitter.off('data', () => {}).removeAllListeners();
const encoded: Uint8Array = new util.TextEncoder().encode('中文');
const decoded: string = new TextDecoder('utf8').decode(encoded);
const wrapped = promisify((done: (error: Error | null, value: number) => void) => done(null, 7));
const pending: Promise<number> = wrapped();
const check: typeof assert = assert;
check(decoded);
strict.equal(1, 1);
assert.throws(() => { throw new TypeError('test'); }, TypeError);
const rejected: Promise<void> = assert.rejects(Promise.reject(new Error('test')), /test/);
const failure: AssertionError = new AssertionError({ actual: 1, expected: 2, operator: 'strictEqual' });
void [pending, rejected, failure];
// @ts-expect-error Process environment only stores strings.
process.env.QJS_TYPES = 42;
// @ts-expect-error Unknown builtins have no declarations.
import missing from 'node:missing';
// @ts-expect-error captureRejections is not enabled before M1-04.
new EventEmitter({ captureRejections: true });
// @ts-expect-error path operations reject non-strings.
path.join(1);
