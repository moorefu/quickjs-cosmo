import * as os from "os";

const parent = os.Worker.parent;
parent.onmessage = ({ data }) => {
    const shared = new Int32Array(data.shared);
    const previous = Atomics.add(shared, 0, 1);
    parent.postMessage({
        answer: data.value * 2n,
        bytes: new Uint8Array([...data.bytes].reverse()),
        previous,
    });
    parent.onmessage = null;
};
