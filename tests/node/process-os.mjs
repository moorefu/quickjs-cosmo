import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import { check, result } from './fixtures/result.mjs';

check(globalThis.process === process, 'Process global identity');
const rows = [];
function record(label, call) {
    try { rows.push([label, call()]); }
    catch (error) { rows.push([label, { name: error.name, code: error.code ?? null,
        errno: error.errno ?? null, syscall: error.syscall ?? null, path: error.path ?? null, dest: error.dest ?? null }]); }
}
check(process.pid > 0 && process.ppid >= 0 && Number.isInteger(process.pid), 'Process identifiers');
check(typeof process.execPath === 'string' && path.isAbsolute(process.execPath), 'Executable identity');
check(process.uptime() >= 0 && typeof process.hrtime.bigint() === 'bigint', 'Monotonic clock');
const before = process.hrtime(), after = process.hrtime(before);
check(after.length === 2 && after[0] >= 0 && after[1] >= 0 && after[1] < 1e9, 'hrtime difference');
rows.push(['runtime-version-type', typeof (process.versions.node ?? process.versions.quickjs)]);
for (const name of ['platform', 'arch', 'tmpdir', 'homedir', 'hostname', 'type', 'release']) record(name, () => os[name]());
rows.push(['EOL', os.EOL], ['cwd', process.cwd()], ['source-main', import.meta.main]);
const pathname = decodeURIComponent(import.meta.url.slice(7));
const entry = process.platform === 'win32' ? pathname.replace(/^\/([A-Za-z]:\/)/, '$1').replace(/\//g, '\\') : pathname;
rows.push(['argv-entry-meta', process.argv[1] === entry], ['argv-length', process.argv.length]);
const key = 'QJS_NODE_ENV_TEST_7C8B';
const old = process.env[key];
try {
    for (const value of ['abc', '', '中文😀', 'a\0b', 12, true, null, undefined, { toString: () => 'object' }]) {
        record(['env-set', String(value)], () => { process.env[key] = value; return [process.env[key], Object.hasOwn(process.env, key), key in process.env]; });
    }
    record('env-symbol-value', () => { process.env[key] = Symbol('x'); });
    process.env[key] = 'case';
    rows.push(['env-case', process.env[key.toLowerCase()] ?? null]);
    record('env-define', () => { Object.defineProperty(process.env, key, { value: 'defined', configurable: true, writable: true, enumerable: true }); return process.env[key]; });
    record('env-invalid-define', () => Object.defineProperty(process.env, key, { get: () => 'getter' }));
    const descriptor = Object.getOwnPropertyDescriptor(process.env, key);
    rows.push(['env-descriptor', descriptor.enumerable, descriptor.writable, descriptor.configurable]);
    delete process.env[key];
    rows.push(['env-delete', Object.hasOwn(process.env, key), key in process.env, process.env[key] ?? null]);
    rows.push(['env-method', typeof process.env.hasOwnProperty]);
} finally { if (old === undefined) delete process.env[key]; else process.env[key] = old; }
for (const value of [undefined, null, 0, 7, -1, 1.5, '7', '', ' ', 'bad', true, NaN, Infinity, 4294967295, 4294967296]) {
    record(['exitCode', String(value)], () => { process.exitCode = value; return [typeof process.exitCode, String(process.exitCode)]; });
    process.exitCode = 0;
}
for (const value of [undefined, null, 1, true]) record(['chdir-type', String(value)], () => process.chdir(value));
record('chdir-missing', () => process.chdir('QJS_COSMO_MISSING_DIRECTORY_123456789'));
const variable = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
const savedHome = process.env[variable];
process.env[variable] = 'QJS_TEST_HOME';
record('homedir-env', () => os.homedir());
if (savedHome === undefined) delete process.env[variable]; else process.env[variable] = savedHome;
delete process.env[variable];
try { record('homedir-fallback', () => os.homedir()); }
finally { if (savedHome !== undefined) process.env[variable] = savedHome; }
const temporaryKeys = ['TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'windir'];
const temporary = temporaryKeys.map(name => [name, process.env[name]]);
try {
    for (const key of temporaryKeys) delete process.env[key];
    record('tmpdir-fallback', () => os.tmpdir());
    for (const [key, value] of [['TMP', '/tmp/test/'], ['TEMP', 'C:\\test\\'], ['TMPDIR', '/tmp/other//']]) {
        process.env[key] = value;
        record(['tmpdir', key], () => os.tmpdir());
    }
} finally {
    for (const [key, value] of temporary) if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
result(rows);
