import * as os from "os";
import { equal, assert, finish } from "./assert.js";

const order = [];
const job = Promise.resolve().then(() => order.push("microtask"));
order.push("sync");
await job;
equal(order.join(","), "sync,microtask");
equal((await Promise.all([Promise.resolve(20), 22])).reduce((a, b) => a + b), 42);
equal(await Promise.any([Promise.reject("ignored"), Promise.resolve(42)]), 42);
equal((await Promise.allSettled([Promise.resolve(1), Promise.reject("expected")]))[1].status, "rejected");

let closed = false;
const iterable = {
    [Symbol.asyncIterator]() { return this; },
    async next() { return { value: 42, done: false }; },
    async return() { await Promise.resolve(); closed = true; return { done: true }; },
};
for await (const value of iterable) { equal(value, 42); break; }
assert(closed, "for-await break must await the iterator's async return() (master regression)");

const start = os.now();
await new Promise(resolve => os.setTimeout(resolve, 20));
assert(os.now() >= start, "monotonic clock");
let canceled = true;
const timer = os.setTimeout(() => { canceled = false; }, 0);
os.clearTimeout(timer);
await new Promise(resolve => os.setTimeout(resolve, 10));
assert(canceled, "clearTimeout");
finish("async");
