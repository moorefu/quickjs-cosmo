/* Process regressions driven by scripts/audit_runtime.py --verify. */
import * as os from "os";
import * as std from "std";

if (scriptArgs[1] === "stdio") {
    const input = std.in.readAsString();
    print(JSON.stringify({ input, marker: std.getenv("QJS_AUDIT_MARKER") }));
    std.err.puts("CHILD_STDERR_OK\n");
    std.exit(7);
}

const config = JSON.parse(std.loadFile(scriptArgs[1]));
const started = Date.now();
const parentCwd = os.getcwd()[0];
const options = { block: !config.async, usePath: !!config.usePath, file: config.program };
if (config.cwd) options.cwd = config.cwd;
if (config.env) options.env = config.env;
if (config.parentPath) std.setenv("PATH", config.parentPath);
if (config.uid !== undefined) options.uid = config.uid;
if (config.gid !== undefined) options.gid = config.gid;
const streams = [];
if (config.capture) {
    for (const [name, flags] of [["stdin", os.O_RDONLY],
                                  ["stdout", os.O_WRONLY | os.O_CREAT | os.O_TRUNC],
                                  ["stderr", os.O_WRONLY | os.O_CREAT | os.O_TRUNC]]) {
        const fd = os.open(config.capture[name], flags, 0o600);
        if (fd < 0) throw Error(`cannot open ${name}: ${fd}`);
        streams.push(fd);
        options[name] = fd;
    }
}
try {
    const result = os.exec(config.argv, options);
    if (!config.async) {
        print("AUDIT_JSON " + JSON.stringify({
            result, unsigned: result >>> 0, parentCwd, cwdAfter: os.getcwd()[0], milliseconds: Date.now() - started,
        }));
    } else {
        const firstWait = os.waitpid(result, os.WNOHANG);
        let current = firstWait;
        const deadline = Date.now() + (config.timeout || 1200);
        while (current[0] !== result && Date.now() < deadline) {
            os.sleep(10);
            current = os.waitpid(result, os.WNOHANG);
        }
        const timedOut = current[0] !== result;
        if (timedOut) {
            os.kill(result, os.SIGKILL);
            current = os.waitpid(result, 0);
        }
        print("AUDIT_JSON " + JSON.stringify({
            firstWait, wait: current, timedOut, milliseconds: Date.now() - started,
        }));
    }
} catch (error) {
    print("AUDIT_JSON " + JSON.stringify({ error: String(error), milliseconds: Date.now() - started }));
} finally {
    for (const fd of streams) os.close(fd);
}
