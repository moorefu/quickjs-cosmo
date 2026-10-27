import item, { value } from './fixtures/value.mjs';
import { check, result } from './fixtures/result.mjs';

const first = await import('./fixtures/value.mjs');
const second = await import('./fixtures/value.mjs');
check(first === second, 'Repeated imports must share an ESM module instance');
check(first.default === item && first.value === value, 'Static and dynamic imports must agree');
const ordering = [];
await Promise.all([Promise.resolve().then(() => ordering.push(1)),
                   Promise.resolve().then(() => ordering.push(2))]);
result({ value, sameModule: first === second, sameDefault: first.default === item,
         ordering, bigint: (2n ** 80n).toString() });
