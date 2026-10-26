const engine = "QuickJS + Cosmopolitan";
print(`Hello from ${engine}!`);
print(`BigInt: 2^100 = ${2n ** 100n}`);
print(`Unicode: ${"e\u0301".normalize("NFC")} / 你好，世界 🌏`);
