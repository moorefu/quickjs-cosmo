// The implemented ESM subset. This file does not declare unimplemented Node APIs.
declare module 'node:buffer' {
    export type BufferEncoding = 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'utf-16le' |
        'ucs2' | 'ucs-2' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex';
    // Intersection preserves Uint8Array assignability while allowing Buffer's
    // shared slice() contract, including views over SharedArrayBuffer.
    export type Buffer = BufferMethods & Uint8Array;
    export type TypedArray = Uint8Array | Uint8ClampedArray | Int8Array | Uint16Array | Int16Array |
        Uint32Array | Int32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array;
    export interface BufferMethods {
        toString(encoding?: BufferEncoding, start?: number, end?: number): string;
        toJSON(): { type: 'Buffer'; data: number[] };
        equals(other: Uint8Array): boolean;
        compare(target: Uint8Array, targetStart?: number, targetEnd?: number, sourceStart?: number, sourceEnd?: number): number;
        copy(target: Uint8Array, targetStart?: number, sourceStart?: number, sourceEnd?: number): number;
        fill(value: string | number | Uint8Array, offset?: number, end?: number, encoding?: BufferEncoding): this;
        fill(value: string, encoding: BufferEncoding): this;
        slice(start?: number, end?: number): Buffer;
        subarray(start?: number, end?: number): Buffer;
        write(value: string, encoding?: BufferEncoding): number;
        write(value: string, offset: number, length?: number, encoding?: BufferEncoding): number;
        indexOf(value: string | number | Uint8Array, byteOffset?: number, encoding?: BufferEncoding): number;
        lastIndexOf(value: string | number | Uint8Array, byteOffset?: number, encoding?: BufferEncoding): number;
        includes(value: string | number | Uint8Array, byteOffset?: number, encoding?: BufferEncoding): boolean;
        swap16(): this;
        swap32(): this;
        swap64(): this;
        readonly parent: ArrayBufferLike;
        readonly offset: number;
        readUInt8(offset?: number): number;
        readInt8(offset?: number): number;
        readUInt16LE(offset?: number): number;
        readUInt16BE(offset?: number): number;
        readInt16LE(offset?: number): number;
        readInt16BE(offset?: number): number;
        readUInt32LE(offset?: number): number;
        readUInt32BE(offset?: number): number;
        readInt32LE(offset?: number): number;
        readInt32BE(offset?: number): number;
        readUIntLE(offset: number, byteLength: number): number;
        readUIntBE(offset: number, byteLength: number): number;
        readIntLE(offset: number, byteLength: number): number;
        readIntBE(offset: number, byteLength: number): number;
        readFloatLE(offset?: number): number;
        readFloatBE(offset?: number): number;
        readDoubleLE(offset?: number): number;
        readDoubleBE(offset?: number): number;
        readBigUInt64LE(offset?: number): bigint;
        readBigUInt64BE(offset?: number): bigint;
        readBigInt64LE(offset?: number): bigint;
        readBigInt64BE(offset?: number): bigint;
        writeUInt8(value: number, offset?: number): number;
        writeInt8(value: number, offset?: number): number;
        writeUInt16LE(value: number, offset?: number): number;
        writeUInt16BE(value: number, offset?: number): number;
        writeInt16LE(value: number, offset?: number): number;
        writeInt16BE(value: number, offset?: number): number;
        writeUInt32LE(value: number, offset?: number): number;
        writeUInt32BE(value: number, offset?: number): number;
        writeInt32LE(value: number, offset?: number): number;
        writeInt32BE(value: number, offset?: number): number;
        writeUIntLE(value: number, offset: number, byteLength: number): number;
        writeUIntBE(value: number, offset: number, byteLength: number): number;
        writeIntLE(value: number, offset: number, byteLength: number): number;
        writeIntBE(value: number, offset: number, byteLength: number): number;
        writeFloatLE(value: number, offset?: number): number;
        writeFloatBE(value: number, offset?: number): number;
        writeDoubleLE(value: number, offset?: number): number;
        writeDoubleBE(value: number, offset?: number): number;
        writeBigUInt64LE(value: bigint, offset?: number): number;
        writeBigUInt64BE(value: bigint, offset?: number): number;
        writeBigInt64LE(value: bigint, offset?: number): number;
        writeBigInt64BE(value: bigint, offset?: number): number;
        readUint8: BufferMethods['readUInt8'];
        readUint16LE: BufferMethods['readUInt16LE'];
        readUint16BE: BufferMethods['readUInt16BE'];
        readUint32LE: BufferMethods['readUInt32LE'];
        readUint32BE: BufferMethods['readUInt32BE'];
        readUintLE: BufferMethods['readUIntLE'];
        readUintBE: BufferMethods['readUIntBE'];
        readBigUint64LE: BufferMethods['readBigUInt64LE'];
        readBigUint64BE: BufferMethods['readBigUInt64BE'];
        writeUint8: BufferMethods['writeUInt8'];
        writeUint16LE: BufferMethods['writeUInt16LE'];
        writeUint16BE: BufferMethods['writeUInt16BE'];
        writeUint32LE: BufferMethods['writeUInt32LE'];
        writeUint32BE: BufferMethods['writeUInt32BE'];
        writeUintLE: BufferMethods['writeUIntLE'];
        writeUintBE: BufferMethods['writeUIntBE'];
        writeBigUint64LE: BufferMethods['writeBigUInt64LE'];
        writeBigUint64BE: BufferMethods['writeBigUInt64BE'];
    }
    export interface BufferConstructor {
        readonly prototype: Buffer;
        poolSize: number;
        from(value: string, encoding?: BufferEncoding): Buffer;
        from(value: ArrayBufferLike, byteOffset?: number, length?: number): Buffer;
        from(value: ArrayLike<number> | { type: 'Buffer'; data: number[] }): Buffer;
        alloc(size: number, fill?: string | number | Uint8Array, encoding?: BufferEncoding): Buffer;
        allocUnsafe(size: number): Buffer;
        allocUnsafeSlow(size: number): Buffer;
        isBuffer(value: unknown): value is Buffer;
        isEncoding(value: unknown): value is BufferEncoding;
        byteLength(value: string | ArrayBufferLike | ArrayBufferView, encoding?: BufferEncoding): number;
        concat(list: readonly Uint8Array[], totalLength?: number): Buffer;
        compare(a: Uint8Array, b: Uint8Array): number;
        copyBytesFrom(view: TypedArray, offset?: number, length?: number): Buffer;
    }
    export const Buffer: BufferConstructor;
    export function SlowBuffer(length: number): Buffer;
    export const kMaxLength: number;
    export const kStringMaxLength: number;
    export const constants: Readonly<{ MAX_LENGTH: number; MAX_STRING_LENGTH: number }>;
    const api: { Buffer: BufferConstructor; SlowBuffer: typeof SlowBuffer; kMaxLength: number;
                 kStringMaxLength: number; constants: typeof constants };
    export default api;
}
declare module 'buffer' {
    export * from 'node:buffer';
    import api from 'node:buffer';
    export default api;
}
declare var Buffer: import('node:buffer').BufferConstructor;
type Buffer = import('node:buffer').Buffer;

