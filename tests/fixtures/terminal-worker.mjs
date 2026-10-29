import * as os from 'qjs:os';
import process from 'node:process';
import tty from 'node:tty';
import readline from 'node:readline';
os.Worker.parent.onmessage = () => {
    const codes = [];
    for (const call of [() => os.ttySetRaw(0), () => process.stdin.setRawMode(true)]) {
        try { call(); codes.push(null); } catch (error) { codes.push(error.code); }
    }
    os.Worker.parent.postMessage({codes, modules: typeof tty.isatty === 'function' && typeof readline.createInterface === 'function'});
    os.Worker.parent.onmessage = null;
};
