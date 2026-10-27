import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { result } from './fixtures/result.mjs';

result({ globalIdentity: globalThis.process === process,
         argvEntryMatchesMeta: process.argv[1] === fileURLToPath(import.meta.url),
         noExtraArgs: process.argv.length === 2,
         sourceMain: import.meta.main,
         cwdType: typeof process.cwd(), executableType: typeof process.execPath });
