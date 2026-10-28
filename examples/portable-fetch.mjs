import assert from 'node:assert/strict';
const target=process.argv[2];
if(!target)throw new TypeError('Usage: portable-fetch.mjs <http-or-https-json-url>');
const response=await fetch(target,{signal:AbortSignal.timeout(5000)});
assert.equal(response.ok,true);
console.log(JSON.stringify({example:'fetch',status:response.status,body:await response.json()}));
