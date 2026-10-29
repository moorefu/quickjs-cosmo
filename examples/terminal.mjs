import process from 'node:process';
import {writeSync} from 'node:fs';
import readline from 'node:readline';
import * as os from 'qjs:os';

// The application owns these display changes; the runtime owns raw modes.
export async function runTerminalSample() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log('Terminal sample: use an interactive terminal; q exits.');
        return;
    }
    const input = process.stdin, wasRaw = input.isRaw;
    let finish, cleaned = false;
    const done = new Promise(resolve => { finish = resolve; });
    const write = text => writeSync(1, text);
    function cleanup() {
        if (cleaned) return;
        cleaned = true;
        input.removeListener('keypress', key);
        input.pause();
        // Windows raw mode may have enabled VT output. Finish owned display
        // commands before restoring a host's original VT-disabled mode.
        try { write('\x1b[0m\x1b[?25h\x1b[?1049l'); }
        finally { input.setRawMode(wasRaw); }
    }
    function key(text, value) {
        if (text === 'q' || value.ctrl && value.name === 'c') finish();
        else write('\r\x1b[2KKey: ' + (value.name ?? text ?? 'unknown'));
    }
    const signals = [os.SIGINT, os.SIGTERM, os.SIGHUP];
    try {
        for (const number of signals) os.signal(number, () => finish());
        process.once('exit', cleanup);
        input.setRawMode(true);
        readline.emitKeypressEvents(input);
        input.on('keypress', key);
        write('\x1b[?1049h\x1b[?25l\x1b[7mTerminal sample: q / Ctrl-C exits\x1b[0m\r\n');
        if (process.env.QJS_TERMINAL_CASE) console.log('TTY_SAMPLE_READY');
        await done;
    } finally {
        cleanup();
        process.removeListener('exit', cleanup);
        for (const number of signals) os.signal(number, null);
    }
}
if (import.meta.main) await runTerminalSample();
