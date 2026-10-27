function codedError(Type, code, message) {
    const error = new Type(message);
    error.code = code;
    return error;
}
function invalidType(name, expected) {
    return codedError(TypeError, 'ERR_INVALID_ARG_TYPE', name + ' must be ' + expected);
}
function outOfRange(name) {
    return codedError(RangeError, 'ERR_OUT_OF_RANGE', name + ' is out of range');
}
function integer(value, name, min, max) {
    if (typeof value !== 'number') throw invalidType(name, 'a number');
    if (!Number.isInteger(value) || value < min || value > max) throw outOfRange(name);
    return value;
}
function uint8(value, name = 'buffer') {
    if (!(value instanceof Uint8Array)) throw invalidType(name, 'a Buffer or Uint8Array');
    return value;
}
function isArrayBuffer(value) {
    return value instanceof ArrayBuffer ||
        (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer);
}
function byteView(value) {
    if (isArrayBuffer(value)) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw invalidType('input', 'an ArrayBuffer or ArrayBufferView');
}
