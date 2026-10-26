import * as std from "std";
import * as os from "os";
import { equal, assert, finish } from "./assert.js";

// The runner gives each process a private scratch working directory.
const directory = `quickjs-${os.getpid()}-${Date.now()}-中文`;
const original = `${directory}/input.txt`;
const renamed = `${directory}/renamed.txt`;
const text = "QuickJS + Cosmopolitan\n你好，世界 🌏\n";
let file;
try {
    equal(os.mkdir(directory), 0);
    file = std.open(original, "w");
    assert(file !== null, "open UTF-8 path");
    file.puts(text);
    equal(file.close(), 0);
    file = null;
    equal(std.loadFile(original), text);
    const [entries, readError] = os.readdir(directory);
    equal(readError, 0);
    assert(entries.includes("input.txt"));
    const [info, statError] = os.stat(original);
    equal(statError, 0);
    assert(info.size > text.length, "stat size counts UTF-8 bytes");
    equal(os.rename(original, renamed), 0);
    file = std.open(renamed, "r");
    equal(file.getline(), "QuickJS + Cosmopolitan");
    equal(file.getline(), "你好，世界 🌏");
    equal(file.getline(), null);
    equal(file.close(), 0);
    file = null;
    const [missing, missingError] = os.stat(`${directory}/missing`);
    equal(missing, null);
    equal(missingError, std.Error.ENOENT, "stat returns a positive errno on failure");
    equal(std.sprintf("%04d %s", 42, "ok"), "0042 ok");
    equal(typeof std.getenv("PATH"), "string");
} finally {
    if (file) file.close();
    os.remove(original);
    os.remove(renamed);
    os.remove(directory);
}
finish("io");
