/* Fault injection is confined to this SDK test executable. */
#include <assert.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/random.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"

typedef struct { void *pointer; size_t length; } Block;
static Block blocks[2048];
static int live, released, fail_at, calls, rng_mode, rng_calls, tracking;
void *__real_js_malloc_rt(JSRuntime *,size_t);
void *__real_js_malloc(JSContext *,size_t);
void __real_js_free_rt(JSRuntime *,void *);
ssize_t __real_getrandom(void *,size_t,unsigned);
static void remember(void *pointer,size_t length) {
    if (!pointer || !tracking) return;
    for (int i=0;i<2048;i++) if (!blocks[i].pointer) {
        blocks[i]=(Block){pointer,length}; live++; return;
    }
    assert(!"test block table exhausted");
}
static int should_fail(void) { return fail_at && ++calls==fail_at; }
void *__wrap_js_malloc_rt(JSRuntime *rt,size_t length) {
    if (should_fail()) return NULL;
    void *result=__real_js_malloc_rt(rt,length); remember(result,length); return result;
}
void *__wrap_js_malloc(JSContext *ctx,size_t length) {
    if (should_fail()) { JS_ThrowOutOfMemory(ctx); return NULL; }
    void *result=__real_js_malloc(ctx,length); remember(result,length); return result;
}
void __wrap_js_free_rt(JSRuntime *rt,void *pointer) {
    for (int i=0;i<2048;i++) if (pointer && blocks[i].pointer==pointer) {
        const uint8_t *data=pointer;
        for (size_t j=0;j<blocks[i].length;j++) assert(data[j]==0);
        blocks[i].pointer=NULL; live--; released++; break;
    }
    __real_js_free_rt(rt,pointer);
}
ssize_t __wrap_getrandom(void *buffer,size_t length,unsigned flags) {
    if (!rng_mode) return __real_getrandom(buffer,length,flags);
    rng_calls++;
    if (rng_mode==1 && rng_calls==1) { errno=EINTR; return -1; }
    if (rng_mode==2) return 0;
    if (rng_mode==3 && rng_calls>1) { errno=EIO; return -1; }
    size_t count=length>3?3:length; memset(buffer,0xab,count); return count;
}
static JSValue configure(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args) {
    if (JS_ToInt32(ctx,&fail_at,args[0])<0 || JS_ToInt32(ctx,&rng_mode,args[1])<0) return JS_EXCEPTION;
    calls=rng_calls=0; return JS_UNDEFINED;
}
static JSValue allocation_limit(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args) {
    int64_t limit; if (JS_ToInt64(ctx,&limit,args[0])<0) return JS_EXCEPTION;
    JS_SetMemoryLimit(JS_GetRuntime(ctx),limit); return JS_UNDEFINED;
}
static int evaluate(JSContext *ctx,const char *source) {
    JSValue value=JS_Eval(ctx,source,strlen(source),"<crypto-sdk>",JS_EVAL_TYPE_MODULE);
    if (JS_IsException(value)) { js_std_dump_error(ctx); return -1; }
    value=js_std_await(ctx,value);
    if (JS_IsException(value)) { js_std_dump_error(ctx); return -1; }
    JS_FreeValue(ctx,value); return 0;
}
int main(void) {
    for (int iteration=0;iteration<6;iteration++) {
        JSRuntime *rt=JS_NewRuntime(); assert(rt); js_std_init_handlers(rt);
        JSContext *ctx=JS_NewContext(rt); assert(ctx);
        JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);
        assert(js_cosmo_init_modules(ctx)==0);
        JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
        JSValue global=JS_GetGlobalObject(ctx);
        assert(JS_SetPropertyStr(ctx,global,"cryptoFault",JS_NewCFunction(ctx,configure,"cryptoFault",2))==1);
        assert(JS_SetPropertyStr(ctx,global,"allocationLimit",JS_NewCFunction(ctx,allocation_limit,"allocationLimit",1))==1);
        JS_FreeValue(ctx,global);
        assert(evaluate(ctx,
            "import c from 'node:crypto'; import {blake2b256} from 'cosmo:crypto'; import a from 'node:assert/strict';"
            "globalThis.fixture={c,a,blake2b256};") ==0);
        /* Windows environment initialization also calls js_malloc, followed by
           js_free inside quickjs.o. Start crypto accounting after that setup. */
        tracking=1;
        assert(evaluate(ctx,
            "const {c,a,blake2b256}=fixture;"
            "a.equal(c.createHash('sha256').update('abc').digest('hex'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');"
            "a.equal(blake2b256('abc').toString('hex'),'bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319');"
            "for(const name of ['sha256','blake2b512','sha3-224','sha3-256','sha3-384','sha3-512','shake128','shake256','blake2s256']) {"
            " for(let fail=1;fail<=(name==='blake2b512'?5:2);fail++) {"
            "  cryptoFault(fail,0); let failed=false; try {c.createHash(name);} catch {failed=true;} finally {cryptoFault(0,0);} a(failed,'constructor allocation');"
            "  const original=c.createHash(name).update('abc'); cryptoFault(fail,0); failed=false;"
            "  try {original.copy();} catch {failed=true;} finally {cryptoFault(0,0);} a(failed,'copy allocation');"
            "  a.equal(original.digest('hex'),c.createHash(name).update('abc').digest('hex'));"
            " }"
            "}"
            "const pending=c.createHash('sha256').update('abc'); cryptoFault(1,0);"
            "try {a.throws(()=>pending.digest());} finally {cryptoFault(0,0);}"
            "a.equal(pending.digest('hex'),c.createHash('sha256').update('abc').digest('hex'));"
            "for (const operation of [()=>c.hkdfSync('sha256','key','salt','info',32),()=>c.pbkdf2Sync('key','salt',2,32,'sha256')]) {"
            " for(let fail=1;fail<=3;fail++) {cryptoFault(fail,0); let failed=false; try {operation();} catch {failed=true;} finally {cryptoFault(0,0);} a(failed,'KDF allocation');}"
            "}"
            "cryptoFault(0,1); a.equal(c.randomBytes(19).toString('hex'),'ab'.repeat(19));"
            "for(const mode of [2,3]) {cryptoFault(0,mode); a.throws(()=>c.randomBytes(19),{code:'ERR_CRYPTO_OPERATION_FAILED'});}"
            "const partial=Buffer.alloc(9); cryptoFault(0,3); a.throws(()=>c.randomFillSync(partial),{code:'ERR_CRYPTO_OPERATION_FAILED'}); a.equal(partial.toString('hex'),'ababab000000000000');"
            "cryptoFault(0,1); const view=Buffer.alloc(9,0); a.equal(c.randomFillSync(view,2,5),view); a.equal(view.toString('hex'),'0000ababababab0000');"
            "cryptoFault(0,0);"
            "allocationLimit(8*1024*1024); const chunk=Buffer.alloc(65536,97); const hash=c.createHash('sha256');"
            "for(let i=0;i<256;i++) hash.update(chunk); a.equal(hash.digest('hex'),'5b6ff2e19d0da0fe323061018fc381393492884e74af8296c81ab9cb2694783a');"
            "const extended=c.createHash('shake256',{outputLength:32});for(let i=0;i<128;i++)extended.update(chunk);"
            "a.equal(extended.digest('hex'),'9a53d2fd1bf7ad084f9e1ddda7d2f0585f50ddc91d71a0cda35141d3fbdd08e4');"
            "const oversized=c.createHash('shake128',{outputLength:16*1024*1024}).update('pending');let failed=false;"
            "try{oversized.digest();}catch{failed=true;}a(failed,'SHAKE output quota');"
            "a.equal(oversized.copy({outputLength:16}).digest('hex'),c.createHash('shake128',{outputLength:16}).update('pending').digest('hex'));"
            "allocationLimit(64*1024*1024); globalThis.unfinishedCrypto=c.createHmac('sha512','secret').update('unfinalized');"
        )==0);
        assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);
        tracking=0;
        JS_FreeContext(ctx); js_std_free_handlers(rt); JS_FreeRuntime(rt);
        assert(live==0 && released>0);
    }
    puts("PASS crypto-sdk: allocator failure, zeroization, RNG failure and bounded incremental state");
}
