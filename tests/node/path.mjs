import path from 'node:path';
import posix from 'node:path/posix';
import win32 from 'node:path/win32';
import * as bare from 'path';
import { check, result } from './fixtures/result.mjs';

check(path === (path.sep === '/' ? posix : win32), 'Host path selection');
check(path.posix === posix && path.win32 === win32 && bare.default === path, 'Path module object identity');
check(posix.posix === posix && win32.win32 === win32 && posix.win32 === win32 && win32.posix === posix, 'Explicit path identities');
check(posix._makeLong === posix.toNamespacedPath && win32._makeLong === win32.toNamespacedPath, 'Legacy namespace aliases');
const rows = [];
function record(key, call) {
    try { rows.push([key, call()]); } catch (error) { rows.push([key, { name: error.name, code: error.code ?? null }]); }
}
const names = ['', '.', '..', '../a', 'a/../b/', '/a//b/..', '///', '/.hidden', '/a.tar.gz',
    'C:', 'C:foo', 'C:\\a\\..\\b', 'c:/a/b/', '\\a', '\\\\server\\share\\a', '\\\\?\\C:\\foo',
    '\\\\server\\share', 'foo:bar', 'CON:a', 'COM1:', '中文/😀.txt', '\ud800.txt', 'a\0b', 'x\\y/z'];
for (const [kind, api] of [['posix', posix], ['win32', win32]]) {
    for (const name of names) {
        for (const method of ['normalize', 'resolve', 'dirname', 'basename', 'extname', 'parse', 'isAbsolute', 'toNamespacedPath'])
            record([kind, method, name], () => api[method](name));
        record([kind, 'format-parse', name], () => api.format(api.parse(name)));
        for (const suffix of ['', '.txt', 'txt', '/', 1])
            record([kind, 'basename-suffix', name, suffix], () => api.basename(name, suffix));
    }
    for (const from of names) for (const to of names) {
        record([kind, 'relative', from, to], () => api.relative(from, to));
        record([kind, 'join', from, to], () => api.join(from, to));
        record([kind, 'resolve-pair', from, to], () => api.resolve(from, to));
    }
    for (const value of [undefined, null, 1, [], {}, { root: '/', dir: '/a', base: 'b', name: 'c', ext: '.txt' },
        { name: 'a', ext: 'txt' }, { root: 'C:\\', name: 'x', ext: '.js' }, { base: 12 }, { dir: 1, name: 2 }]) {
        record([kind, 'format', rows.length], () => api.format(value));
        record([kind, 'bad-normalize', rows.length], () => api.normalize(value));
        record([kind, 'bad-join', rows.length], () => api.join('a', value));
    }
}
result(rows);
