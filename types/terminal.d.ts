declare module 'node:tty' {
    import {Readable, ReadableOptions, Writable, StreamCallback} from 'node:stream';
    export function isatty(fd: number): boolean;
    /** This subset constructs the inherited stdin descriptor only. */
    export class ReadStream extends Readable {
        constructor(fd: 0, options?: ReadableOptions);
        readonly fd: 0; readonly isTTY: true; readonly isRaw: boolean;
        setRawMode(mode: boolean): this;
        ref(): this; unref(): this;
    }
    /** This subset constructs inherited stdout/stderr only. */
    export class WriteStream extends Writable {
        constructor(fd: 1 | 2);
        readonly fd: 1 | 2; readonly isTTY: true;
        readonly columns: number; readonly rows: number;
        getWindowSize(): [number, number];
        cursorTo(x: number, callback?: StreamCallback): boolean;
        cursorTo(x: number, y: number, callback?: StreamCallback): boolean;
        moveCursor(dx: number, dy: number, callback?: StreamCallback): boolean;
        clearLine(dir: -1 | 0 | 1, callback?: StreamCallback): boolean;
        clearScreenDown(callback?: StreamCallback): boolean;
    }
    const tty: {isatty: typeof isatty; ReadStream: typeof ReadStream; WriteStream: typeof WriteStream};
    export default tty;
}
declare module 'tty' { export * from 'node:tty'; export {default} from 'node:tty'; }

declare module 'node:readline' {
    import {EventEmitter} from 'node:events';
    import {Readable, Writable, StreamCallback} from 'node:stream';
    export interface Key {sequence?: string; name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; code?: string;}
    export interface ReadLineOptions {
        input: Readable; output?: Writable; terminal?: boolean; prompt?: string;
        history?: string[]; historySize?: number; removeHistoryDuplicates?: boolean;
        crlfDelay?: number; escapeCodeTimeout?: number;
    }
    export interface QuestionOptions {signal?: AbortSignal;}
    export class Interface extends EventEmitter implements AsyncIterable<string> {
        constructor(options: ReadLineOptions);
        constructor(input: Readable, output?: Writable, completer?: undefined, terminal?: boolean);
        readonly input: Readable; readonly output: Writable | undefined;
        readonly terminal: boolean; readonly closed: boolean;
        line: string; cursor: number; readonly history: string[];
        setPrompt(prompt: string): void; getPrompt(): string;
        prompt(preserveCursor?: boolean): void;
        pause(): this; resume(): this; close(): void;
        write(data: string | Uint8Array | null, key?: Key): void;
        question(query: string, callback: (answer: string) => void): void;
        question(query: string, options: QuestionOptions, callback: (answer: string) => void): void;
        [Symbol.asyncIterator](): AsyncIterableIterator<string>;
        [Symbol.dispose](): void;
    }
    export function createInterface(options: ReadLineOptions): Interface;
    export function createInterface(input: Readable, output?: Writable, completer?: undefined, terminal?: boolean): Interface;
    export function emitKeypressEvents(input: Readable, iface?: Interface): void;
    export function cursorTo(stream: Writable, x: number, callback?: StreamCallback): boolean;
    export function cursorTo(stream: Writable, x: number, y: number, callback?: StreamCallback): boolean;
    export function moveCursor(stream: Writable, dx: number, dy: number, callback?: StreamCallback): boolean;
    export function clearLine(stream: Writable, dir: -1 | 0 | 1, callback?: StreamCallback): boolean;
    export function clearScreenDown(stream: Writable, callback?: StreamCallback): boolean;
    export const promises: typeof import('node:readline/promises').default;
    const readline: {Interface: typeof Interface; createInterface: typeof createInterface; emitKeypressEvents: typeof emitKeypressEvents;
        cursorTo: typeof cursorTo; moveCursor: typeof moveCursor; clearLine: typeof clearLine; clearScreenDown: typeof clearScreenDown; promises: typeof promises};
    export default readline;
}
declare module 'readline' { export * from 'node:readline'; export {default} from 'node:readline'; }
declare module 'node:readline/promises' {
    import {Readable, Writable} from 'node:stream';
    import {EventEmitter} from 'node:events';
    import {ReadLineOptions, QuestionOptions} from 'node:readline';
    // Promise question has a distinct signature from the callback interface.
    export class Interface extends EventEmitter implements AsyncIterable<string> {
        constructor(options: ReadLineOptions);
        constructor(input: Readable, output?: Writable, completer?: undefined, terminal?: boolean);
        question(query: string, options?: QuestionOptions): Promise<string>;
        readonly input: Readable; readonly output: Writable | undefined; readonly terminal: boolean; readonly closed: boolean;
        line: string; cursor: number; readonly history: string[];
        setPrompt(prompt: string): void; getPrompt(): string; prompt(preserveCursor?: boolean): void;
        pause(): this; resume(): this; close(): void; write(data: string | Uint8Array | null, key?: import('node:readline').Key): void;
        on(event: string | symbol, listener: (...args: any[]) => void): this;
        once(event: string | symbol, listener: (...args: any[]) => void): this;
        [Symbol.asyncIterator](): AsyncIterableIterator<string>; [Symbol.dispose](): void;
    }
    export function createInterface(options: ReadLineOptions): Interface;
    export function createInterface(input: Readable, output?: Writable, completer?: undefined, terminal?: boolean): Interface;
    const readline: {Interface: typeof Interface; createInterface: typeof createInterface};
    export default readline;
}
declare module 'readline/promises' { export * from 'node:readline/promises'; export {default} from 'node:readline/promises'; }

declare module 'qjs:os' {
    export function isatty(fd: number): boolean;
    export function ttySetRaw(fd: number, enabled?: boolean): void;
    export function ttyGetWinSize(fd: number): [number, number] | null;
    export function read(fd: number, buffer: ArrayBuffer, offset: number, length: number): number;
    export function setReadHandler(fd: number, callback: (() => void) | null): void;
    export function signal(number: number, callback: (() => void) | null): void;
    export const SIGINT: number, SIGTERM: number, SIGHUP: number, SIGWINCH: number;
}

declare module 'os' { export * from 'qjs:os'; }
