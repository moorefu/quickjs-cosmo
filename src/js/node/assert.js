class AssertionError extends Error {
    constructor(options) {
        super(options.message ?? 'Assertion failed');
        this.name = 'AssertionError'; this.code = 'ERR_ASSERTION';
        this.actual = options.actual; this.expected = options.expected;
        this.operator = options.operator; this.generatedMessage = options.message === undefined;
    }
}
function assertionFailure(actual, expected, operator, message) {
    if (message instanceof Error) throw message;
    throw new AssertionError({ actual, expected, operator, message });
}
function assert(value, message) { if (!value) assertionFailure(value, true, '==', message); }
assert.ok = assert;
assert.equal = function equal(actual, expected, message) {
    if (actual != expected && !(Number.isNaN(actual) && Number.isNaN(expected))) assertionFailure(actual, expected, '==', message);
};
assert.notEqual = function notEqual(actual, expected, message) {
    if (actual == expected || (Number.isNaN(actual) && Number.isNaN(expected))) assertionFailure(actual, expected, '!=', message);
};
assert.strictEqual = function strictEqual(actual, expected, message) { if (!Object.is(actual, expected)) assertionFailure(actual, expected, 'strictEqual', message); };
assert.notStrictEqual = function notStrictEqual(actual, expected, message) { if (Object.is(actual, expected)) assertionFailure(actual, expected, 'notStrictEqual', message); };
function matchesError(error, expected) {
    if (expected === undefined) return true;
    if (expected instanceof RegExp) return expected.test(String(error));
    if (typeof expected === 'function') {
        if (expected === Error || expected.prototype instanceof Error) return error instanceof expected;
        return Reflect.apply(expected, {}, [error]) === true;
    }
    if (expected !== null && typeof expected === 'object') {
        const keys = Object.keys(expected);
        if (!keys.length) throw codedError(TypeError, 'ERR_INVALID_ARG_VALUE', 'Expected error criteria cannot be empty');
        return error != null && keys.every(key => expected[key] instanceof RegExp && typeof error[key] === 'string' ?
            expected[key].test(error[key]) : Object.is(error[key], expected[key]));
    }
    throw invalidType('error', 'a function, RegExp or object');
}
function validateExpected(expected, message, actual) {
    if (typeof expected === 'string') {
        if (message !== undefined) throw invalidType('error', 'a function, RegExp or object');
        if (actual?.message === expected) throw codedError(TypeError, 'ERR_AMBIGUOUS_ARGUMENT', 'The error criteria are ambiguous');
        return { expected: undefined, message: expected };
    }
    return { expected, message };
}
assert.throws = function throws(block, expected, message) {
    if (typeof block !== 'function') throw invalidType('fn', 'a function');
    let actual, thrown = false;
    try { block(); } catch (error) { actual = error; thrown = true; }
    ({ expected, message } = validateExpected(expected, message, actual));
    if (!thrown || !matchesError(actual, expected)) assertionFailure(actual, expected, 'throws', message);
};
assert.rejects = async function rejects(block, expected, message) {
    let promise = block;
    if (typeof block === 'function') {
        promise = block();
        if (!promise || typeof promise.then !== 'function')
            throw codedError(TypeError, 'ERR_INVALID_RETURN_VALUE', 'The function must return a Promise');
    } else if (!promise || typeof promise.then !== 'function') throw invalidType('promiseFn', 'a function or Promise');
    let actual, rejected = false;
    try { await promise; } catch (error) { actual = error; rejected = true; }
    ({ expected, message } = validateExpected(expected, message, actual));
    if (!rejected || !matchesError(actual, expected)) assertionFailure(actual, expected, 'rejects', message);
};
assert.fail = function fail(message) { assertionFailure(undefined, undefined, 'fail', message); };
assert.AssertionError = AssertionError;
function strictAssert(value, message) { return assert(value, message); }
Object.assign(strictAssert, assert, { ok: strictAssert, equal: assert.strictEqual, notEqual: assert.notStrictEqual });
strictAssert.strict = strictAssert;
assert.strict = strictAssert;
function assertionExports(fn) {
    const exported = { default: fn };
    for (const key of Object.keys(fn)) exported[key] = fn[key];
    return exported;
}
