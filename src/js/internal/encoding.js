const encodingNames = new Map([
    ['utf8', 'utf8'], ['utf-8', 'utf8'], ['utf16le', 'utf16le'], ['utf-16le', 'utf16le'],
    ['ucs2', 'utf16le'], ['ucs-2', 'utf16le'], ['latin1', 'latin1'], ['binary', 'latin1'],
    ['ascii', 'ascii'], ['hex', 'hex'], ['base64', 'base64'], ['base64url', 'base64url']
]);
function normalizeEncoding(name, fallback = false) {
    const encoding = typeof name === 'string' ? encodingNames.get(name.toLowerCase()) : undefined;
    if (encoding) return encoding;
    if (name === undefined || fallback) return 'utf8';
    throw codedError(TypeError, 'ERR_UNKNOWN_ENCODING', 'Unknown encoding: ' + String(name));
}
function utf8Length(text) {
    let size = 0;
    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i);
        if (unit < 128) size++;
        else if (unit < 2048) size += 2;
        else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length &&
                 text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
            size += 4; i++;
        } else size += 3;
    }
    return size;
}
function encodeUtf8Into(text, output) {
    let read = 0, written = 0;
    while (read < text.length) {
        let code = text.charCodeAt(read), units = 1;
        if (code >= 0xd800 && code <= 0xdbff) {
            const low = text.charCodeAt(read + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00; units = 2;
            } else code = 0xfffd;
        } else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd;
        const count = code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
        if (written + count > output.length) break;
        if (count === 1) output[written++] = code;
        else {
            if (count === 2) output[written++] = 0xc0 | (code >> 6);
            else if (count === 3) {
                output[written++] = 0xe0 | (code >> 12);
                output[written++] = 0x80 | ((code >> 6) & 63);
            } else {
                output[written++] = 0xf0 | (code >> 18);
                output[written++] = 0x80 | ((code >> 12) & 63);
                output[written++] = 0x80 | ((code >> 6) & 63);
            }
            output[written++] = 0x80 | (code & 63);
        }
        read += units;
    }
    return { read, written };
}
function invalidEncodedData() {
    return codedError(TypeError, 'ERR_ENCODING_INVALID_ENCODED_DATA', 'Invalid encoded data');
}
function decodeUtf8(bytes, stream = false, fatal = false) {
    const output = [];
    let position = 0;
    while (position < bytes.length) {
        const first = bytes[position];
        if (first < 128) { output.push(String.fromCharCode(first)); position++; continue; }
        let count, code;
        if (first >= 0xc2 && first <= 0xdf) { count = 2; code = first & 31; }
        else if (first >= 0xe0 && first <= 0xef) { count = 3; code = first & 15; }
        else if (first >= 0xf0 && first <= 0xf4) { count = 4; code = first & 7; }
        else {
            if (fatal) throw invalidEncodedData();
            output.push('\ufffd'); position++; continue;
        }
        let consumed = 1;
        for (; consumed < count && position + consumed < bytes.length; consumed++) {
            const next = bytes[position + consumed];
            let min = 0x80, max = 0xbf;
            if (consumed === 1) {
                if (first === 0xe0) min = 0xa0;
                if (first === 0xed) max = 0x9f;
                if (first === 0xf0) min = 0x90;
                if (first === 0xf4) max = 0x8f;
            }
            if (next < min || next > max) break;
            code = (code << 6) | (next & 63);
        }
        if (consumed !== count) {
            if (position + consumed === bytes.length && stream) break;
            if (fatal) throw invalidEncodedData();
            output.push('\ufffd'); position += consumed;
        } else { output.push(String.fromCodePoint(code)); position += count; }
    }
    return { text: output.join(''), read: position };
}
const b64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64Value(unit) {
    if (unit >= 65 && unit <= 90) return unit - 65;
    if (unit >= 97 && unit <= 122) return unit - 71;
    if (unit >= 48 && unit <= 57) return unit + 4;
    if (unit === 43 || unit === 45) return 62;
    if (unit === 47 || unit === 95) return 63;
    return -1;
}
function hexValue(unit) {
    if (unit >= 48 && unit <= 57) return unit - 48;
    if (unit >= 65 && unit <= 70) return unit - 55;
    if (unit >= 97 && unit <= 102) return unit - 87;
    return -1;
}
function encodeString(text, encoding) {
    if (encoding === 'utf8') {
        const output = new Uint8Array(utf8Length(text));
        encodeUtf8Into(text, output);
        return output;
    }
    if (encoding === 'hex') {
        const output = new Uint8Array(Math.floor(text.length / 2));
        let written = 0;
        for (; written < output.length; written++) {
            const high = hexValue(text.charCodeAt(written * 2) & 255);
            const low = hexValue(text.charCodeAt(written * 2 + 1) & 255);
            if (high < 0 || low < 0) break;
            output[written] = (high << 4) | low;
        }
        return output.subarray(0, written);
    }
    if (encoding === 'base64' || encoding === 'base64url') {
        const output = new Uint8Array(Math.floor(text.length * 3 / 4));
        let accumulator = 0, bits = 0, written = 0;
        for (let i = 0; i < text.length; i++) {
            const unit = text.charCodeAt(i) & 255;
            if (unit === 61) break;
            const value = base64Value(unit);
            if (value < 0) continue;
            accumulator = (accumulator << 6) | value;
            bits += 6;
            if (bits >= 8) { bits -= 8; output[written++] = (accumulator >> bits) & 255; }
        }
        return output.subarray(0, written);
    }
    const wide = encoding === 'utf16le';
    const output = new Uint8Array(text.length * (wide ? 2 : 1));
    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i);
        output[i * (wide ? 2 : 1)] = unit;
        if (wide) output[i * 2 + 1] = unit >> 8;
    }
    return output;
}
function decodeBytes(bytes, encoding) {
    if (encoding === 'utf8') return decodeUtf8(bytes).text;
    const output = [];
    if (encoding === 'hex') {
        for (const byte of bytes) output.push(byte.toString(16).padStart(2, '0'));
    } else if (encoding === 'base64' || encoding === 'base64url') {
        for (let i = 0; i < bytes.length; i += 3) {
            const count = Math.min(3, bytes.length - i);
            const value = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
            output.push(b64Alphabet[value >>> 18], b64Alphabet[(value >>> 12) & 63],
                        count > 1 ? b64Alphabet[(value >>> 6) & 63] : '=',
                        count > 2 ? b64Alphabet[value & 63] : '=');
        }
        const encoded = output.join('');
        return encoding === 'base64url' ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded;
    } else if (encoding === 'utf16le') {
        for (let i = 0; i + 1 < bytes.length; i += 2)
            output.push(String.fromCharCode(bytes[i] | (bytes[i + 1] << 8)));
    } else {
        const mask = encoding === 'ascii' ? 127 : 255;
        for (const byte of bytes) output.push(String.fromCharCode(byte & mask));
    }
    return output.join('');
}
class TextEncoder {
    get encoding() { return 'utf-8'; }
    encode(input = '') {
        if (typeof input === 'symbol') throw new TypeError('Cannot convert a Symbol to a string');
        return encodeString(String(input), 'utf8');
    }
    encodeInto(source, destination) {
        if (typeof source !== 'string') throw invalidType('src', 'a string');
        uint8(destination, 'dest');
        return encodeUtf8Into(source, destination);
    }
    get [Symbol.toStringTag]() { return 'TextEncoder'; }
}
function decodeUtf16(bytes, little, stream, fatal) {
    const output = [];
    let i = 0;
    const unitAt = index => little ? bytes[index] | (bytes[index + 1] << 8) : (bytes[index] << 8) | bytes[index + 1];
    while (i + 1 < bytes.length) {
        const unit = unitAt(i);
        if (unit >= 0xd800 && unit <= 0xdbff) {
            if (i + 3 >= bytes.length && stream) break;
            const low = i + 3 < bytes.length ? unitAt(i + 2) : 0;
            if (low >= 0xdc00 && low <= 0xdfff) {
                output.push(String.fromCharCode(unit, low)); i += 4; continue;
            }
            if (fatal) throw invalidEncodedData();
            output.push('\ufffd'); i += 2;
        } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            if (fatal) throw invalidEncodedData();
            output.push('\ufffd'); i += 2;
        } else { output.push(String.fromCharCode(unit)); i += 2; }
    }
    if (i < bytes.length && !stream) {
        if (fatal) throw invalidEncodedData();
        output.push('\ufffd'); i = bytes.length;
    }
    return { text: output.join(''), read: i };
}
const windows1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021,
    0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
    0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
    0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];
