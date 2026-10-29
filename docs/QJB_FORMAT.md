# QJB v1 source applications

Run `qjs --bundle app.qjb [-- application-arguments]`. The application is a standard ZIP containing `bundle.json`, its complete source tree and resources. No extraction or source directory is required. QJB does not change the runtime release ZIP.

The UTF-8 JSON manifest requires `format: "qjb"`, `formatVersion: 1` and a relative `entry`. `type` defaults to `module`; `script` selects classic script evaluation, including dynamic import, without CommonJS. A `.mjs` entry requires module mode. Imported sources are ESM. `name` and `version` are optional metadata.

For a minimal application, create these three files under `app/`:

```text
bundle.json       {"format":"qjb","formatVersion":1,"entry":"src/main.mjs"}
assets/message.txt  Hello QJB
src/main.mjs
```

```js
// src/main.mjs
import {resolve, readTextSync} from 'cosmo:bundle';
console.log(readTextSync(resolve('../assets/message.txt', import.meta.url)));
```

Pack with `qjs tools/qjb-pack.mjs app -o app.qjb --deflate`, then run `qjs --bundle app.qjb` from any cwd. The original `app/` directory can be removed after packing.

## Addresses and entry identity

Each opened immutable archive receives a process-unique mount identity. Modules, Workers and resources share `qjb://<id>/path`. Builtins retain their existing aliases. Relative and root-relative imports remain inside the archive; unknown bare names, foreign mount IDs, host paths and root escapes fail. Missing members never fall back to cwd. Resolution collapses dot segments before QuickJS caches modules; case and extensions remain exact.

Addresses use UTF-8 percent encoding. Unreserved bytes and `/` remain literal; other bytes, including spaces, Unicode, `%`, `?` and `#`, are encoded. Input may contain literal Unicode/spaces or valid escapes. Encoded separators, backslashes, NUL/control bytes, malformed UTF-8/escapes and literal query/fragment delimiters are rejected. Archive names must already be relative canonical paths, without empty/dot/parent segments, colons or backslashes. Directory records end in `/`; file/directory conflicts are rejected.

`process.argv` is `[execPath, absoluteBundlePath, ...applicationArguments]`; one separator `--` after the package is removed. `execArgv` contains interpreter options before the package, including `--bundle`. `scriptArgs` contains the package path and application arguments. Host cwd stays unchanged. `import.meta.url` and stack filenames use the canonical QJB address; `import.meta.main` identifies the main or Worker entry. Bundle metadata does not expose misleading host filename/dirname fields.

## Resources, ownership and limits

`cosmo:bundle.resolve(specifier, baseURL)` returns a canonical address. `readFileSync(address)` returns a fresh Buffer; `readTextSync(address)` requires valid UTF-8 and throws on invalid bytes. These functions require a mounted address. Node fs continues to accept host paths. Scripts retain their existing host capabilities: QJB is packaging, not a sandbox or source authentication.

Limits per archive: 64 MiB snapshot, 4096 members, 8 MiB per uncompressed member, 64 MiB total advertised uncompressed bytes/cache, 1024 UTF-8 bytes per name, 1 MiB aggregate names, and 64 KiB manifest. At most four archive objects may coexist in a process. Worker references retain the same native snapshot/index; JS objects and module caches remain private to each Runtime. Native references survive parent context teardown and are released on failed creation and normal teardown.

STORE and raw DEFLATE use the locked Cosmopolitan zlib/CRC implementation. Local headers, central directory, extra fields, data descriptors, nonoverlapping ranges, actual output size and CRC are checked. Content CRC is checked when a member is first read. ZIP64, encryption, multiple volumes, unsupported flags/methods, symlinks/special files, conflicting names, malformed encoding, truncation and quota violations are rejected with `ERR_QJB_FORMAT`, `ERR_QJB_LIMIT`, `ERR_QJB_PATH`, `ERR_QJB_MOUNT`, `ERR_QJB_MEMBER` or `ERR_QJB_UTF8` as appropriate. CRC detects corruption only.

## Packing

`qjs tools/qjb-pack.mjs ./app -o app.qjb` collects the full directory tree in fixed UTF-8 order. `--deflate` optionally compresses each file. Fixed timestamps/attributes make repeated outputs reproducible. Collection rejects links/special files and applies the runtime budgets. The output and its temporary sibling are excluded from collection. Files are processed individually, using bounded chunks, and published by rename only after the archive is complete; failures remove the temporary file and return nonzero.

## Acceptance tasks

QJB-01 covers archive parsing and budgets; QJB-02 covers module resolution/cache; QJB-03 covers entry metadata/await/exit; QJB-04 covers resources and Worker ownership; QJB-05 covers the self-hosted packer; QJB-06 covers transported packages, SDK and types. `scripts/test_bundle.py --prepare --full --qjs dist/qjs.exe --sdk build/test-linux/bundle-sdk.exe` builds the independent corpus and checks all six packages. Cross-host CI consumes those exact packages without regenerating them. `tests/runtime_bundle.mjs` checks clear unmounted errors for ordinary source and qjsc entries. The SDK mounts through `js_cosmo_bundle_eval` after installing the standard loader/Worker context factory; generated qjsc applications do not gain a `--bundle` CLI.

Local acceptance: full build 150/150, Node differential 58/58, Linux cross-host contract 98/98, Windows 100/100 plus the declared Unix-shell skip, Python 110 tests and TypeScript source/SDK declarations passed. The six packages and 50 standalone APEs passed transport integrity checks. Both Linux and Windows ran 41 corruption/quota/exit cases; Windows also verified reproducible STORE/DEFLATE packing and preservation of preexisting temporary files. SDK ownership tests cover unique mount IDs, foreign-address rejection, retained native leases, the four-archive limit and repeated failed-load cleanup. Completion additionally requires the committed seven-platform CI gate.
