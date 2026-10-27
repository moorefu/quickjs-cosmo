const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
function promisify(original) {
    if (typeof original !== 'function') throw invalidType('original', 'a function');
    const custom = original[promisifyCustom];
    if (custom !== undefined) {
        if (typeof custom !== 'function') throw invalidType('util.promisify.custom', 'a function');
        Object.defineProperty(custom, promisifyCustom, { value: custom, configurable: true });
        return custom;
    }
    function wrapped(...args) {
        return new Promise((resolve, reject) => {
            Reflect.apply(original, this, [...args, (error, value) => error ? reject(error) : resolve(value)]);
        });
    }
    Object.setPrototypeOf(wrapped, Object.getPrototypeOf(original));
    Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(original));
    Object.defineProperty(wrapped, promisifyCustom, { value: wrapped, configurable: true });
    return wrapped;
}
promisify.custom = promisifyCustom;
const utilAPI = { promisify, TextEncoder, TextDecoder };
