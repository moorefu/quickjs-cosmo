import { result } from './fixtures/result.mjs';

console.log('plain', 1, true, undefined, null);
console.info('%s %d %i %f %j %%', 'text', '2.5', '3.9', '4.5', { a: 1 });
console.debug('%%');
console.log('%c text', 'ignored CSS');
console.log({ a: 1, b: 'text' }, ['x', 2], Buffer.from([1, 2, 255]));
console.warn('warning %s', 'text');
console.error('error', 5);
console.assert(true, 'not printed');
console.assert(false, 'assertion %d', 3);
console.log('lone', '\ud800');
result({ finished: true });
