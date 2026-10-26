let checks = 0;

export function assert(condition, message = "assertion failed") {
    checks++;
    if (!condition) throw new Error(message);
}

export function equal(actual, expected, message = "values differ") {
    assert(Object.is(actual, expected), `${message}: got ${String(actual)}, expected ${String(expected)}`);
}

export function throws(fn, constructor = Error) {
    let error;
    try { fn(); } catch (caught) { error = caught; }
    assert(error instanceof constructor, `expected ${constructor.name}`);
}

export function finish(name) {
    print(`PASS ${name} (${checks} assertions)`);
}
