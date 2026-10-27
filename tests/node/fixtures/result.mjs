export function check(condition, message) {
    if (!condition) throw new Error(message);
}

export function result(value) {
    console.log('NODE_COMPAT_RESULT ' + JSON.stringify(value));
}

export function errorOf(call) {
    try { call(); } catch (error) {
        return { name: error.name, code: error.code ?? null };
    }
    throw new Error('Expected operation to throw');
}
