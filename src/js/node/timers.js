function createScheduler(native, process, abort) {
    const timers = new Map(), immediates = new Map(), ticks = [], handleKey = Symbol('timer.state');
    // State may retain a callback which points back to the handle. Keep that
    // cycle on the instance; a module WeakMap value roots it in QuickJS.
    const handles = {get: handle => handle?.[handleKey],
        set: (handle, state) => Object.defineProperty(handle, handleKey, {value: state})};
    let nextID = 1, timerWake = 0, immediateWake = 0, timerDeadline = 0, immediateDeadline = 0;
    let runningTimers = false, runningImmediates = false;
    const now = () => Number(native.clock() / 1000000n);
    function delayValue(value) { const delay = value === undefined ? 1 : +value; return delay >= 1 && delay <= 0x7fffffff ? Math.trunc(delay) : 1; }
    function callbackValue(callback) { if (typeof callback !== 'function') throw invalidType('callback', 'a function'); }
    class Timeout {
        constructor(state) { handles.set(this, state); state.handle = this; }
        ref() { const state = handles.get(this); state.ref = true; schedule(state.immediate); return this; }
        unref() { const state = handles.get(this); state.ref = false; schedule(state.immediate); return this; }
        hasRef() { return handles.get(this).ref; }
        refresh() {
            const state = handles.get(this);
            if (!state.cancelled) {
                const previous = state.deadline, active = timers.has(state.id);
                state.deadline = now() + state.delay; timers.set(state.id, state);
                try { schedule(false); }
                catch (error) { state.deadline = previous; if (!active) timers.delete(state.id); throw error; }
            }
            return this;
        }
        close() { clearTimeout(this); return this; }
        [Symbol.toPrimitive]() { return handles.get(this).id; }
        [Symbol.dispose]() { clearTimeout(this); }
    }
    class Immediate {
        constructor(state) { handles.set(this, state); state.handle = this; }
        ref() { const state = handles.get(this); if (!state.cancelled) state.ref = true; schedule(true); return this; }
        unref() { const state = handles.get(this); state.ref = false; schedule(true); return this; }
        hasRef() { return handles.get(this).ref; }
        [Symbol.dispose]() { clearImmediate(this); }
    }
    function schedule(immediate) {
        if (immediate ? runningImmediates : runningTimers) return;
        const map = immediate ? immediates : timers;
        const previousWake = immediate ? immediateWake : timerWake;
        let wake = 0;
        if (map.size) {
            let deadline = Infinity, referenced = false;
            for (const state of map.values()) { deadline = Math.min(deadline, state.deadline); referenced ||= state.ref; }
            const previousDeadline = immediate ? immediateDeadline : timerDeadline;
            if (previousWake && deadline >= previousDeadline && native.timerRef(previousWake, referenced)) return;
            wake = native.timerStart(immediate ? runImmediates : runTimers, immediate ? 0 : Math.max(0, deadline - now()), referenced, immediate);
            if (immediate) immediateDeadline = deadline; else timerDeadline = deadline;
        }
        if (previousWake) native.timerCancel(previousWake);
        if (immediate) immediateWake = wake; else timerWake = wake;
    }
    function invoke(state) {
        try { Reflect.apply(state.callback, state.handle, state.args); }
        catch (error) { native.fail(error); }
        return native.checkpoint();
    }
    function runTimers() {
        timerWake = 0; runningTimers = true;
        const cutoff = now();
        const batch = [...timers.values()].filter(state => state.deadline <= cutoff)
            .sort((a, b) => a.deadline - b.deadline || a.id - b.id);
        try {
            for (const state of batch) {
                if (timers.get(state.id) !== state || state.deadline > cutoff) continue;
                timers.delete(state.id);
                if (state.repeat) { state.deadline = now() + state.delay; timers.set(state.id, state); }
                if (!invoke(state)) break;
            }
        } finally { runningTimers = false; try { schedule(false); } catch (error) { native.fail(error); } }
    }
    function runImmediates() {
        immediateWake = 0; runningImmediates = true;
        const batch = [...immediates.values()];
        try {
            for (const state of batch) {
                if (!immediates.delete(state.id)) continue;
                state.cancelled = true; state.ref = false;
                if (!invoke(state)) break;
            }
        } finally { runningImmediates = false; try { schedule(true); } catch (error) { native.fail(error); } }
    }
    function makeTimeout(callback, delay, args, repeat) {
        callbackValue(callback); delay = delayValue(delay);
        const state = { id: nextID++, callback, args, delay, deadline: now() + delay, repeat, ref: true, cancelled: false, immediate: false };
        const handle = new Timeout(state); timers.set(state.id, state);
        try { schedule(false); } catch (error) { timers.delete(state.id); state.cancelled = true; throw error; }
        return handle;
    }
    function setTimeout(callback, delay, ...args) { return makeTimeout(callback, delay, args, false); }
    function setInterval(callback, delay, ...args) { return makeTimeout(callback, delay, args, true); }
    function clearTimeout(handle) {
        const state = handles.get(handle) ?? timers.get(typeof handle === 'string' ? +handle : handle);
        if (!state || state.immediate) return;
        state.cancelled = true; timers.delete(state.id); schedule(false);
    }
    function setImmediate(callback, ...args) {
        callbackValue(callback);
        const state = { id: nextID++, callback, args, deadline: 0, ref: true, cancelled: false, immediate: true };
        const handle = new Immediate(state); immediates.set(state.id, state);
        try { schedule(true); } catch (error) { immediates.delete(state.id); state.cancelled = true; throw error; }
        return handle;
    }
    function clearImmediate(handle) {
        const state = handles.get(handle);
        if (!state || !state.immediate) return;
        state.cancelled = true; state.ref = false; immediates.delete(state.id); schedule(true);
    }
    function queueMicrotask(callback) { callbackValue(callback); native.enqueueMicrotask(callback); }
    function nextTick(callback, ...args) { callbackValue(callback); ticks.push([callback, args]); }
    function drainTicks() {
        let count = 0;
        while (ticks.length) {
            const [callback, args] = ticks.shift(); count++;
            try { Reflect.apply(callback, undefined, args); } catch (error) { native.fail(error); ticks.length = 0; break; }
        }
        return count;
    }
    const abortError = signal => { const error = codedError(Error, 'ABORT_ERR', 'The operation was aborted'); error.name = 'AbortError'; error.cause = signal.reason; return error; };
    function optionsValue(options) {
        if (options === null || typeof options !== 'object' || Array.isArray(options)) throw invalidType('options', 'an object');
        if (options.ref !== undefined && typeof options.ref !== 'boolean') throw invalidType('options.ref', 'a boolean');
        if (options.signal !== undefined && !abort.isSignal(options.signal)) throw invalidType('options.signal', 'an AbortSignal');
        return { ref: options.ref ?? true, signal: options.signal };
    }
    function promiseTimer(immediate, delay, value, options = {}) {
        return new Promise((resolve, reject) => {
            if (!immediate && delay !== undefined && typeof delay !== 'number') throw invalidType('delay', 'a number');
            const { ref, signal } = optionsValue(options);
            if (signal?.aborted) { reject(abortError(signal)); return; }
            let listener;
            const handle = immediate ? setImmediate(done) : setTimeout(done, delay);
            if (!ref) handle.unref();
            function done() { signal?.removeEventListener('abort', listener); resolve(value); }
            listener = () => { (immediate ? clearImmediate : clearTimeout)(handle); reject(abortError(signal)); };
            signal?.addEventListener('abort', listener, { once: true });
        });
    }
    async function* promiseInterval(delay, value, options = {}) {
        if (delay !== undefined && typeof delay !== 'number') throw invalidType('delay', 'a number');
        const { ref, signal } = optionsValue(options);
        if (signal?.aborted) throw abortError(signal);
        let available = 0, wake;
        const handle = setInterval(() => { available++; wake?.(); }, delay);
        if (!ref) handle.unref();
        const listener = () => wake?.();
        signal?.addEventListener('abort', listener, { once: true });
        try {
            for (;;) {
                if (signal?.aborted) throw abortError(signal);
                if (!available) await new Promise(resolve => { wake = resolve; });
                wake = undefined;
                if (signal?.aborted) throw abortError(signal);
                while (available > 0) {
                    if (signal?.aborted) throw abortError(signal);
                    available--; yield value;
                }
            }
        } finally { clearInterval(handle); signal?.removeEventListener('abort', listener); }
    }
    const promises = { setTimeout: (delay, value, options) => promiseTimer(false, delay, value, options),
        setImmediate: (value, options) => promiseTimer(true, 0, value, options), setInterval: promiseInterval };
    setTimeout[promisifyCustom] = promises.setTimeout; setImmediate[promisifyCustom] = promises.setImmediate;
    const api = { setTimeout, clearTimeout, setInterval, clearInterval: clearTimeout, setImmediate, clearImmediate, promises };
    for (const [name, value] of Object.entries({ ...api, queueMicrotask }))
        if (name !== 'promises') Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    process.nextTick = nextTick;
    return { ...api, api, drainTicks, queueMicrotask, nextTick };
}
