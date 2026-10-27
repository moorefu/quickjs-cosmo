import * as std from 'std';
import { runtimeInfo } from 'cosmo:runtime';

let retained = [];
let failure;
try {
    for (;;) retained.push(runtimeInfo());
} catch (error) {
    failure = error.name;
}
retained = null;
std.gc();
if (failure !== 'InternalError') throw Error('Expected a clean allocation failure, got ' + failure);
if (runtimeInfo().engine !== 'quickjs') throw Error('Metadata failed after releasing retained objects');
print('PASS runtime-metadata-oom');
