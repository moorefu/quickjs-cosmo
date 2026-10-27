function createFileStreams(fs, streams, helpers) {
    const {Readable, Writable} = streams, {options, bytes, fd, mode, flags} = helpers;
    const states = new WeakMap();
    function setup(stream, name, supplied, writing) {
        const opts = options(supplied, {}), suppliedFd = opts.fd;
        if (opts.autoClose !== undefined && typeof opts.autoClose !== 'boolean') throw invalidType('autoClose', 'a boolean');
        if (opts.flush !== undefined && typeof opts.flush !== 'boolean') throw invalidType('flush', 'a boolean');
        const handle = suppliedFd && typeof suppliedFd === 'object' && typeof suppliedFd.read === 'function' && typeof suppliedFd.close === 'function' ? suppliedFd : null;
        const number = suppliedFd == null ? null : fd(handle ? handle.fd : suppliedFd);
        if (number === null) bytes(name);
        const start = opts.start === undefined ? undefined : integer(opts.start, 'start', 0, Number.MAX_SAFE_INTEGER);
        const end = writing || opts.end === undefined ? Infinity : integer(opts.end, 'end', 0, Number.MAX_SAFE_INTEGER);
        if (start !== undefined && start > end) throw outOfRange('start');
        const custom = opts.fs ?? fs;
        for (const method of [writing ? 'write' : 'read', ...(number === null ? ['open'] : []), ...(opts.autoClose !== false ? ['close'] : [])])
            if (typeof custom[method] !== 'function') throw invalidType('fs.' + method, 'a function');
        states.set(stream, {opts, custom, handle, number, position:start ?? null, end, busy:null, autoClose:opts.autoClose !== false, writing});
        stream.fd = number; stream.path = number === null ? name : undefined;
        stream[writing ? 'bytesWritten' : 'bytesRead'] = 0;
        const streamOptions = {...opts, autoDestroy:opts.autoClose !== false};
        if (!writing) streamOptions.highWaterMark ??= 65536;
        (writing ? Writable : Readable).call(stream, streamOptions);
        return opts;
    }
    function call(stream, method, ...args) {
        const state = states.get(stream);
        if (state.handle) {
            const mapped = {fsync:'sync'}[method] ?? method;
            return Promise.resolve().then(() => state.handle[mapped](...args));
        }
        return new Promise((resolve, reject) => state.custom[method](state.number, ...args, (error, count) => error ? reject(error) : resolve(count)));
    }
    function construct(callback) {
        const state = states.get(this);
        if (state.number !== null) { callback(); return; }
        const flag = state.opts.flags ?? (state.writing ? 'w' : 'r');
        flags(flag); mode(state.opts.mode, 0o666);
        if (state.custom === fs) {
            fs.promises.open(this.path, flag, state.opts.mode ?? 0o666).then(handle => {
                state.handle = handle; this.fd = state.number = handle.fd;
                this.emit('open', this.fd); this.emit('ready'); callback();
            }, callback);
            return;
        }
        state.custom.open(this.path, flag, state.opts.mode ?? 0o666, (error, number) => {
            if (error) { callback(error); return; }
            this.fd = state.number = number;
            this.emit('open', number); this.emit('ready'); callback();
        });
    }
    function destroy(error, callback) {
        const state = states.get(this);
        const close = async () => {
            if (state.busy) try { await state.busy; } catch (failure) { error ??= failure; }
            if (state.number !== null) {
                try {
                    if (state.writing && state.opts.flush && !error) await call(this, 'fsync');
                } catch (failure) { error ??= failure; }
                try { await call(this, 'close'); } catch (failure) { error ??= failure; }
                state.number = this.fd = null;
            }
            callback(error);
        };
        close().catch(callback);
    }
    function ReadStream(name, opts) {
        if (!(this instanceof ReadStream)) return new ReadStream(name, opts);
        setup(this, name, opts, false);
    }
    Object.setPrototypeOf(ReadStream.prototype, Readable.prototype); Object.setPrototypeOf(ReadStream, Readable);
    ReadStream.prototype._construct = construct;
    ReadStream.prototype._destroy = destroy;
    ReadStream.prototype._read = function(size) {
        const state = states.get(this);
        const remaining = state.end - (state.position ?? this.bytesRead) + 1;
        if (remaining <= 0) { this.push(null); return; }
        const buffer = Buffer.allocUnsafe(Math.max(1, Math.min(size || 1, remaining, 65536)));
        state.busy = call(this, 'read', buffer, 0, buffer.length, state.position);
        state.busy.then(result => {
            const count = typeof result === 'number' ? result : result.bytesRead;
            state.busy = null;
            this.bytesRead += count;
            if (state.position !== null) state.position += count;
            if (!this.destroyed) this.push(count ? buffer.subarray(0, count) : null);
        }, error => { state.busy = null; this.destroy(error); });
    };
    function WriteStream(name, opts) {
        if (!(this instanceof WriteStream)) return new WriteStream(name, opts);
        setup(this, name, opts, true);
    }
    Object.setPrototypeOf(WriteStream.prototype, Writable.prototype); Object.setPrototypeOf(WriteStream, Writable);
    WriteStream.prototype._construct = construct;
    WriteStream.prototype._destroy = destroy;
    WriteStream.prototype._write = function(buffer, encoding, callback) {
        const state = states.get(this);
        const write = async () => {
            let offset = 0;
            while (offset < buffer.length && !this.destroyed) {
                const result = await call(this, 'write', buffer, offset, Math.min(buffer.length - offset, 65536), state.position);
                const count = typeof result === 'number' ? result : result.bytesWritten;
                if (!count) throw codedError(Error, 'ERR_SYSTEM_ERROR', 'A file write made no progress');
                offset += count; this.bytesWritten += count;
                if (state.position !== null) state.position += count;
            }
        };
        state.busy = write();
        state.busy.then(() => { state.busy = null; callback(); }, error => { state.busy = null; callback(error); });
    };
    for (const Constructor of [ReadStream, WriteStream]) {
        Object.defineProperty(Constructor.prototype, 'pending', {get() { return this.fd === null; }});
        Constructor.prototype.close = function(callback) {
            if (callback !== undefined && typeof callback !== 'function') throw invalidType('callback', 'a function');
            const state = states.get(this);
            if (!state.writing) {
                if (callback) streams.finished(this, callback);
                this.destroy(); return;
            }
            if (callback) { if (this.closed) { queueMicrotask(callback); return; } else this.once('close', callback); }
            if (!state.autoClose) this.once('finish', () => this.destroy());
            this.end();
        };
    }
    return {ReadStream, WriteStream, createReadStream:(name, opts) => new ReadStream(name, opts), createWriteStream:(name, opts) => new WriteStream(name, opts)};
}
