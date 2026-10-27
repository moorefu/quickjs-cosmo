import buffer, { Buffer, type Buffer as NodeBuffer } from 'node:buffer';
import { Buffer as BareBuffer } from 'buffer';

const bytes: Uint8Array = Buffer.from('中文', 'utf8');
const shared: NodeBuffer = Buffer.from(new SharedArrayBuffer(16), 2, 8);
const slice: NodeBuffer = shared.slice(1);
slice.fill('a', 'utf8').writeUInt32LE(42);
const combined: NodeBuffer = buffer.Buffer.concat([bytes, BareBuffer.from([1, 2])]);
const bigint: bigint = combined.readBigInt64BE();
const byteCount: number = Buffer.byteLength(shared);
const globalBuffer: NodeBuffer = globalThis.Buffer.alloc(8);
void [bigint, byteCount, globalBuffer];
// @ts-expect-error No numeric Buffer.from overload.
Buffer.from(4);
// @ts-expect-error Encodings are declared names.
Buffer.from('abc', 'invalid');
// @ts-expect-error BigInt and numeric operations are distinct.
shared.writeBigInt64LE(1);
// @ts-expect-error copyBytesFrom accepts TypedArrays rather than DataView.
Buffer.copyBytesFrom(new DataView(new ArrayBuffer(8)));