interface TextEncoderEncodeIntoResult { read: number; written: number; }
interface TextDecodeOptions { stream?: boolean; }
interface TextDecoderOptions { fatal?: boolean; ignoreBOM?: boolean; }
interface TextEncoder {
    readonly encoding: string;
    encode(input?: string): Uint8Array<ArrayBuffer>;
    encodeInto(source: string, destination: Uint8Array<ArrayBufferLike>): TextEncoderEncodeIntoResult;
}
declare var TextEncoder: { prototype: TextEncoder; new(): TextEncoder; };
interface TextDecoder {
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
    decode(input?: ArrayBufferLike | ArrayBufferView, options?: TextDecodeOptions): string;
}
declare var TextDecoder: { prototype: TextDecoder; new(label?: string, options?: TextDecoderOptions): TextDecoder; };

declare module 'node:events' {
    export type Listener = (...args: any[]) => void;
    export class EventEmitter {
        constructor(options?: { captureRejections?: false });
        static EventEmitter: typeof EventEmitter;
        static errorMonitor: typeof errorMonitor;
        static listenerCount(emitter: EventEmitter, eventName: string | symbol): number;
        on(eventName: string | symbol, listener: Listener): this;
        addListener(eventName: string | symbol, listener: Listener): this;
        once(eventName: string | symbol, listener: Listener): this;
        prependListener(eventName: string | symbol, listener: Listener): this;
        prependOnceListener(eventName: string | symbol, listener: Listener): this;
        off(eventName: string | symbol, listener: Listener): this;
        removeListener(eventName: string | symbol, listener: Listener): this;
        removeAllListeners(eventName?: string | symbol): this;
        emit(eventName: string | symbol, ...args: any[]): boolean;
        listeners(eventName: string | symbol): Listener[];
        rawListeners(eventName: string | symbol): Listener[];
        listenerCount(eventName: string | symbol, listener?: Listener): number;
        eventNames(): (string | symbol)[];
    }
    export const errorMonitor: unique symbol;
    export const listenerCount: typeof EventEmitter.listenerCount;
    export default EventEmitter;
}
declare module 'events' { export * from 'node:events'; export { default } from 'node:events'; }