class TextDecoder {
    #encoding; #fatal; #ignoreBOM; #pending = new Uint8Array(); #bomSeen = false;
    constructor(label = 'utf-8', options = {}) {
        if (options !== null && typeof options !== 'object') throw invalidType('options', 'an object');
        const name = String(label).trim().toLowerCase();
        if (['utf-8', 'utf8', 'unicode-1-1-utf-8'].includes(name)) this.#encoding = 'utf-8';
        else if (['utf-16', 'utf-16le', 'ucs-2', 'unicode'].includes(name)) this.#encoding = 'utf-16le';
        else if (name === 'utf-16be') this.#encoding = name;
        else if (['ascii', 'us-ascii', 'latin1', 'iso-8859-1', 'windows-1252'].includes(name)) this.#encoding = 'windows-1252';
        else throw codedError(RangeError, 'ERR_ENCODING_NOT_SUPPORTED', 'Unsupported encoding: ' + name);
        this.#fatal = !!options?.fatal;
        this.#ignoreBOM = !!options?.ignoreBOM;
    }
    get encoding() { return this.#encoding; }
    get fatal() { return this.#fatal; }
    get ignoreBOM() { return this.#ignoreBOM; }
    decode(input = new Uint8Array(), options = {}) {
        if (options !== null && typeof options !== 'object') throw invalidType('options', 'an object');
        const next = byteView(input), stream = !!options?.stream;
        const bytes = new Uint8Array(this.#pending.length + next.length);
        bytes.set(this.#pending); bytes.set(next, this.#pending.length);
        try {
            let decoded;
            if (this.#encoding === 'utf-8') decoded = decodeUtf8(bytes, stream, this.#fatal);
            else if (this.#encoding.startsWith('utf-16'))
                decoded = decodeUtf16(bytes, this.#encoding === 'utf-16le', stream, this.#fatal);
            else decoded = { text: Array.from(bytes, b => String.fromCharCode(b >= 128 && b < 160 ? windows1252[b - 128] : b)).join(''), read: bytes.length };
            this.#pending = bytes.slice(decoded.read);
            let text = decoded.text;
            if (!this.#bomSeen && text.length) {
                this.#bomSeen = true;
                if (!this.#ignoreBOM && this.#encoding !== 'windows-1252' && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
            }
            if (!stream) { this.#pending = new Uint8Array(); this.#bomSeen = false; }
            return text;
        } catch (error) {
            this.#pending = new Uint8Array(); this.#bomSeen = false;
            throw error;
        }
    }
    get [Symbol.toStringTag]() { return 'TextDecoder'; }
}
