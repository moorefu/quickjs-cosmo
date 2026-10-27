import process from 'node:process';
import * as imported from './foundation-import.mjs';
console.log('NODE_COMPAT_RESULT ' + JSON.stringify({ pid: process.pid, ppid: process.ppid,
    execPath: process.execPath, argv: process.argv, execArgv: process.execArgv, cwd: process.cwd(),
    url: import.meta.url, main: import.meta.main, importedMain: imported.main, importedURL: imported.url }));
