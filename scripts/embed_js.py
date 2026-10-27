#!/usr/bin/env python3
"""Embed reviewed JavaScript sources without invoking a not-yet-built qjsc."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE_SOURCES = ("src/js/internal/errors.js", "src/js/internal/encoding.js", "src/js/node/buffer.js",
                "src/js/node/events.js", "src/js/node/process.js", "src/js/node/path-adapter.js",
                "src/js/node/os.js", "src/js/node/util.js", "src/js/node/assert.js", "src/js/node/console.js")


def generate(root=ROOT):
    for entry in json.loads((root / "compat/node-sources.json").read_text(encoding="utf-8"))["files"]:
        if hashlib.sha256((root / entry["path"]).read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError("Pinned Node source changed: " + entry["path"])
    path_source = (root / "src/js/vendor/node/path.js").read_text(encoding="utf-8")
    path_factory = ("function createPathModule(process) {\n"
                    "const environment = createPathEnvironment(process);\n"
                    "const primordials = environment.primordials, require = environment.require;\n"
                    "const module = {exports: {}};\n" + path_source +
                    "\ndelete module.exports.win32.matchesGlob; delete module.exports.posix.matchesGlob;\n"
                    "return module.exports;\n}\n")
    finish = """
let path;
const process = createProcess(native, data, () => path);
path = createPathModule(process);
const os = createOs(native, process, path);
const console = createConsole(native);
function fileURL(filename) {
    let name = native.platform === 'win32' ? filename.replace(/\\\\/g, '/') : filename;
    if (native.platform === 'win32' && name.startsWith('//')) {
        const slash = name.indexOf('/', 2);
        return 'file://' + name.slice(2, slash) + name.slice(slash).split('/').map(encodeURIComponent).join('/');
    }
    const parts = name.split('/').map(encodeURIComponent);
    if (native.platform === 'win32' && /^[A-Za-z]:/.test(name)) parts[0] = name.slice(0, 2);
    return (name.startsWith('/') ? 'file://' : 'file:///') + parts.join('/');
}
Object.defineProperty(globalThis, 'console', {value: console, writable: true, configurable: true});
return {
    'node:buffer': bufferExports, 'node:process': exportObject(process),
    'node:path': exportObject(path), 'node:path/posix': exportObject(path.posix),
    'node:path/win32': exportObject(path.win32), 'node:os': exportObject(os),
    'node:events': eventsAPI, 'node:util': exportObject(utilAPI),
    'node:assert': assertionExports(assert), 'node:assert/strict': assertionExports(strictAssert),
    _console: console,
    _importMeta: (name, main, mode, root) => name.startsWith('<') ? 'qjs:internal' : mode === 1 && main ? 'qjs:eval' : mode === 2 ? main ? fileURL(native.executablePath) :
        'qjs:embedded/' + path.posix.relative(root ?? '.', name).split('/').map(encodeURIComponent).join('/') : fileURL(name),
    _snapshot: () => ({...data, argv: process.argv, execArgv: process.execArgv, env: {...process.env}})
};
"""
    source = "(function(native, data) {\n'use strict';\n" + "\n".join(
        (root / name).read_text(encoding="utf-8") for name in CORE_SOURCES) + "\n" + path_factory + finish + "\n})\n"
    lines = ["/* Generated from src/js; no runtime filesystem dependency. */",
             "static const char qjs_core_source[] ="]
    lines.extend(json.dumps(line, ensure_ascii=True).replace('?', r'\?') for line in source.splitlines(keepends=True))
    return "\n".join(lines) + ";\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    content = generate()
    if not args.output.exists() or args.output.read_text(encoding="utf-8") != content:
        with args.output.open("w", encoding="utf-8", newline="\n") as output:
            output.write(content)


if __name__ == "__main__":
    main()
