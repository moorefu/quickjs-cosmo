import process from 'node:process';
import { result } from './fixtures/result.mjs';

// This source-entry fixture deliberately does not require the later URL module.
const decoded = decodeURIComponent(import.meta.url.slice(7));
const entry = process.platform === 'win32' ? decoded.replace(/^\/([A-Za-z]:\/)/, '$1').replace(/\//g, '\\') : decoded;
result({ globalIdentity: globalThis.process === process,
         argvEntryMatchesMeta: process.argv[1] === entry,
         noExtraArgs: process.argv.length === 2,
         sourceMain: import.meta.main,
         cwdType: typeof process.cwd(), executableType: typeof process.execPath });
