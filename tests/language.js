import { assert, equal, throws, finish } from "./assert.js";

class Counter {
    #value = 0;
    add(value = 1) { return this.#value += value; }
}
const counter = new Counter();
equal(counter.add(), 1);
equal(counter.add(41), 42);
equal(({ nested: { answer: 42 } }).nested?.answer ?? 0, 42);
equal(null?.value ?? "fallback", "fallback");
const { a, ...rest } = { a: 1, b: 2, c: 3 };
equal(a, 1);
equal(JSON.stringify(rest), '{"b":2,"c":3}');
equal((2n ** 100n).toString(), "1267650600228229401496703205376");
equal(BigInt.asIntN(8, 255n), -1n);
const map = new Map([["x", 1], ["y", 2]]);
equal(map.get("y"), 2);
equal(new Set([1, 2, 2, 3]).size, 3);
equal([...map.keys()].join(","), "x,y");
const view = new DataView(new ArrayBuffer(16));
view.setBigUint64(0, 0x0102030405060708n, true);
equal(view.getUint8(0), 8);
equal(view.getBigUint64(0, true), 0x0102030405060708n);
view.setFloat64(8, Math.PI);
equal(view.getFloat64(8), Math.PI);
equal("e\u0301".normalize("NFC"), "é");
equal([..."你好🌏"].length, 3);
assert(/\p{Script=Han}+/u.test("中文"));
equal(/(?<=item:)\d+/.exec("item:42")[0], "42");
equal("a1b22".replaceAll(/\d+/g, "#"), "a#b#");
function* fibonacci() {
    let a = 0, b = 1;
    while (true) { yield a; [a, b] = [b, a + b]; }
}
const iterator = fibonacci();
equal(Array.from({ length: 8 }, () => iterator.next().value).join(","), "0,1,1,2,3,5,8,13");
const proxy = new Proxy({ value: 21 }, { get: (target, key) => target[key] * 2 });
equal(proxy.value, 42);
equal(Reflect.ownKeys({ [Symbol.for("key")]: true }).length, 1);
throws(() => JSON.parse("{"), SyntaxError);
throws(() => { throw new RangeError("expected"); }, RangeError);
equal(eval("6 * 7"), 42);
finish("language");
