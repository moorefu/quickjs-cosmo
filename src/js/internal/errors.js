function codedError(Type, code, message) {
    const error = new Type(message);
    error.code = code;
    return error;
}
// QuickJS marks WeakMap values strongly, so a value that references its key
// cannot be collected. Keep instance state on its owner. The mutable cell also
// preserves updates/deletion after Object.freeze(owner); owner identity keeps
// inherited properties and transparent proxies from acquiring another brand.
function instanceState(name) {
    const key=Symbol(name),access=Symbol(),brands=new WeakSet();
    function record(owner){if(!brands.has(owner))return undefined;return owner[key](access);}
    return {
        has(owner){return record(owner)?.present??false;},
        get(owner){const cell=record(owner);return cell?.present?cell.value:undefined;},
        set(owner,value){let cell=record(owner);if(!cell){cell={present:true,value};Object.defineProperty(owner,key,{value:secret=>secret===access?cell:undefined});brands.add(owner);}else {cell.present=true;cell.value=value;}return this;},
        delete(owner){const cell=record(owner);if(!cell?.present)return false;cell.present=false;cell.value=undefined;return true;}
    };
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
