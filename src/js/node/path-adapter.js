function createPathEnvironment(process) {
    const uncurry = method => Function.prototype.call.bind(method);
    const primordials = {};
    for (const [name, prototype, methods] of [
        ['Array', Array.prototype, ['includes', 'join', 'push', 'slice']],
        ['String', String.prototype, ['charCodeAt', 'includes', 'indexOf', 'lastIndexOf', 'repeat', 'replace', 'slice', 'split', 'toLowerCase', 'toUpperCase']],
        ['Function', Function.prototype, ['bind']]
    ]) for (const method of methods)
        primordials[name + 'Prototype' + method[0].toUpperCase() + method.slice(1)] = uncurry(prototype[method]);
    const constants = { CHAR_UPPERCASE_A: 65, CHAR_LOWERCASE_A: 97, CHAR_UPPERCASE_Z: 90,
        CHAR_LOWERCASE_Z: 122, CHAR_DOT: 46, CHAR_FORWARD_SLASH: 47, CHAR_BACKWARD_SLASH: 92,
        CHAR_COLON: 58, CHAR_QUESTION_MARK: 63 };
    const validators = {
        validateString(value, name) { if (typeof value !== 'string') throw invalidType(name, 'a string'); },
        validateObject(value, name) {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidType(name, 'an object');
        }
    };
    const internalUtil = { isWindows: process.platform === 'win32', getLazy(factory) {
        let value;
        return () => value ??= factory();
    } };
    return { primordials, require(name) {
        if (name === 'internal/constants') return constants;
        if (name === 'internal/validators') return validators;
        if (name === 'internal/util') return internalUtil;
        throw codedError(Error, 'ERR_NOT_SUPPORTED', 'Internal dependency unavailable: ' + name);
    } };
}
