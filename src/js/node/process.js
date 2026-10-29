function exportObject(object) {
    const exported = {};
    for (const key of Object.keys(object))
        Object.defineProperty(exported, key, { enumerable: true, get: () => object[key] });
    exported.default = object;
    return exported;
}
const processStates = new WeakMap();
function createProcess(native, data, getPath) {
    const process = new EventEmitter();
    data.env = Object.assign(Object.create(null), data.env);
    const windows = native.platform === 'win32' && !data.worker;
    const environmentString = value => decodeUtf8(encodeString(value, 'utf8')).text;
    const findKey = key => windows ? Object.keys(data.env).find(existing => existing.toUpperCase() === key.toUpperCase()) ?? key : key;
    const environment = new Proxy(data.env, {
        get(target, key, receiver) {
            if (!data.worker && typeof key === 'string') {
                const value = native.getenv(environmentString(key.split('\0')[0]));
                return value === undefined ? Reflect.get(Object.prototype, key, receiver) : value;
            }
            const actual = typeof key === 'string' ? findKey(key.split('\0')[0]) : key;
            return Object.hasOwn(target, actual) ? target[actual] : Reflect.get(Object.prototype, key, receiver);
        },
        has(target, key) {
            if (!data.worker && typeof key === 'string') return native.getenv(environmentString(key.split('\0')[0])) !== undefined || Reflect.has(Object.prototype, key);
            return Reflect.has(target, key) || Reflect.has(Object.prototype, key);
        },
        getOwnPropertyDescriptor(target, key) {
            if (!data.worker && typeof key === 'string') {
                const value = native.getenv(environmentString(key.split('\0')[0]));
                return value === undefined ? undefined : { value, configurable: true, enumerable: true, writable: true };
            }
            return Reflect.getOwnPropertyDescriptor(target, typeof key === 'string' ? findKey(key.split('\0')[0]) : key);
        },
        ownKeys(target) {
            if (!data.worker) {
                const current = native.environment();
                for (const key of Object.keys(target)) delete target[key];
                for (const key of Object.keys(current)) target[key] = current[key];
            }
            return Reflect.ownKeys(target);
        },
        preventExtensions() { return false; },
        set(target, key, value) {
            if (typeof key === 'symbol') return Reflect.set(target, key, value);
            if (typeof value === 'symbol') throw new TypeError('Cannot convert a Symbol to a string');
            const name = environmentString(key.split('\0')[0]), text = environmentString(String(value).split('\0')[0]);
            if (!name || name.includes('=')) return true;
            if (!data.worker && !native.setenv(name, text)) return true;
            target[findKey(name)] = text;
            return true;
        },
        deleteProperty(target, key) {
            if (typeof key === 'symbol') return Reflect.deleteProperty(target, key);
            const name = environmentString(key.split('\0')[0]);
            if (!data.worker) native.unsetenv(name);
            return Reflect.deleteProperty(target, findKey(name));
        },
        defineProperty(target, key, descriptor) {
            if (!('value' in descriptor) || !descriptor.configurable || !descriptor.enumerable || !descriptor.writable)
                throw codedError(TypeError, 'ERR_INVALID_OBJECT_DEFINE_PROPERTY', 'Environment properties must be configurable, enumerable and writable data');
            return this.set(target, key, descriptor.value);
        }
    });
    const workerFailure = () => { throw codedError(Error, 'ERR_WORKER_UNSUPPORTED_OPERATION', 'Operation unavailable in a QuickJS Worker'); };
    Object.defineProperties(process, {
        argv0: { value: data.argv0, enumerable: true },
        argv: { enumerable: true, configurable: true, get: () => data.argv, set: value => { data.argv = value; } },
        execArgv: { enumerable: true, configurable: true, get: () => data.execArgv, set: value => { data.execArgv = value; } },
        execPath: { enumerable: true, configurable: true, get: () => data.execPath, set: value => { data.execPath = value; } },
        env: { value: environment, enumerable: true, writable: true, configurable: true },
        exitCode: { enumerable: true, configurable: true, get: () => data.exitCode, set(value) {
            if (data.worker) workerFailure();
            if (value == null) { data.exitCode = undefined; return; }
            if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) value = Number(value);
            if (typeof value !== 'number') throw invalidType('code', 'a number');
            if (!Number.isInteger(value)) throw outOfRange('code');
            data.exitCode = value | 0;
        } }
    });
    process.pid = native.pid; process.ppid = native.ppid;
    process.platform = native.platform; process.arch = native.arch;
    process.versions = { quickjs: native.quickjsVersion, cosmopolitan: native.cosmopolitanVersion,
                         quickjsCommit: native.quickjsCommit, cosmopolitanCommit: native.cosmopolitanCommit };
    process.cwd = () => native.cwd();
    process.chdir = directory => {
        if (data.worker) workerFailure();
        if (typeof directory !== 'string') throw invalidType('directory', 'a string');
        if (directory.includes('\0')) throw codedError(TypeError, 'ERR_INVALID_ARG_VALUE', 'Directory contains NUL');
        try { native.chdir(native.platform === 'win32' ? getPath().resolve(directory) : directory); }
        catch (error) { if (error && error.syscall === 'chdir') error.dest = directory; throw error; }
    };
    let exiting = false;
    const emitExit = () => { if (!exiting) { exiting = true; process.emit('exit', data.exitCode ?? 0); } };
    processStates.set(process, { emitExit, beforeExit: () => process.emit('beforeExit', data.exitCode ?? 0) });
    process.exit = code => {
        if (data.worker) workerFailure();
        if (code !== undefined) process.exitCode = code;
        emitExit();
        native.exit(data.exitCode ?? 0);
    };
    process.uptime = () => native.uptime();
    process.hrtime = previous => {
        const now = native.clock();
        let seconds = Number(now / 1000000000n), nanos = Number(now % 1000000000n);
        if (previous !== undefined) {
            if (!Array.isArray(previous)) throw invalidType('time', 'an Array');
            if (previous.length !== 2) throw codedError(RangeError, 'ERR_OUT_OF_RANGE', 'time must have length two');
            seconds -= previous[0]; nanos -= previous[1];
            if (nanos < 0) { seconds--; nanos += 1e9; }
        }
        return [seconds, nanos];
    };
    process.hrtime.bigint = () => native.clock();
    Object.defineProperty(process, Symbol.toStringTag, { value: 'process' });
    Object.defineProperty(globalThis, 'process', { value: process, writable: true, configurable: true });
    return process;
}