declare module 'node:process' {
    import { EventEmitter } from 'node:events';
    export interface ProcessEnv { [name: string]: string | undefined; }
    export interface Process extends EventEmitter {
        argv: string[];
        execArgv: string[];
        execPath: string;
        env: ProcessEnv;
        pid: number;
        ppid: number;
        platform: string;
        arch: string;
        versions: { quickjs: string; cosmopolitan: string; quickjsCommit: string; cosmopolitanCommit: string; };
        exitCode: number | string | undefined;
        cwd(): string;
        chdir(directory: string): void;
        exit(code?: number | string): never;
        uptime(): number;
        hrtime: { (previous?: [number, number]): [number, number]; bigint(): bigint; };
    }
    export const argv: Process['argv'], execArgv: Process['execArgv'], execPath: string, env: ProcessEnv;
    export const pid: number, ppid: number, platform: string, arch: string, versions: Process['versions'];
    export let exitCode: Process['exitCode'];
    export const cwd: Process['cwd'], chdir: Process['chdir'], exit: Process['exit'];
    export const uptime: Process['uptime'], hrtime: Process['hrtime'];
    const process: Process;
    export default process;
}
declare module 'process' { export * from 'node:process'; export { default } from 'node:process'; }
declare var process: import('node:process').Process;

declare module 'node:path' {
    export interface ParsedPath { root: string; dir: string; base: string; ext: string; name: string; }
    export interface PlatformPath {
        resolve(...paths: string[]): string;
        normalize(path: string): string;
        join(...paths: string[]): string;
        relative(from: string, to: string): string;
        dirname(path: string): string;
        basename(path: string, suffix?: string): string;
        extname(path: string): string;
        parse(path: string): ParsedPath;
        format(pathObject: Partial<ParsedPath>): string;
        isAbsolute(path: string): boolean;
        toNamespacedPath(path: string): string;
        _makeLong(path: string): string;
        sep: string;
        delimiter: string;
        posix: PlatformPath;
        win32: PlatformPath;
    }
    export const resolve: PlatformPath['resolve'], normalize: PlatformPath['normalize'], join: PlatformPath['join'];
    export const relative: PlatformPath['relative'], dirname: PlatformPath['dirname'], basename: PlatformPath['basename'];
    export const extname: PlatformPath['extname'], parse: PlatformPath['parse'], format: PlatformPath['format'];
    export const isAbsolute: PlatformPath['isAbsolute'], toNamespacedPath: PlatformPath['toNamespacedPath'];
    export const _makeLong: PlatformPath['_makeLong'];
    export const sep: string, delimiter: string, posix: PlatformPath, win32: PlatformPath;
    const path: PlatformPath;
    export default path;
}
declare module 'path' { export * from 'node:path'; export { default } from 'node:path'; }
declare module 'node:path/posix' { export * from 'node:path'; export { default } from 'node:path'; }
declare module 'node:path/win32' { export * from 'node:path'; export { default } from 'node:path'; }
declare module 'path/posix' { export * from 'node:path/posix'; export { default } from 'node:path/posix'; }
declare module 'path/win32' { export * from 'node:path/win32'; export { default } from 'node:path/win32'; }

