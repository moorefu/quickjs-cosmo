import process,{stdin,stdout,stderr} from 'node:process';import {Readable,Writable} from 'node:stream';
const input:Readable=stdin;const output:Writable=stdout;
stdin.setEncoding('utf8');stdin.ref().unref();stdin.pipe(stdout);stdout.write(new Uint8Array([0,255]),error=>{});stderr.write('error');
const fd:0=process.stdin.fd;
// @ts-expect-error Standard descriptors cannot be reassigned through this API.
process.stdin.fd=5;
// @ts-expect-error TTY raw mode is outside this stdio subset.
stdin.setRawMode(true);
const filename: string | undefined = import.meta.filename;
const directory: string | undefined = import.meta.dirname;
void filename; void directory;
