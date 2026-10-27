function createCrypto(native) {
    const binding = native.crypto;
    const algorithms = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'blake2b512'];
    const sizes = [16, 20, 28, 32, 48, 64, 64];
    const states = new WeakMap();
    const empty = new ArrayBuffer(0);
    function algorithmId(name, keyed = false) {
        if (typeof name !== 'string') throw invalidType('algorithm', 'a string');
        const lower = name.toLowerCase();
        let normalized = lower.startsWith('rsa-') ? lower.slice(4) : lower;
        if (/^sha-?(1|224|256|384|512)$/.test(normalized)) normalized = normalized.replace('-', '');
        if (/^sha2-(224|256|384|512)$/.test(normalized)) normalized = normalized.replace('sha2-', 'sha');
        const id = algorithms.indexOf(normalized);
        if (id < 0 || keyed && id === 6) {
            if (keyed) throw codedError(TypeError, 'ERR_CRYPTO_INVALID_DIGEST', 'Invalid digest: ' + name);
            throw new Error('Digest method not supported');
        }
        return id;
    }
    function bytes(value, name, strings = true, arrays = true, encoding) {
        if (typeof value === 'string' && strings) value = Buffer.from(value, encoding);
        if (ArrayBuffer.isView(value)) return [value.buffer, value.byteOffset, value.byteLength];
        if (arrays && isArrayBuffer(value)) return [value, 0, value.byteLength];
        throw invalidType(name, 'a ' + (strings ? 'string, ' : '') + 'Buffer, TypedArray' +
            (arrays ? ', DataView or ArrayBuffer' : ' or DataView'));
    }
    function receiver(value) {
        const state = states.get(value);
        if (!state) throw new TypeError('Invalid crypto receiver');
        return state;
    }
    function active(value) {
        const state = receiver(value);
        if (state.done) throw codedError(Error, 'ERR_CRYPTO_HASH_FINALIZED', 'Digest already called');
        return state;
    }
    function outputLength(options, id) {
        const length = options !== null && typeof options === 'object' ? options.outputLength : undefined;
        if (length !== undefined) {
            integer(length, 'options.outputLength', 0, 0xffffffff);
            if (length !== sizes[id]) throw codedError(Error, 'ERR_OSSL_EVP_NOT_XOF_OR_INVALID_LENGTH', 'Invalid output length');
        }
    }
    function Hash(name, options) {
        if (!new.target) return new Hash(name, options);
        const id = algorithmId(name);
        outputLength(options, id);
        states.set(this, {id, handle: binding.create(id, false, empty, 0, 0), done: false, hmac: false});
    }
    function Hmac(name, key, options) {
        if (!new.target) return new Hmac(name, key, options);
        const id = algorithmId(name, true);
        const encoding = options !== null && typeof options === 'object' ? options.encoding : undefined;
        const input = bytes(key, 'key', true, true, encoding);
        states.set(this, {id, handle: binding.create(id, true, ...input), done: false, hmac: true});
    }
    Hash.prototype.update = function update(data, encoding) {
        const state = active(this);
        if (typeof data === 'string') {
            if (typeof encoding !== 'string' || !Buffer.isEncoding(encoding)) encoding = 'utf8';
            if (encoding.toLowerCase() === 'hex' && data.length % 2) {
                throw codedError(TypeError, 'ERR_INVALID_ARG_VALUE', 'Invalid hex input');
            }
        }
        binding.update(state.handle, ...bytes(data, 'data', true, false, encoding));
        return this;
    };
    Hash.prototype.digest = function digest(encoding) {
        const state = receiver(this);
        if (state.done && !state.hmac) active(this);
        encoding = encoding && `${encoding}`;
        if (state.done) return !encoding || encoding === 'buffer' ? Buffer.alloc(0) : Buffer.alloc(0).toString(encoding);
        const data = binding.digest(state.handle);
        state.done = true;
        const buffer = Buffer.from(data);
        return encoding && Buffer.isEncoding(encoding) ? buffer.toString(encoding) : buffer;
    };
    Hash.prototype.copy = function copy(options) {
        const state = active(this);
        outputLength(options, state.id);
        const value = Object.create(Hash.prototype);
        states.set(value, {id: state.id, handle: binding.copy(state.handle), done: false, hmac: false});
        return value;
    };
    Hmac.prototype.update = Hash.prototype.update;
    Hmac.prototype.digest = Hash.prototype.digest;
    function createHash(algorithm, options) { return new Hash(algorithm, options); }
    function createHmac(algorithm, key, options) { return new Hmac(algorithm, key, options); }
    function getHashes() { return algorithms.slice().sort(); }
    function hkdfSync(digest, ikm, salt, info, keylen) {
        if (typeof digest !== 'string') throw invalidType('digest', 'a string');
        const key = bytes(ikm, 'ikm'), saltBytes = bytes(salt, 'salt'), infoBytes = bytes(info, 'info');
        integer(keylen, 'keylen', 0, Number.MAX_SAFE_INTEGER);
        if (infoBytes[2] > 1024) throw outOfRange('info');
        const id = algorithmId(digest, true);
        if (keylen > 255 * sizes[id]) throw codedError(RangeError, 'ERR_CRYPTO_INVALID_KEYLEN', 'Invalid key length');
        return binding.hkdf(id, ...key, ...saltBytes, ...infoBytes, keylen);
    }
    function pbkdf2Sync(password, salt, iterations, keylen, digest) {
        if (typeof digest !== 'string') throw invalidType('digest', 'a string');
        const key = bytes(password, 'password'), saltBytes = bytes(salt, 'salt');
        integer(iterations, 'iterations', 1, 0x7fffffff);
        integer(keylen, 'keylen', 0, 0x7fffffff);
        const id = algorithmId(digest, true);
        return Buffer.from(binding.pbkdf2(id, ...key, ...saltBytes, iterations, keylen));
    }
    function timingSafeEqual(a, b) {
        const first = bytes(a, 'buf1', false), second = bytes(b, 'buf2', false);
        if (first[2] !== second[2]) throw codedError(RangeError, 'ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH', 'Input buffers must have the same byte length');
        return binding.equal(...first, ...second);
    }
    function randomSize(value, name, maximum) {
        if (typeof value !== 'number') throw invalidType(name, 'a number');
        if (!Number.isFinite(value) || value < 0 || value > maximum) throw outOfRange(name);
        return Math.trunc(value);
    }
    function randomBytes(size, callback) {
        size = randomSize(size, 'size', 0x7fffffff);
        if (callback !== undefined) {
            if (typeof callback !== 'function') throw invalidType('callback', 'a function');
            throw codedError(Error, 'ERR_NOT_SUPPORTED', 'Asynchronous randomBytes is not enabled');
        }
        return Buffer.from(binding.random(size));
    }
    function randomFillSync(buffer, offset = 0, size) {
        const input = bytes(buffer, 'buf', false);
        const scale = buffer.BYTES_PER_ELEMENT || 1;
        if (typeof offset !== 'number') throw invalidType('offset', 'a number');
        const byteOffset = randomSize(offset * scale, 'offset', Math.min(input[2], 0x7fffffff));
        if (size !== undefined && typeof size !== 'number') throw invalidType('size', 'a number');
        if (size !== undefined && size * scale + byteOffset > input[2]) throw outOfRange('size + offset');
        const byteLength = size === undefined ? input[2] - byteOffset : randomSize(size * scale, 'size', 0x7fffffff);
        if (byteLength) binding.fill(input[0], input[1] + byteOffset, byteLength);
        return buffer;
    }
    function randomUUID(options) {
        if (options !== undefined) {
            if (options === null || typeof options !== 'object' || Array.isArray(options)) throw invalidType('options', 'an object');
            if (options.disableEntropyCache !== undefined && typeof options.disableEntropyCache !== 'boolean')
                throw invalidType('options.disableEntropyCache', 'a boolean');
        }
        const data = randomBytes(16);
        data[6] = data[6] & 15 | 64;
        data[8] = data[8] & 63 | 128;
        const hex = data.toString('hex');
        return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }
    function hash(algorithm, data, options) {
        if (typeof algorithm !== 'string') throw invalidType('algorithm', 'a string');
        if (typeof data !== 'string' && !ArrayBuffer.isView(data)) throw invalidType('input', 'a string or ArrayBufferView');
        let outputEncoding, outputSize;
        if (typeof options === 'string') outputEncoding = options;
        else if (options !== undefined) {
            if (options === null || typeof options !== 'object' || Array.isArray(options)) throw invalidType('options', 'an object');
            outputEncoding = options.outputEncoding;
            outputSize = options.outputLength;
        }
        outputEncoding ??= 'hex';
        if (typeof outputEncoding !== 'string') throw invalidType('outputEncoding', 'a string');
        if (outputEncoding.toLowerCase() !== 'buffer' && !Buffer.isEncoding(outputEncoding))
            throw codedError(TypeError, 'ERR_INVALID_ARG_VALUE', 'Invalid output encoding');
        if (outputSize !== undefined) integer(outputSize, 'outputLength', 0, 0xffffffff);
        const id = algorithmId(algorithm);
        if (outputSize !== undefined && outputSize !== sizes[id]) throw new Error('Invalid output length for digest');
        return createHash(algorithm).update(data).digest(outputEncoding);
    }
    function blake2b256(data) {
        if (arguments.length !== 1) throw invalidType('arguments', 'one data argument');
        return Buffer.from(binding.blake256(...bytes(data, 'data')));
    }
    return {api: {Hash, Hmac, createHash, createHmac, getHashes, hkdfSync, pbkdf2Sync, timingSafeEqual,
        randomBytes, randomFillSync, randomUUID, hash}, extensions: {blake2b256}};
}
