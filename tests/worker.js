import * as os from "os";
import * as std from "std";
import { equal, assert, finish } from "./assert.js";

assert(typeof os.Worker === "function", "Worker enabled");
const shared = new SharedArrayBuffer(4);
const view = new Int32Array(shared);
Atomics.store(view, 0, 41);
const worker = new os.Worker("./fixtures/worker.js");
const watchdog = os.setTimeout(() => {
    std.err.puts("FAIL worker timed out\n");
    std.exit(1);
}, 10000);
try {
    const response = await new Promise(resolve => {
        worker.onmessage = ({ data }) => resolve(data);
        worker.postMessage({ value: 21n, bytes: new Uint8Array([1, 2, 3]), shared });
    });
    worker.onmessage = null;
    equal(response.answer, 42n);
    equal(response.bytes.join(","), "3,2,1");
    equal(response.previous, 41);
    equal(Atomics.load(view, 0), 42);
} finally {
    os.clearTimeout(watchdog);
    worker.onmessage = null;
}
finish("worker");
