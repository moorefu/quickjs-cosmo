import * as os from "os";
import * as std from "std";

const [cwd, error] = os.getcwd();
if (error) throw new Error(`getcwd failed: ${error}`);
print(JSON.stringify({
    engine: "QuickJS",
    platform: os.platform,
    pid: os.getpid(),
    cwd,
    arguments: scriptArgs.slice(1),
    workerAvailable: typeof os.Worker === "function",
    pathAvailable: typeof std.getenv("PATH") === "string",
    timestamp: new Date().toISOString(),
}, null, 2));