declare module 'node:os' {
    export function platform(): string;
    export function arch(): string;
    export function tmpdir(): string;
    export function homedir(): string;
    export function hostname(): string;
    export function type(): string;
    export function release(): string;
    export const EOL: string;
    const os: { platform: typeof platform; arch: typeof arch; tmpdir: typeof tmpdir; homedir: typeof homedir;
                hostname: typeof hostname; type: typeof type; release: typeof release; EOL: string; };
    export default os;
}
// Bare 'os' remains the upstream QuickJS module.

declare module 'node:util' {
    export function promisify<T>(original: (callback: (error: any, result: T) => void) => void): () => Promise<T>;
    export function promisify<A, T>(original: (a: A, callback: (error: any, result: T) => void) => void): (a: A) => Promise<T>;
    export function promisify<A, B, T>(original: (a: A, b: B, callback: (error: any, result: T) => void) => void): (a: A, b: B) => Promise<T>;
    export function promisify(original: (...args: any[]) => any): (...args: any[]) => Promise<any>;
    export namespace promisify { const custom: unique symbol; }
    export const TextEncoder: typeof globalThis.TextEncoder, TextDecoder: typeof globalThis.TextDecoder;
    const util: { promisify: typeof promisify; TextEncoder: typeof TextEncoder; TextDecoder: typeof TextDecoder; };
    export default util;
}
declare module 'util' { export * from 'node:util'; export { default } from 'node:util'; }

declare module 'node:assert' {
    export class AssertionError extends Error {
        constructor(options: { message?: string; actual?: unknown; expected?: unknown; operator?: string; });
        code: 'ERR_ASSERTION'; actual: unknown; expected: unknown; operator: string | undefined; generatedMessage: boolean;
    }
    export type ErrorCriteria = RegExp | (new(...args: any[]) => Error) | ((error: any) => boolean) | Record<string, unknown>;
    export function ok(value: unknown, message?: string | Error): asserts value;
    export function equal(actual: unknown, expected: unknown, message?: string | Error): void;
    export function notEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    export function strictEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T;
    export function notStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    export function throws(block: () => unknown, error?: ErrorCriteria | string, message?: string | Error): void;
    export function rejects(block: PromiseLike<unknown> | (() => PromiseLike<unknown>), error?: ErrorCriteria | string, message?: string | Error): Promise<void>;
    export function fail(message?: string | Error): never;
    export interface Assert {
        (value: unknown, message?: string | Error): asserts value;
        ok: typeof ok; equal: typeof equal; notEqual: typeof notEqual; strictEqual: typeof strictEqual;
        notStrictEqual: typeof notStrictEqual; throws: typeof throws; rejects: typeof rejects; fail: typeof fail;
        AssertionError: typeof AssertionError; strict: Assert;
    }
    export const strict: Assert;
    const assert: Assert;
    export default assert;
}
declare module 'assert' { export * from 'node:assert'; export { default } from 'node:assert'; }
declare module 'node:assert/strict' { export * from 'node:assert'; export { default } from 'node:assert'; }
declare module 'assert/strict' { export * from 'node:assert/strict'; export { default } from 'node:assert/strict'; }

interface Console {
    log(...args: any[]): void; info(...args: any[]): void; debug(...args: any[]): void;
    error(...args: any[]): void; warn(...args: any[]): void;
    assert(condition?: boolean, ...data: any[]): void;
    dir(item?: any, options?: { depth?: number }): void;
    trace(...args: any[]): void;
}
declare var console: Console;

