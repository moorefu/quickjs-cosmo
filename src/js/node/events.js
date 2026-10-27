const emitterStates = new WeakMap();
const errorMonitor = Symbol('events.errorMonitor');
function emitterState(emitter) {
    if ((typeof emitter !== 'object' && typeof emitter !== 'function') || emitter === null)
        throw invalidType('this', 'an EventEmitter');
    let state = emitterStates.get(emitter);
    if (!state) emitterStates.set(emitter, state = new Map());
    return state;
}
function EventEmitter(options) {
    if (this == null) return new EventEmitter(options);
    if (options?.captureRejections !== undefined && typeof options.captureRejections !== 'boolean')
        throw invalidType('options.captureRejections', 'a boolean');
    if (options?.captureRejections)
        throw codedError(Error, 'ERR_NOT_SUPPORTED', 'captureRejections requires the scheduling implementation');
    emitterState(this);
}
function addEventListener(emitter, type, listener, prepend) {
    if (typeof listener !== 'function') throw invalidType('listener', 'a function');
    const events = emitterState(emitter);
    if (events.has('newListener')) emitter.emit('newListener', type, listener.listener ?? listener);
    const list = events.get(type) ?? [];
    if (prepend) list.unshift(listener); else list.push(listener);
    events.set(type, list);
    return emitter;
}
EventEmitter.prototype.on = function on(type, listener) { return addEventListener(this, type, listener, false); };
EventEmitter.prototype.addListener = EventEmitter.prototype.on;
EventEmitter.prototype.prependListener = function prependListener(type, listener) { return addEventListener(this, type, listener, true); };
function onceListener(emitter, type, listener, prepend) {
    if (typeof listener !== 'function') throw invalidType('listener', 'a function');
    let fired = false;
    function wrapped(...args) {
        if (fired) return;
        fired = true;
        emitter.removeListener(type, wrapped);
        return Reflect.apply(listener, emitter, args);
    }
    wrapped.listener = listener;
    return addEventListener(emitter, type, wrapped, prepend);
}
EventEmitter.prototype.once = function once(type, listener) { return onceListener(this, type, listener, false); };
EventEmitter.prototype.prependOnceListener = function prependOnceListener(type, listener) { return onceListener(this, type, listener, true); };
EventEmitter.prototype.emit = function emit(type, ...args) {
    const events = emitterState(this);
    if (type === 'error') {
        if (events.has(errorMonitor)) this.emit(errorMonitor, ...args);
        if (!events.has(type)) {
            if (args[0] instanceof Error) throw args[0];
            const error = codedError(Error, 'ERR_UNHANDLED_ERROR', 'Unhandled error event: ' + String(args[0]));
            error.context = args[0];
            throw error;
        }
    }
    const listeners = events.get(type);
    if (!listeners?.length) return false;
    for (const listener of listeners.slice()) Reflect.apply(listener, this, args);
    return true;
};
EventEmitter.prototype.removeListener = function removeListener(type, listener) {
    if (typeof listener !== 'function') throw invalidType('listener', 'a function');
    const events = emitterState(this), list = events.get(type);
    if (!list) return this;
    for (let i = list.length - 1; i >= 0; i--) if (list[i] === listener || list[i].listener === listener) {
        const original = list[i].listener ?? list[i];
        list.splice(i, 1);
        if (!list.length) events.delete(type);
        if (events.has('removeListener')) this.emit('removeListener', type, original);
        break;
    }
    return this;
};
EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
EventEmitter.prototype.removeAllListeners = function removeAllListeners(type) {
    const events = emitterState(this);
    if (arguments.length === 0) {
        for (const key of [...events.keys()]) if (key !== 'removeListener') this.removeAllListeners(key);
        this.removeAllListeners('removeListener');
        return this;
    }
    const list = events.get(type);
    if (list) for (const listener of list.slice().reverse()) this.removeListener(type, listener);
    return this;
};
EventEmitter.prototype.listeners = function listeners(type) {
    return (emitterState(this).get(type) ?? []).map(listener => listener.listener ?? listener);
};
EventEmitter.prototype.rawListeners = function rawListeners(type) { return (emitterState(this).get(type) ?? []).slice(); };
EventEmitter.prototype.listenerCount = function listenerCount(type, listener) {
    if (listener !== undefined && typeof listener !== 'function') throw invalidType('listener', 'a function');
    const list = emitterState(this).get(type) ?? [];
    return listener === undefined ? list.length : list.filter(fn => fn === listener || fn.listener === listener).length;
};
EventEmitter.prototype.eventNames = function eventNames() { return Reflect.ownKeys(Object.fromEntries(emitterState(this))); };
EventEmitter.EventEmitter = EventEmitter;
EventEmitter.errorMonitor = errorMonitor;
EventEmitter.listenerCount = (emitter, type) => emitter.listenerCount(type);
const eventsAPI = { EventEmitter, errorMonitor, listenerCount: EventEmitter.listenerCount, default: EventEmitter };
