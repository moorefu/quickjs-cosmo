import * as os from "os";
import * as std from "std";
import { equal, finish } from "./assert.js";

const pipeCount = 100;
const resources = [];
let received = 0;
const watchdog = os.setTimeout(() => {
    std.err.puts(`FAIL io-events: received ${received}/${pipeCount}\n`);
    std.exit(1);
}, 10000);

for (let i = 0; i < pipeCount; i++) {
    const [readFd, writeFd] = os.pipe();
    resources.push([readFd, writeFd]);
    os.setReadHandler(readFd, () => {
        const value = new Uint32Array(1);
        equal(os.read(readFd, value.buffer, 0, 4), 4);
        equal(value[0], i + 42);
        os.setReadHandler(readFd, null);
        os.close(readFd);
        if (++received === pipeCount) {
            os.clearTimeout(watchdog);
            finish("io-events");
        }
    });
}
for (let i = pipeCount - 1; i >= 0; i--) {
    const [, writeFd] = resources[i];
    os.setWriteHandler(writeFd, () => {
        const value = new Uint32Array([i + 42]);
        equal(os.write(writeFd, value.buffer, 0, 4), 4);
        os.setWriteHandler(writeFd, null);
        os.close(writeFd);
    });
}