interface SymbolConstructor { readonly dispose: unique symbol; readonly asyncDispose: unique symbol; }
interface EventListener { (event: Event): void; }
interface EventListenerObject { handleEvent(event: Event): void; }
interface EventListenerOptions { capture?: boolean; }
interface AddEventListenerOptions extends EventListenerOptions { once?: boolean; passive?: boolean; signal?: AbortSignal; }
interface EventInit { bubbles?: boolean; cancelable?: boolean; composed?: boolean; }
interface EventConstants { readonly NONE: 0; readonly CAPTURING_PHASE: 1; readonly AT_TARGET: 2; readonly BUBBLING_PHASE: 3; }
interface Event extends EventConstants {
    readonly type: string; readonly target: EventTarget | null; readonly currentTarget: EventTarget | null;
    readonly srcElement: EventTarget | null; readonly bubbles: boolean; readonly cancelable: boolean;
    readonly composed: boolean; readonly defaultPrevented: boolean; readonly isTrusted: boolean;
    readonly timeStamp: number; readonly eventPhase: number;
    cancelBubble: boolean; returnValue: boolean;
    preventDefault(): void; stopPropagation(): void; stopImmediatePropagation(): void;
    composedPath(): EventTarget[];
    initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void;
}
declare var Event: { prototype: Event; new(type: string, eventInitDict?: EventInit): Event;
    readonly NONE: 0; readonly CAPTURING_PHASE: 1; readonly AT_TARGET: 2; readonly BUBBLING_PHASE: 3;
};
interface EventTarget {
    addEventListener(type: string, callback: EventListener | EventListenerObject | null, options?: AddEventListenerOptions | boolean): void;
    removeEventListener(type: string, callback: EventListener | EventListenerObject | null, options?: EventListenerOptions | boolean): void;
    dispatchEvent(event: Event): boolean;
}
declare var EventTarget: { prototype: EventTarget; new(): EventTarget; };
interface DOMExceptionConstants {
    readonly INDEX_SIZE_ERR: 1; readonly DOMSTRING_SIZE_ERR: 2; readonly HIERARCHY_REQUEST_ERR: 3;
    readonly WRONG_DOCUMENT_ERR: 4; readonly INVALID_CHARACTER_ERR: 5; readonly NO_DATA_ALLOWED_ERR: 6;
    readonly NO_MODIFICATION_ALLOWED_ERR: 7; readonly NOT_FOUND_ERR: 8; readonly NOT_SUPPORTED_ERR: 9;
    readonly INUSE_ATTRIBUTE_ERR: 10; readonly INVALID_STATE_ERR: 11; readonly SYNTAX_ERR: 12;
    readonly INVALID_MODIFICATION_ERR: 13; readonly NAMESPACE_ERR: 14; readonly INVALID_ACCESS_ERR: 15;
    readonly VALIDATION_ERR: 16; readonly TYPE_MISMATCH_ERR: 17; readonly SECURITY_ERR: 18;
    readonly NETWORK_ERR: 19; readonly ABORT_ERR: 20; readonly URL_MISMATCH_ERR: 21;
    readonly QUOTA_EXCEEDED_ERR: 22; readonly TIMEOUT_ERR: 23; readonly INVALID_NODE_TYPE_ERR: 24; readonly DATA_CLONE_ERR: 25;
}
interface DOMException extends Error, DOMExceptionConstants { readonly code: number; readonly message: string; readonly name: string; }
declare var DOMException: { prototype: DOMException; new(message?: string, name?: string): DOMException;
    readonly INDEX_SIZE_ERR: 1; readonly DOMSTRING_SIZE_ERR: 2; readonly HIERARCHY_REQUEST_ERR: 3;
    readonly WRONG_DOCUMENT_ERR: 4; readonly INVALID_CHARACTER_ERR: 5; readonly NO_DATA_ALLOWED_ERR: 6;
    readonly NO_MODIFICATION_ALLOWED_ERR: 7; readonly NOT_FOUND_ERR: 8; readonly NOT_SUPPORTED_ERR: 9;
    readonly INUSE_ATTRIBUTE_ERR: 10; readonly INVALID_STATE_ERR: 11; readonly SYNTAX_ERR: 12;
    readonly INVALID_MODIFICATION_ERR: 13; readonly NAMESPACE_ERR: 14; readonly INVALID_ACCESS_ERR: 15;
    readonly VALIDATION_ERR: 16; readonly TYPE_MISMATCH_ERR: 17; readonly SECURITY_ERR: 18;
    readonly NETWORK_ERR: 19; readonly ABORT_ERR: 20; readonly URL_MISMATCH_ERR: 21;
    readonly QUOTA_EXCEEDED_ERR: 22; readonly TIMEOUT_ERR: 23; readonly INVALID_NODE_TYPE_ERR: 24; readonly DATA_CLONE_ERR: 25;
};
interface AbortSignal extends EventTarget {
    readonly aborted: boolean; readonly reason: any;
    onabort: ((this: AbortSignal, ev: Event) => any) | null;
    throwIfAborted(): void;
}
declare var AbortSignal: {
    prototype: AbortSignal; new(): AbortSignal;
    abort(reason?: any): AbortSignal; any(signals: AbortSignal[]): AbortSignal; timeout(milliseconds: number): AbortSignal;
};
interface AbortController { readonly signal: AbortSignal; abort(reason?: any): void; }
declare var AbortController: { prototype: AbortController; new(): AbortController; };

