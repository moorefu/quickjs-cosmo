import * as std from 'std';
import { runtimeInfo } from 'cosmo:runtime';

let retained = [];
let reserve = new ArrayBuffer(64 * 1024);
let failure;
let caught = false;
try {
    for (;;) retained.push(runtimeInfo());
} catch (error) {
    // Recover headroom before any further call or inspection of the exception.
    reserve = null;
    retained = null;
    failure = error;
    caught = true;
}
std.gc();
// QuickJS's JS_ThrowError2 explicitly throws null if even the Error allocation fails.
if (!caught || (failure !== null && failure.name !== 'InternalError'))
    throw Error('Expected an allocation failure, got ' + failure);
if (runtimeInfo().engine !== 'quickjs') throw Error('Metadata failed after releasing retained objects');
if (Buffer.from('abc').toString() !== 'abc' || process.cwd().length === 0)
    throw Error('Native context state was lost across memory recovery');
print('PASS runtime-metadata-oom');
