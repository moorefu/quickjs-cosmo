function createAbortPrimitives(getTimers) {
    const targets = new WeakMap(), events = new WeakMap(), signals = new WeakMap();
    const dependencyCleanup = new FinalizationRegistry(records => {
        for (const [source, dependent] of records) {
            const original = source.deref();
            if (original) signals.get(original)?.dependents.delete(dependent);
        }
    });
    const exceptionNames = ['IndexSizeError', 'DOMStringSizeError', 'HierarchyRequestError', 'WrongDocumentError',
        'InvalidCharacterError', 'NoDataAllowedError', 'NoModificationAllowedError', 'NotFoundError',
        'NotSupportedError', 'InUseAttributeError', 'InvalidStateError', 'SyntaxError', 'InvalidModificationError',
        'NamespaceError', 'InvalidAccessError', 'ValidationError', 'TypeMismatchError', 'SecurityError',
        'NetworkError', 'AbortError', 'URLMismatchError', 'QuotaExceededError', 'TimeoutError', 'InvalidNodeTypeError', 'DataCloneError'];
    const exceptionConstants = ['INDEX_SIZE_ERR', 'DOMSTRING_SIZE_ERR', 'HIERARCHY_REQUEST_ERR', 'WRONG_DOCUMENT_ERR',
        'INVALID_CHARACTER_ERR', 'NO_DATA_ALLOWED_ERR', 'NO_MODIFICATION_ALLOWED_ERR', 'NOT_FOUND_ERR',
        'NOT_SUPPORTED_ERR', 'INUSE_ATTRIBUTE_ERR', 'INVALID_STATE_ERR', 'SYNTAX_ERR', 'INVALID_MODIFICATION_ERR',
        'NAMESPACE_ERR', 'INVALID_ACCESS_ERR', 'VALIDATION_ERR', 'TYPE_MISMATCH_ERR', 'SECURITY_ERR',
        'NETWORK_ERR', 'ABORT_ERR', 'URL_MISMATCH_ERR', 'QUOTA_EXCEEDED_ERR', 'TIMEOUT_ERR', 'INVALID_NODE_TYPE_ERR', 'DATA_CLONE_ERR'];
    class DOMException extends Error {
        constructor(message = '', name = 'Error') {
            super(String(message)); this.name = String(name);
        }
        get code() { return exceptionNames.indexOf(this.name) + 1; }
    }
    exceptionConstants.forEach((key, index) => {
        for (const target of [DOMException, DOMException.prototype]) Object.defineProperty(target, key, { value: index + 1, enumerable: true });
    });
    class Event {
        constructor(type, options = {}) {
            if (arguments.length === 0) throw invalidType('type', 'a string');
            events.set(this, { type: String(type), bubbles: !!options.bubbles, cancelable: !!options.cancelable,
                composed: !!options.composed, target: null, currentTarget: null, prevented: false, stopped: false,
                immediate: false, dispatching: false, trusted: false, timestamp: Date.now() });
        }
        get type() { return events.get(this).type; }
        get target() { return events.get(this).target; }
        get currentTarget() { return events.get(this).currentTarget; }
        get bubbles() { return events.get(this).bubbles; }
        get cancelable() { return events.get(this).cancelable; }
        get composed() { return events.get(this).composed; }
        get defaultPrevented() { return events.get(this).prevented; }
        get isTrusted() { return events.get(this).trusted; }
        get timeStamp() { return events.get(this).timestamp; }
        get eventPhase() { return events.get(this).dispatching ? 2 : 0; }
        get cancelBubble() { return events.get(this).stopped; }
        set cancelBubble(value) { if (value) this.stopPropagation(); }
        get returnValue() { return !this.defaultPrevented; }
        set returnValue(value) { if (!value) this.preventDefault(); }
        stopPropagation() { events.get(this).stopped = true; }
        stopImmediatePropagation() { events.get(this).immediate = true; this.stopPropagation(); }
        preventDefault() { const state = events.get(this); if (state.cancelable && !state.passive) state.prevented = true; }
        composedPath() { const state = events.get(this); return state.dispatching ? [state.target] : []; }
        get srcElement() { return this.target; }
        initEvent(type, bubbles = false, cancelable = false) {
            const state = events.get(this);
            if (state.dispatching) return;
            Object.assign(state, { type: String(type), bubbles: !!bubbles, cancelable: !!cancelable, prevented: false, stopped: false, immediate: false });
        }
    }
    for (const [key, value] of Object.entries({ NONE: 0, CAPTURING_PHASE: 1, AT_TARGET: 2, BUBBLING_PHASE: 3 }))
        for (const target of [Event, Event.prototype]) Object.defineProperty(target, key, { value, enumerable: true });
    class EventTarget {
        constructor() { targets.set(this, new Map()); }
        addEventListener(type, callback, options = {}) {
            if (callback == null) return;
            if (typeof callback !== 'function' && typeof callback !== 'object') throw invalidType('listener', 'a function or object');
            if (typeof options === 'boolean') options = { capture: options };
            options ??= {};
            const signal = options.signal;
            if (signal !== undefined && (!(signal instanceof AbortSignal) || !signals.has(signal))) throw invalidType('options.signal', 'an AbortSignal');
            if (signal?.aborted) return;
            type = String(type);
            const state = targets.get(this), list = state.get(type) ?? [];
            const capture = !!options.capture;
            if (list.some(item => item.callback === callback && item.capture === capture)) return;
            const item = { callback, capture, once: !!options.once, passive: !!options.passive, signal, removed: false };
            if (signal) {
                item.abort = () => this.removeEventListener(type, callback, capture);
                signal.addEventListener('abort', item.abort, { once: true });
            }
            list.push(item); state.set(type, list);
        }
        removeEventListener(type, callback, options = {}) {
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            const state = targets.get(this), key = String(type), list = state.get(key);
            if (!list) return;
            const index = list.findIndex(item => item.callback === callback && item.capture === capture);
            if (index < 0) return;
            const item = list[index]; item.removed = true; list.splice(index, 1);
            if (!list.length) state.delete(key);
            if (item.signal) item.signal.removeEventListener('abort', item.abort);
        }
        dispatchEvent(event) {
            const state = events.get(event);
            if (!state) throw invalidType('event', 'an Event');
            if (state.dispatching) throw codedError(Error, 'ERR_EVENT_RECURSION', 'The event is already being dispatched');
            state.dispatching = true; state.target = state.currentTarget = this;
            state.immediate = state.stopped = false;
            try {
                const listeners = (targets.get(this).get(event.type) ?? []).slice();
                for (const item of listeners) {
                    if (state.immediate) break;
                    if (item.removed) continue;
                    if (item.once) this.removeEventListener(event.type, item.callback, item.capture);
                    state.passive = item.passive;
                    try {
                        if (typeof item.callback === 'function') Reflect.apply(item.callback, this, [event]);
                        else if (typeof item.callback.handleEvent === 'function') item.callback.handleEvent(event);
                    } catch (error) { getTimers().nextTick(() => { throw error; }); }
                }
            } finally { state.currentTarget = null; state.dispatching = false; state.passive = false; }
            return !state.prevented;
        }
    }
    const signalKey = {};
    class AbortSignal extends EventTarget {
        constructor(key) {
            if (key !== signalKey) throw codedError(TypeError, 'ERR_ILLEGAL_CONSTRUCTOR', 'Illegal constructor');
            super(); signals.set(this, { aborted: false, reason: undefined, onabort: null, dependents: new Set(), sources: [] });
        }
        get aborted() { return signals.get(this).aborted; }
        get reason() { return signals.get(this).reason; }
        get onabort() { return signals.get(this).onabort; }
        set onabort(value) {
            const state = signals.get(this);
            if (state.onabort) this.removeEventListener('abort', state.onabort);
            state.onabort = typeof value === 'function' ? value : null;
            if (state.onabort) this.addEventListener('abort', state.onabort);
        }
        throwIfAborted() { if (this.aborted) throw this.reason; }
        static abort(reason) { const signal = new AbortSignal(signalKey); abort(signal, reason); return signal; }
        static timeout(delay) {
            if (typeof delay !== 'number') throw invalidType('delay', 'a number');
            if (!Number.isInteger(delay) || delay < 0 || delay > 0xffffffff) throw outOfRange('delay');
            const signal = new AbortSignal(signalKey);
            getTimers().setTimeout(() => abort(signal, new DOMException('The operation was aborted due to timeout', 'TimeoutError')), delay).unref();
            return signal;
        }
        static any(input) {
            if (!Array.isArray(input)) throw invalidType('signals', 'an Array');
            for (const signal of input) if (!(signal instanceof AbortSignal) || !signals.has(signal)) throw invalidType('signals', 'an Array of AbortSignal');
            const result = new AbortSignal(signalKey);
            const already = input.find(signal => signal.aborted);
            if (already) { abort(result, already.reason); return result; }
            const records = signals.get(result).sources;
            for (const signal of new Set(input)) {
                const dependent = new WeakRef(result);
                signals.get(signal).dependents.add(dependent);
                records.push([new WeakRef(signal), dependent]);
            }
            if (records.length) dependencyCleanup.register(result, records, result);
            return result;
        }
    }
    function abort(signal, reason = new DOMException('This operation was aborted', 'AbortError')) {
        const pending = [];
        function mark(target) {
            const state = signals.get(target);
            if (state.aborted) return;
            state.aborted = true; state.reason = reason; pending.push(target);
            for (const reference of state.dependents) { const dependent = reference.deref(); if (dependent) mark(dependent); }
            state.dependents.clear();
        }
        mark(signal);
        for (const target of pending) {
            const state = signals.get(target);
            dependencyCleanup.unregister(target);
            for (const [reference, dependent] of state.sources) {
                const source = reference.deref();
                if (source) signals.get(source).dependents.delete(dependent);
            }
            state.sources.length = 0;
            const event = new Event('abort'); events.get(event).trusted = true;
            target.dispatchEvent(event);
        }
    }
    class AbortController {
        constructor() { signals.set(this, new AbortSignal(signalKey)); }
        get signal() { return signals.get(this); }
        abort(reason) { abort(this.signal, reason); }
    }
    for (const [name, constructor] of Object.entries({ Event, EventTarget, DOMException, AbortSignal, AbortController })) {
        Object.defineProperty(constructor.prototype, Symbol.toStringTag, { value: name, configurable: true });
        Object.defineProperty(globalThis, name, { value: constructor, writable: true, configurable: true });
    }
    return { AbortSignal, isSignal: value => value instanceof AbortSignal && signals.has(value) };
}
