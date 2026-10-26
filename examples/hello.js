const engine = "QuickJS + Cosmopolitan 4.0.2";
print(`Hello from ${engine}!`);
print(`BigInt: 2^100 = ${2n ** 100n}`);
print(`Unicode: ${"e\u0301".normalize("NFC")} / 你好，世界 🌏`);
