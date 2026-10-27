import * as os from 'os';
import process from 'node:process';
import { EventEmitter } from 'node:events';
import { main as importedMain } from './foundation-import.mjs';

const parent = os.Worker.parent;
parent.onmessage = () => {
    const codes = [];
    for (const operation of [() => process.chdir('.'), () => process.exit(7), () => { process.exitCode = 7; }]) {
        try { operation(); codes.push('missing-error'); } catch (error) { codes.push(error.code); }
    }
    const value = process.env.QJS_FOUNDATION_WORKER_SNAPSHOT;
    process.env.QJS_FOUNDATION_WORKER_SNAPSHOT = 'worker-only';
    parent.postMessage({ value, local: process.env.QJS_FOUNDATION_WORKER_SNAPSHOT,
        argvTail: process.argv[process.argv.length - 1], codes, pid: process.pid,
        main: import.meta.main, importedMain, url: import.meta.url,
        globals: globalThis.process === process && process instanceof EventEmitter });
    parent.onmessage = null;
};
