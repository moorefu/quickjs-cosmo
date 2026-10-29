/* Prepared input: run-test262 -N -f tests/release-smoke.js */
if (JSON.stringify([1, 2].map(x => x * 2)) !== '[2,4]') throw Error('Array/JSON regression');
if (12345678901234567890n + 1n !== 12345678901234567891n) throw Error('BigInt regression');
if (!/\p{Letter}+/u.test('中文')) throw Error('Unicode property regression');
