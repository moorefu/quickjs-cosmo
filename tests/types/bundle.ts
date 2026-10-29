import { resolve, readFileSync, readTextSync } from 'cosmo:bundle';
import type { Buffer } from 'node:buffer';
const address:string=resolve('./resource.bin',import.meta.url);
const bytes:Buffer=readFileSync(address);
const text:string=readTextSync(address);
void [bytes,text];
// @ts-expect-error Bundle addresses are strings.
readFileSync(new URL('file:///tmp/x'));
// @ts-expect-error Resolution requires an explicit bundle base.
resolve('./x');
// @ts-expect-error Resource text is returned synchronously.
const promise:Promise<string>=readTextSync(address);
