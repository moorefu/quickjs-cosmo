import assert from 'node:assert/strict';
import { resolve, readFileSync, readTextSync } from 'cosmo:bundle';
assert.throws(()=>resolve('./x','qjb://none/base'),{code:'ERR_QJB_MOUNT'});
assert.throws(()=>readFileSync('qjb://none/x'),{code:'ERR_QJB_MOUNT'});
assert.throws(()=>readTextSync('qjb://none/x'),{code:'ERR_QJB_MOUNT'});
assert.throws(()=>resolve(null,'qjb://none/base'),{name:'TypeError'});
assert.throws(()=>readTextSync('qjb://none/\0'),{code:'ERR_QJB_PATH'});
console.log('PASS runtime-bundle-unmounted');
