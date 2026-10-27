const MAX_BUFFER_LENGTH = 0x7fffffff;
const rawSubarray = Uint8Array.prototype.subarray;
const rawSet = Uint8Array.prototype.set;
function asBuffer(bytes) { return Object.setPrototypeOf(bytes, Buffer.prototype); }
function bufferSize(size) {
    if (typeof size !== 'number') throw invalidType('size', 'a number');
    if (!Number.isFinite(size) || size < 0 || size > MAX_BUFFER_LENGTH) throw outOfRange('size');
    return Math.trunc(size);
}
function Buffer(value, encodingOrOffset, length) {
    return typeof value === 'number' ? Buffer.alloc(value) : Buffer.from(value, encodingOrOffset, length);
}
Object.setPrototypeOf(Buffer, Uint8Array);
Buffer.prototype = Object.create(Uint8Array.prototype, { constructor: { value: Buffer, writable: true, configurable: true } });
Buffer.poolSize = 8192;
Buffer.from = function from(value, encodingOrOffset, length) {
    if (typeof value === 'string') {
        const encoding = normalizeEncoding(typeof encodingOrOffset === 'string' ? encodingOrOffset || undefined : undefined);
        return asBuffer(new Uint8Array(encodeString(value, encoding)));
    }
    if (isArrayBuffer(value)) {
        if (value.resizable || value.growable)
            throw codedError(Error, 'ERR_NOT_SUPPORTED', 'Resizable Buffer backing stores are outside the initial subset');
        let offset = +encodingOrOffset;
        if (Number.isNaN(offset)) offset = 0;
        let size = length === undefined ? undefined : +length;
        if (offset > value.byteLength || (size !== undefined && size > value.byteLength - offset))
            throw codedError(RangeError, 'ERR_BUFFER_OUT_OF_BOUNDS', 'Buffer view exceeds its backing store');
        if (size < 0 || Number.isNaN(size)) size = 0;
        return asBuffer(size === undefined ? new Uint8Array(value, offset) : new Uint8Array(value, offset, size));
    }
    if (ArrayBuffer.isView(value)) return asBuffer(new Uint8Array(value));
    if (value !== null && typeof value === 'object') {
        const primitive = typeof value.valueOf === 'function' ? value.valueOf() : value;
        if (primitive !== value && (typeof primitive === 'string' || typeof primitive === 'object'))
            return Buffer.from(primitive, encodingOrOffset, length);
        if (value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
        const size = value.length;
        if (size !== undefined || isArrayBuffer(value.buffer)) {
            const count = typeof size === 'number' && !Number.isNaN(size) ? bufferSize(Math.max(0, size)) : 0;
            const output = asBuffer(new Uint8Array(count));
            for (let i = 0; i < count; i++) output[i] = value[i];
            return output;
        }
        if (typeof value[Symbol.toPrimitive] === 'function')
            return Buffer.from(value[Symbol.toPrimitive]('string'), encodingOrOffset, length);
    }
    throw invalidType('first argument', 'a string, Buffer, ArrayBuffer, Array or array-like object');
};
Buffer.alloc = function alloc(size, fill, encoding) {
    const output = asBuffer(new Uint8Array(bufferSize(size)));
    if (fill !== undefined && output.length) output.fill(fill, 0, output.length, encoding);
    return output;
};
// Zeroing is deliberate: no allocator or process memory is exposed to JavaScript.
Buffer.allocUnsafe = function allocUnsafe(size) { return Buffer.alloc(size); };
Buffer.allocUnsafeSlow = function allocUnsafeSlow(size) { return Buffer.alloc(size); };
Buffer.isBuffer = function isBuffer(value) { return value instanceof Buffer; };
Buffer.isEncoding = function isEncoding(value) {
    return typeof value === 'string' && encodingNames.has(value.toLowerCase());
};
Buffer.byteLength = function byteLength(value, encoding) {
    if (isArrayBuffer(value) || ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof value !== 'string') throw invalidType('string', 'a string or ArrayBufferView');
    encoding = normalizeEncoding(encoding, true);
    if (encoding === 'utf8') return utf8Length(value);
    if (encoding === 'utf16le') return value.length * 2;
    if (encoding === 'hex') return Math.floor(value.length / 2);
    if (encoding === 'base64' || encoding === 'base64url') {
        let size = value.length;
        if (size && value[size - 1] === '=') size--;
        if (size && value[size - 1] === '=') size--;
        return Math.floor(size * 3 / 4);
    }
    return value.length;
};
Buffer.concat = function concat(list, totalLength) {
    if (!Array.isArray(list)) throw invalidType('list', 'an Array');
    if (!list.length) return Buffer.alloc(0);
    if (totalLength === undefined) totalLength = list.reduce((sum, item) => sum + uint8(item, 'list item').length, 0);
    else integer(totalLength, 'length', 0, MAX_BUFFER_LENGTH);
    const output = Buffer.alloc(totalLength);
    let offset = 0;
    for (const item of list) {
        uint8(item, 'list item');
        const count = Math.min(item.length, totalLength - offset);
        if (count > 0) rawSet.call(output, rawSubarray.call(item, 0, count), offset);
        offset += count;
    }
    return output;
};
Buffer.compare = function compare(a, b) {
    uint8(a, 'buf1'); uint8(b, 'buf2');
    for (let i = 0, length = Math.min(a.length, b.length); i < length; i++)
        if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
};
Buffer.copyBytesFrom = function copyBytesFrom(view, offset = 0, length) {
    if (!ArrayBuffer.isView(view) || view instanceof DataView) throw invalidType('view', 'a TypedArray');
    integer(offset, 'offset', 0, Number.MAX_SAFE_INTEGER);
    if (length === undefined) length = Math.max(0, view.length - offset);
    else integer(length, 'length', 0, Number.MAX_SAFE_INTEGER);
    const first = Math.min(offset, view.length), count = Math.min(length, view.length - first);
    return Buffer.from(new Uint8Array(view.buffer, view.byteOffset + first * view.BYTES_PER_ELEMENT, count * view.BYTES_PER_ELEMENT));
};
function clampedIndex(value, length, defaultValue) {
    if (value === undefined) return defaultValue;
    value = +value;
    if (Number.isNaN(value) || value < 0) return 0;
    return Math.min(Math.trunc(value), length);
}
Object.defineProperties(Buffer.prototype, {
    parent: { get() { return this.buffer; }, enumerable: true },
    offset: { get() { return this.byteOffset; }, enumerable: true }
});
Buffer.prototype.toString = function toString(encoding, start, end) {
    start = clampedIndex(start, this.length, 0);
    end = clampedIndex(end, this.length, this.length);
    if (end <= start) return '';
    return decodeBytes(rawSubarray.call(this, start, end), normalizeEncoding(encoding));
};
Buffer.prototype.toJSON = function toJSON() { return { type: 'Buffer', data: Array.from(this) }; };
Buffer.prototype.equals = function equals(other) { return Buffer.compare(this, other) === 0; };
Buffer.prototype.compare = function compare(target, targetStart = 0, targetEnd, sourceStart = 0, sourceEnd = this.length) {
    uint8(target, 'target');
    if (targetEnd === undefined) targetEnd = target.length;
    integer(targetStart, 'targetStart', 0, 0x100000000);
    integer(targetEnd, 'targetEnd', 0, target.length);
    integer(sourceStart, 'sourceStart', 0, 0x100000000);
    integer(sourceEnd, 'sourceEnd', 0, this.length);
    return Buffer.compare(rawSubarray.call(this, sourceStart, Math.max(sourceStart, sourceEnd)),
                          rawSubarray.call(target, targetStart, Math.max(targetStart, targetEnd)));
};
Buffer.prototype.subarray = function subarray(start, end) {
    return asBuffer(rawSubarray.call(this, start, end));
};
Buffer.prototype.slice = function slice(start, end) { return this.subarray(start, end); };
Buffer.prototype.copy = function copy(target, targetStart = 0, sourceStart = 0, sourceEnd = this.length) {
    uint8(target, 'target');
    const index = value => Number.isFinite(+value) ? Math.trunc(+value) : 0;
    targetStart = index(targetStart);
    sourceStart = index(sourceStart);
    sourceEnd = index(sourceEnd);
    if (targetStart < 0 || sourceStart < 0 || sourceEnd < 0 || sourceStart > this.length) throw outOfRange('offset');
    const count = Math.max(0, Math.min(sourceEnd, this.length) - sourceStart);
    const copied = Math.max(0, Math.min(count, target.length - targetStart));
    if (copied) rawSet.call(target, rawSubarray.call(this, sourceStart, sourceStart + copied), targetStart);
    return copied;
};
Buffer.prototype.fill = function fill(value, offset = 0, end = this.length, encoding) {
    if (typeof value === 'string') {
        if (typeof offset === 'string') { encoding = offset; offset = 0; end = this.length; }
        else if (typeof end === 'string') { encoding = end; end = this.length; }
        if (encoding != null && typeof encoding !== 'string') throw invalidType('encoding', 'a string');
        encoding = normalizeEncoding(encoding || undefined);
    }
    integer(offset, 'offset', 0, MAX_BUFFER_LENGTH);
    integer(end, 'end', 0, this.length);
    if (offset >= end) return this;
    if (typeof value !== 'string' && !(value instanceof Uint8Array)) {
        Uint8Array.prototype.fill.call(this, Number(value) & 255, offset, end);
        return this;
    }
    if (value === '') { Uint8Array.prototype.fill.call(this, 0, offset, end); return this; }
    const pattern = typeof value === 'string' ? encodeString(value, encoding) : value;
    if (!pattern.length) throw codedError(TypeError, 'ERR_INVALID_ARG_VALUE', 'The fill pattern is empty');
    // Snapshot first: an overlapping pattern must not change while filling.
    const bytes = new Uint8Array(pattern);
    for (let i = offset; i < end; i++) this[i] = bytes[(i - offset) % bytes.length];
    return this;
};
Buffer.prototype.write = function write(string, offset = 0, length = this.length - (typeof offset === 'number' ? offset : 0), encoding) {
    if (typeof string !== 'string') throw invalidType('string', 'a string');
    if (typeof offset === 'string') { encoding = offset; offset = 0; length = this.length; }
    else if (typeof length === 'string') { encoding = length; length = this.length - offset; }
    integer(offset, 'offset', 0, this.length);
    integer(length, 'length', 0, MAX_BUFFER_LENGTH);
    length = Math.min(length, this.length - offset);
    encoding = normalizeEncoding(encoding || undefined);
    const output = rawSubarray.call(this, offset, offset + length);
    if (encoding === 'utf8') return encodeUtf8Into(string, output).written;
    const bytes = encodeString(string, encoding);
    let count = Math.min(bytes.length, length);
    if (encoding === 'utf16le') count -= count % 2;
    rawSet.call(output, bytes.subarray(0, count));
    return count;
};
function checkOffset(buffer, offset, size) {
    if (typeof offset !== 'number') throw invalidType('offset', 'a number');
    if (!Number.isInteger(offset)) throw outOfRange('offset');
    if (size > buffer.length) throw codedError(RangeError, 'ERR_BUFFER_OUT_OF_BOUNDS', 'Buffer is too small');
    if (offset < 0 || offset > buffer.length - size) throw outOfRange('offset');
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
for (const [name, type, size, signed] of [
    ['UInt8', 'Uint8', 1, false], ['Int8', 'Int8', 1, true],
    ['UInt16', 'Uint16', 2, false], ['Int16', 'Int16', 2, true],
    ['UInt32', 'Uint32', 4, false], ['Int32', 'Int32', 4, true],
    ['Float', 'Float32', 4, null], ['Double', 'Float64', 8, null],
    ['BigUInt64', 'BigUint64', 8, false], ['BigInt64', 'BigInt64', 8, true]
]) {
    for (const suffix of size === 1 ? [''] : ['LE', 'BE']) {
        const little = suffix !== 'BE', big = name.startsWith('Big');
        Buffer.prototype['read' + name + suffix] = function read(offset = 0) {
            return checkOffset(this, offset, size)['get' + type](offset, little);
        };
        Buffer.prototype['write' + name + suffix] = function write(value, offset = 0) {
            const view = checkOffset(this, offset, size);
            if (big) {
                if (typeof value !== 'bigint') throw new TypeError('Cannot mix BigInt and other types');
                const min = signed ? -(1n << 63n) : 0n;
                const max = signed ? (1n << 63n) - 1n : (1n << 64n) - 1n;
                if (value < min || value > max) throw outOfRange('value');
            } else {
                value = +value;
                if (signed !== null) {
                    const min = signed ? -(2 ** (size * 8 - 1)) : 0;
                    const max = signed ? 2 ** (size * 8 - 1) - 1 : 2 ** (size * 8) - 1;
                    if (value < min || value > max) throw outOfRange('value');
                }
            }
            view['set' + type](offset, value, little);
            return offset + size;
        };
        if (name.includes('UInt')) {
            Buffer.prototype['read' + name.replace('UInt', 'Uint') + suffix] = Buffer.prototype['read' + name + suffix];
            Buffer.prototype['write' + name.replace('UInt', 'Uint') + suffix] = Buffer.prototype['write' + name + suffix];
        }
    }
}
for (const signed of [false, true]) for (const little of [false, true]) {
    const suffix = (signed ? 'Int' : 'UInt') + (little ? 'LE' : 'BE');
    Buffer.prototype['read' + suffix] = function read(offset, byteLength) {
        integer(byteLength, 'byteLength', 1, 6);
        checkOffset(this, offset, byteLength);
        let value = 0;
        for (let i = 0; i < byteLength; i++) value = value * 256 + this[offset + (little ? byteLength - 1 - i : i)];
        if (signed && value >= 2 ** (byteLength * 8 - 1)) value -= 2 ** (byteLength * 8);
        return value;
    };
    Buffer.prototype['write' + suffix] = function write(value, offset, byteLength) {
        integer(byteLength, 'byteLength', 1, 6);
        checkOffset(this, offset, byteLength);
        value = +value;
        const min = signed ? -(2 ** (byteLength * 8 - 1)) : 0;
        const max = signed ? 2 ** (byteLength * 8 - 1) - 1 : 2 ** (byteLength * 8) - 1;
        if (value < min || value > max) throw outOfRange('value');
        if (value < 0) value += 2 ** (byteLength * 8);
        for (let i = 0; i < byteLength; i++) {
            this[offset + (little ? i : byteLength - 1 - i)] = value & 255;
            value = Math.floor(value / 256);
        }
        return offset + byteLength;
    };
    if (!signed) {
        Buffer.prototype['read' + suffix.replace('UInt', 'Uint')] = Buffer.prototype['read' + suffix];
        Buffer.prototype['write' + suffix.replace('UInt', 'Uint')] = Buffer.prototype['write' + suffix];
    }
}
function search(buffer, value, offset, encoding, backwards) {
    if (typeof offset === 'string') { encoding = offset; offset = undefined; }
    let step = 1;
    if (typeof value === 'number') value = new Uint8Array([value]);
    else if (typeof value === 'string') {
        encoding = normalizeEncoding(encoding);
        value = encodeString(value, encoding);
        if (encoding === 'utf16le') step = 2;
    } else {
        uint8(value, 'value');
        if (encoding !== undefined && normalizeEncoding(encoding) === 'utf16le') step = 2;
    }
    offset = offset === undefined ? (backwards ? buffer.length : 0) : +offset;
    if (Number.isNaN(offset)) offset = backwards ? buffer.length : 0;
    offset = Math.trunc(offset);
    if (offset < 0) offset += buffer.length;
    if (!value.length) return Math.max(0, Math.min(offset, buffer.length));
    if (backwards && offset < 0) return -1;
    offset = Math.max(0, offset);
    if (backwards) offset = Math.min(offset, buffer.length - value.length);
    if (step === 2) {
        if (value.length < 2 || buffer.length < 2) return -1;
        offset -= offset % 2;
    }
    for (let i = offset; i >= 0 && i + value.length <= buffer.length; i += backwards ? -step : step) {
        let matches = true;
        for (let j = 0; j < value.length; j++) if (buffer[i + j] !== value[j]) { matches = false; break; }
        if (matches) return i;
    }
    return -1;
}
Buffer.prototype.indexOf = function indexOf(value, offset, encoding) { return search(this, value, offset, encoding, false); };
Buffer.prototype.lastIndexOf = function lastIndexOf(value, offset, encoding) { return search(this, value, offset, encoding, true); };
Buffer.prototype.includes = function includes(value, offset, encoding) { return this.indexOf(value, offset, encoding) !== -1; };
for (const size of [2, 4, 8]) Buffer.prototype['swap' + size * 8] = function swap() {
    if (this.length % size) throw codedError(RangeError, 'ERR_INVALID_BUFFER_SIZE', 'Buffer size must be a multiple of ' + size);
    for (let offset = 0; offset < this.length; offset += size)
        for (let i = 0; i < size / 2; i++) {
            const other = offset + size - 1 - i, byte = this[offset + i];
            this[offset + i] = this[other]; this[other] = byte;
        }
    return this;
};
function SlowBuffer(length) { return Buffer.alloc(+length || 0); }
const bufferAPI = { Buffer, SlowBuffer, kMaxLength: MAX_BUFFER_LENGTH, kStringMaxLength: 0x3fffffff,
                    constants: Object.freeze({ MAX_LENGTH: MAX_BUFFER_LENGTH, MAX_STRING_LENGTH: 0x3fffffff }) };
Object.defineProperties(globalThis, {
    Buffer: { value: Buffer, writable: true, configurable: true },
    TextEncoder: { value: TextEncoder, writable: true, configurable: true },
    TextDecoder: { value: TextDecoder, writable: true, configurable: true }
});
return { ...bufferAPI, default: bufferAPI };