declare module 'node:timers' {
    export interface Timeout {
        ref(): this; unref(): this; hasRef(): boolean; refresh(): this; close(): this;
        [Symbol.toPrimitive](): number; [Symbol.dispose](): void;
    }
    export interface Immediate { ref(): this; unref(): this; hasRef(): boolean; [Symbol.dispose](): void; }
    export function setTimeout<T extends any[]>(callback: (...args: T) => void, delay?: number, ...args: T): Timeout;
    export function setInterval<T extends any[]>(callback: (...args: T) => void, delay?: number, ...args: T): Timeout;
    export function clearTimeout(timeout: Timeout | number | string | undefined): void;
    export const clearInterval: typeof clearTimeout;
    export function setImmediate<T extends any[]>(callback: (...args: T) => void, ...args: T): Immediate;
    export function clearImmediate(immediate: Immediate | undefined): void;
    export const promises: typeof import('node:timers/promises').default;
    const timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout;
        setInterval: typeof setInterval; clearInterval: typeof clearInterval;
        setImmediate: typeof setImmediate; clearImmediate: typeof clearImmediate; promises: typeof promises; };
    export default timers;
}
declare module 'timers' { export * from 'node:timers'; export { default } from 'node:timers'; }
declare module 'node:timers/promises' {
    export interface TimerOptions { ref?: boolean; signal?: AbortSignal; }
    export function setTimeout<T = void>(delay?: number, value?: T, options?: TimerOptions): Promise<T>;
    export function setImmediate<T = void>(value?: T, options?: TimerOptions): Promise<T>;
    export function setInterval<T = void>(delay?: number, value?: T, options?: TimerOptions): AsyncGenerator<T, void, unknown>;
    const timers: { setTimeout: typeof setTimeout; setImmediate: typeof setImmediate; setInterval: typeof setInterval; };
    export default timers;
}
declare module 'timers/promises' { export * from 'node:timers/promises'; export { default } from 'node:timers/promises'; }
declare function setTimeout<T extends any[]>(callback: (...args: T) => void, delay?: number, ...args: T): import('node:timers').Timeout;
declare function setInterval<T extends any[]>(callback: (...args: T) => void, delay?: number, ...args: T): import('node:timers').Timeout;
declare function clearTimeout(timeout: import('node:timers').Timeout | number | string | undefined): void;
declare function clearInterval(timeout: import('node:timers').Timeout | number | string | undefined): void;
declare function setImmediate<T extends any[]>(callback: (...args: T) => void, ...args: T): import('node:timers').Immediate;
declare function clearImmediate(immediate: import('node:timers').Immediate | undefined): void;
declare function queueMicrotask(callback: VoidFunction): void;
interface VoidFunction { (): void; }
declare module 'node:process' {
    export interface Process { nextTick<T extends any[]>(callback: (...args: T) => void, ...args: T): void; }
    export const nextTick: Process['nextTick'];
}
