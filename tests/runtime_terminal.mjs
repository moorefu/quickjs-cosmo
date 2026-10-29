import process from 'node:process';
import tty from 'node:tty';
import readline from 'node:readline';
import promises from 'node:readline/promises';
import assert from 'node:assert/strict';
import * as os from 'qjs:os';
import {runTerminalSample} from '../examples/terminal.mjs';

const mode = process.env.QJS_TERMINAL_CASE;
const event = (kind, value) => console.log('TTY_EVENT ' + JSON.stringify({kind, value}));
const wait = () => new Promise(resolve => setTimeout(resolve, 15000));
if (mode === 'pipe') {
    assert.equal(tty.isatty(0), false);
    assert.equal(process.stdin.isTTY, undefined);
    assert.equal(process.stdin.setRawMode, undefined);
    assert.equal(os.ttyGetWinSize(0), null);
    let count = 0;
    const rl = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
    for await (const line of rl) {
        assert.equal(line, 'line-' + count++);
        if (count % 16 === 0) await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.equal(count, 256);
    await runTerminalSample();
    event('done', 'pipe');
} else {
    assert(tty.isatty(0) && tty.isatty(1));
    assert(process.stdin instanceof tty.ReadStream);
    assert(process.stdout instanceof tty.WriteStream);
    assert.equal(os.read.length, 4);
    assert.equal(os.ttySetRaw.length, 2);
    if (mode === 'worker') {
        const worker = new os.Worker('./fixtures/terminal-worker.mjs');
        const watchdog = setTimeout(() => { throw Error('Terminal Worker timeout'); }, 5000);
        try {
            const value = await new Promise(resolve => { worker.onmessage = ({data}) => resolve(data); worker.postMessage('inspect'); });
            assert(value.modules);
            assert.equal(value.codes.join(','), 'ERR_WORKER_UNSUPPORTED_OPERATION,ERR_WORKER_UNSUPPORTED_OPERATION');
        } finally { clearTimeout(watchdog); worker.onmessage = null; }
        event('done', mode);
    } else if (mode === 'legacy') {
        os.ttySetRaw(0, undefined); // Explicit undefined uses the documented default.
        for (let i = 0; i < 31; i++) os.ttySetRaw(0);
        assert.throws(() => os.ttySetRaw(0), {code: 'ERR_TTY_RESOURCE_LIMIT'});
        for (let i = 0; i < 32; i++) os.ttySetRaw(0, false);
        os.ttySetRaw(0, false);
        event('done', mode);
    } else if (mode === 'owners') {
        const inputs = Array.from({length: 65}, () => new tty.ReadStream(0));
        for (let i = 0; i < 64; i++) inputs[i].setRawMode(true).setRawMode(true);
        assert.throws(() => inputs[64].setRawMode(true), {code: 'ERR_TTY_RESOURCE_LIMIT'});
        os.ttySetRaw(0, false); // An unowned release cannot release a Node owner.
        for (let i = 0; i < 64; i++) assert(inputs[i].isRaw);
        for (let i = 0; i < 64; i++) inputs[i].setRawMode(false).setRawMode(false);
        os.ttySetRaw(0); process.stdin.setRawMode(true);
        os.ttySetRaw(0, false); assert(process.stdin.isRaw);
        process.stdin.setRawMode(false);
        event('done', mode);
    } else if (mode === 'keys') {
        process.stdin.setRawMode(true);
        readline.emitKeypressEvents(process.stdin);
        process.stdout.on('resize', () => event('resize', process.stdout.getWindowSize()));
        const done = new Promise(resolve => process.stdin.on('keypress', (text, key) => {
            event('key', [text ?? null, key.name ?? null, key.ctrl, key.meta]);
            if (key.ctrl && key.name === 'c') resolve();
        }));
        event('ready', process.stdout.getWindowSize());
        await done;
        process.stdin.removeAllListeners('keypress'); process.stdin.pause();
        process.stdin.setRawMode(false); process.stdout.removeAllListeners('resize');
    } else if (mode === 'readline') {
        const rl = promises.createInterface({input: process.stdin, output: process.stdout, escapeCodeTimeout: 50});
        const answer = rl.question('Answer: '); event('ready', mode);
        assert.equal(await answer, 'aXb'); rl.close(); assert.equal(process.stdin.isRaw, false);
        // Closing a second interface preserves a preexisting raw owner.
        process.stdin.setRawMode(true);
        const other = readline.createInterface({input: process.stdin, output: process.stdout});
        other.close(); assert(process.stdin.isRaw); process.stdin.setRawMode(false);
        event('done', mode);
    } else if (mode === 'legacy-read') {
        os.ttySetRaw(0);
        await new Promise(resolve => {
            const buffer = new Uint8Array(64);
            os.setReadHandler(0, () => {
                const count = os.read(0, buffer.buffer, 0, buffer.length);
                if (count === 0 || count > 0 && buffer.subarray(0, count).includes(113)) {
                    os.setReadHandler(0, null); os.ttySetRaw(0, false); resolve();
                }
            });
            event('ready', mode);
        });
    } else if (mode.startsWith('sample')) {
        // Inject failures after the application has changed its display.
        const log = console.log;
        console.log = (...args) => {
            log(...args);
            if (args[0] === 'TTY_SAMPLE_READY') {
                if (mode === 'sample-throw') throw Error('TTY_EXPECTED_SAMPLE_EXCEPTION');
                if (mode === 'sample-explicit') process.exit(7);
            }
        };
        await runTerminalSample();
    } else if (mode === 'idle-resize') {
        process.stdout.on('resize', () => {});
        event('done', mode);
    } else {
        process.stdin.setRawMode(true);
        if (mode === 'explicit') process.exit(7);
        if (mode === 'throw') throw Error('TTY_EXPECTED_EXCEPTION');
        if (mode === 'signal' || mode === 'reset-signal') {
            if (mode === 'reset-signal') { os.signal(os.SIGTERM, () => {}); os.signal(os.SIGTERM, null); }
            event('ready', mode); await wait();
        } else {
            assert.equal(mode, 'natural'); event('done', mode);
        }
    }
}
