function createCompression(native) {
    const binding = native.compression;
    const versions = binding.versions();
    const empty = new ArrayBuffer(0);
    const constants = Object.freeze({...compressionConstants, ZLIB_VERNUM: versions.zlibVernum});
    const codes = {};
    for (const name of ['Z_OK','Z_STREAM_END','Z_NEED_DICT','Z_ERRNO','Z_STREAM_ERROR','Z_DATA_ERROR','Z_MEM_ERROR','Z_BUF_ERROR','Z_VERSION_ERROR']) {
        codes[name] = constants[name]; codes[constants[name]] = name;
    }
    Object.freeze(codes);
    function bytes(input, name = 'buffer', strings = true) {
        if (typeof input === 'string' && strings) input = Buffer.from(input);
        if (ArrayBuffer.isView(input)) return [input.buffer, input.byteOffset, input.byteLength];
        if (isArrayBuffer(input)) return [input, 0, input.byteLength];
        throw invalidType(name, strings ? 'a string or byte buffer' : 'an ArrayBuffer or ArrayBufferView');
    }
    function range(value, name, min, max, fallback) {
        if (value === undefined || typeof value === 'number' && Number.isNaN(value)) return fallback;
        if (typeof value !== 'number') throw invalidType(name, 'a number');
        if (!Number.isFinite(value) || value < min || value > max) throw outOfRange(name);
        return Math.trunc(value);
    }
    function boolean(value, name, fallback) {
        if (value === undefined) return fallback;
        if (typeof value !== 'boolean') throw invalidType(name, 'a boolean');
        return value;
    }
    function optionsObject(value) {
        if (value === undefined || value === null || !value) return {};
        /* Node's zlib constructors read options by property access. */
        return value;
    }
    function perform(mode, input, supplied) {
        const options = optionsObject(supplied);
        const zstd = mode === 7 || mode === 8, extension = mode >= 9;
        let window = 15, level = -1, memory = 8, strategy = 0;
        let dictionary = [empty, 0, 0], params = [], pledged;
        if (mode <= 6) {
            const suppliedWindow = options.windowBits;
            window = (mode === 1 || mode === 3 || mode === 6) && (suppliedWindow == null || suppliedWindow === 0) ? 0 :
                range(suppliedWindow, 'options.windowBits', mode === 2 ? 9 : 8, 15, 15);
            level = range(options.level, 'options.level', -1, 9, -1);
            memory = range(options.memLevel, 'options.memLevel', 1, 9, 8);
            strategy = range(options.strategy, 'options.strategy', 0, 4, 0);
            if (options.dictionary !== undefined) dictionary = bytes(options.dictionary, 'options.dictionary', false);
        } else if (zstd) {
            const max = mode === 7 ? 402 : 100;
            if (options.params) {
                const seen = new Set();
                for (const key of Object.keys(options.params)) {
                    const index = +key;
                    if (!Number.isInteger(index) || index < 0 || index > max || seen.has(index))
                        throw codedError(RangeError, 'ERR_ZSTD_INVALID_PARAM', 'Invalid Zstd parameter');
                    const value = options.params[key];
                    if (typeof value !== 'number' && typeof value !== 'boolean') throw invalidType('options.params[key]', 'a number');
                    const coerced = value | 0;
                    if (coerced !== -1) seen.add(index);
                    if (mode === 7 && index === 400 && coerced !== 0 && coerced !== -1)
                        throw codedError(Error, 'ERR_NOT_SUPPORTED', 'Zstd native worker threads are not enabled');
                    if (coerced !== -1) params.push(index, coerced);
                }
            }
            if (options.dictionary !== undefined && (ArrayBuffer.isView(options.dictionary) || isArrayBuffer(options.dictionary)))
                dictionary = bytes(options.dictionary, 'options.dictionary', false);
            if (options.pledgedSrcSize !== undefined) pledged = integer(options.pledgedSrcSize, 'options.pledgedSrcSize', 0, Number.MAX_SAFE_INTEGER);
        } else {
            if (options.dictionary !== undefined) throw codedError(Error, 'ERR_NOT_SUPPORTED', 'Extension dictionaries are not enabled');
            for (const name of ['params','flush','finishFlush']) if (options[name] !== undefined)
                throw codedError(Error, 'ERR_NOT_SUPPORTED', 'Extension option is not enabled: ' + name);
            if (mode >= 11 && (options.checksum !== undefined || options.blockSize !== undefined))
                throw codedError(Error, 'ERR_NOT_SUPPORTED', 'bzip2 always uses its own block/checksum format');
            if (mode < 11 && options.small !== undefined) throw codedError(Error, 'ERR_NOT_SUPPORTED', 'small applies only to bzip2');
            level = range(options.level, 'options.level', mode < 11 ? 0 : 1, mode < 11 ? 12 : 9, mode < 11 ? 0 : 9);
        }
        const chunk = range(options.chunkSize, 'options.chunkSize', 64, 0x7fffffff, 16384);
        range(options.flush, 'options.flush', 0, zstd ? 2 : 5, 0);
        const finish = range(options.finishFlush, 'options.finishFlush', 0, zstd ? 2 : 5, zstd ? 2 : 4);
        const maximum = range(options.maxOutputLength, 'options.maxOutputLength', 1, 0x7fffffff, 0x7fffffff);
        const reject = boolean(options.rejectGarbageAfterEnd, 'options.rejectGarbageAfterEnd', false);
        if (options.info) throw codedError(Error, 'ERR_NOT_SUPPORTED', 'Compression engine objects are enabled with streams');
        const checksum = mode === 9 || mode === 10 ? boolean(options.checksum, 'options.checksum', false) : false;
        const blockSize = mode === 9 || mode === 10 ? integer(options.blockSize ?? 0, 'options.blockSize', 0, 7) : 0;
        if (extension && blockSize !== 0 && blockSize < 4) throw outOfRange('options.blockSize');
        const small = mode >= 11 ? boolean(options.small, 'options.small', false) : false;
        const data = bytes(input);
        return Buffer.from(binding.run(mode, ...data, [maximum,chunk,window,level,memory,strategy,finish,+reject,+checksum,blockSize,+small],
            ...dictionary, params, pledged));
    }
    const api = {constants, codes};
    const names = ['deflateSync','inflateSync','gzipSync','gunzipSync','deflateRawSync','inflateRawSync','unzipSync',
        'zstdCompressSync','zstdDecompressSync','lz4CompressSync','lz4DecompressSync','bzip2CompressSync','bzip2DecompressSync'];
    const extensions = {};
    for (let mode=0;mode<names.length;mode++) {
        const name = names[mode];
        const fn = {[name](input, options) { return perform(mode, input, options); }}[name];
        (mode<9 ? api : extensions)[name] = fn;
    }
    api.crc32 = function crc32(data, value = 0) {
        if (typeof data !== 'string' && !ArrayBuffer.isView(data)) throw invalidType('data', 'a string or ArrayBufferView');
        integer(value, 'value', 0, 0xffffffff);
        return binding.checksum(0, ...bytes(data), value);
    };
    extensions.crc32c = function crc32c(data, value = 0) {
        integer(value, 'value', 0, 0xffffffff); return binding.checksum(1, ...bytes(data), value);
    };
    extensions.adler32 = function adler32(data, value = 1) {
        integer(value, 'value', 0, 0xffffffff); return binding.checksum(2, ...bytes(data), value);
    };
    extensions.codecInfo = function codecInfo(name) {
        const records = [
            {name:'zlib',format:'zlib/gzip/raw-deflate',backend:'Cosmopolitan zlib',version:versions.zlib},
            {name:'zstd',format:'Zstandard frame',backend:'Cosmopolitan Zstd',version:versions.zstd},
            {name:'lz4',format:'LZ4 Frame',backend:'Cosmopolitan LZ4',version:versions.lz4},
            {name:'bzip2',format:'bzip2 stream',backend:'Cosmopolitan bzip2',version:versions.bzip2}
        ];
        if (name === undefined) return records;
        if (typeof name !== 'string') throw invalidType('name', 'a string');
        const found = records.find(record => record.name === name);
        if (!found) throw codedError(TypeError, 'ERR_INVALID_ARG_VALUE', 'Unknown codec');
        return found;
    };
    return {api, extensions};
}
