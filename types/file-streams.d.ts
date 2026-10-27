declare module 'node:fs' {
    import {BufferEncoding} from 'node:buffer';
    import {Readable, Writable, StreamOptions} from 'node:stream';
    import {FileHandle} from 'node:fs/promises';
    export interface FileStreamOptions extends StreamOptions {
        flags?:string|number; encoding?:BufferEncoding; fd?:number|FileHandle; mode?:Mode;
        autoClose?:boolean; start?:number; highWaterMark?:number;
    }
    export interface ReadStreamOptions extends FileStreamOptions {end?:number;}
    export interface WriteStreamOptions extends FileStreamOptions {flush?:boolean;}
    export class ReadStream extends Readable {
        constructor(path:PathLike|undefined, options?:ReadStreamOptions|BufferEncoding);
        fd:number|null; path:PathLike|undefined; readonly pending:boolean; readonly bytesRead:number;
        close(callback?:()=>void):void;
    }
    export class WriteStream extends Writable {
        constructor(path:PathLike|undefined, options?:WriteStreamOptions|BufferEncoding);
        fd:number|null; path:PathLike|undefined; readonly pending:boolean; readonly bytesWritten:number;
        close(callback?:()=>void):void;
    }
    export function createReadStream(path:PathLike|undefined, options?:ReadStreamOptions|BufferEncoding):ReadStream;
    export function createWriteStream(path:PathLike|undefined, options?:WriteStreamOptions|BufferEncoding):WriteStream;
    interface AsyncFsMethods {ReadStream:typeof ReadStream; WriteStream:typeof WriteStream; createReadStream:typeof createReadStream; createWriteStream:typeof createWriteStream;}
}
declare module 'node:fs/promises' {
    import {ReadStream,WriteStream,ReadStreamOptions,WriteStreamOptions} from 'node:fs';
    interface FileHandle {
        createReadStream(options?:Omit<ReadStreamOptions,'fd'>):ReadStream;
        createWriteStream(options?:Omit<WriteStreamOptions,'fd'>):WriteStream;
    }
}
