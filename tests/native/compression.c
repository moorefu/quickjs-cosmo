/* Track the native quota boundary and inject failures only in this SDK test. */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
static void *blocks[2048];
static int tracking,live,calls,fail_at;
void *__real_js_malloc_rt(JSRuntime *,size_t);
void __real_js_free_rt(JSRuntime *,void *);
void *__wrap_js_malloc_rt(JSRuntime *rt,size_t length) {
    if (tracking && ++calls==fail_at) return NULL;
    void *result=__real_js_malloc_rt(rt,length);
    if (result && tracking) {
        int i; for(i=0;i<2048 && blocks[i];i++);
        assert(i<2048); blocks[i]=result; live++;
    }
    return result;
}
void __wrap_js_free_rt(JSRuntime *rt,void *data) {
    if (data) for(int i=0;i<2048;i++) if(blocks[i]==data) {blocks[i]=NULL;live--;break;}
    __real_js_free_rt(rt,data);
}
static JSValue control(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args,int magic) {
    if (magic==1) return JS_NewInt32(ctx,calls);
    if (magic==2) return JS_NewInt32(ctx,live);
    if (magic==3) {
        int64_t limit; if (JS_ToInt64(ctx,&limit,args[0])<0) return JS_EXCEPTION;
        JS_SetMemoryLimit(JS_GetRuntime(ctx),limit); return JS_UNDEFINED;
    }
    if (JS_ToInt32(ctx,&fail_at,args[0])<0) return JS_EXCEPTION;
    calls=0;return JS_UNDEFINED;
}
static int evaluate(JSContext *ctx,const char *source) {
    JSValue value=JS_Eval(ctx,source,strlen(source),"<compression-sdk>",JS_EVAL_TYPE_MODULE);
    if (JS_IsException(value)) {js_std_dump_error(ctx);return -1;}
    value=js_std_await(ctx,value);
    if (JS_IsException(value)) {js_std_dump_error(ctx);return -1;}
    JS_FreeValue(ctx,value);return 0;
}
int main(void) {
    for(int iteration=0;iteration<3;iteration++) {
        JSRuntime *rt=JS_NewRuntime();assert(rt);js_std_init_handlers(rt);
        JSContext *ctx=JS_NewContext(rt);assert(ctx);JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);
        assert(js_cosmo_init_modules(ctx)==0);
        JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
        JSValue global=JS_GetGlobalObject(ctx);
        const char *names[]={"compressionFault","nativeCalls","nativeLive","allocationLimit"};
        for(int i=0;i<4;i++) assert(JS_SetPropertyStr(ctx,global,names[i],JS_NewCFunctionMagic(ctx,control,names[i],1,JS_CFUNC_generic_magic,i))==1);
        JS_FreeValue(ctx,global);
        assert(evaluate(ctx,
            "import z from 'node:zlib';import c from 'cosmo:compression';import a from 'node:assert/strict';globalThis.fixture={z,c,a};") ==0);
        tracking=1;
        assert(evaluate(ctx,
            "const {z,c,a}=fixture;const data=Buffer.alloc(15000);for(let i=0;i<data.length;i++)data[i]=(i*131+(i>>8))&255;"
            "const codecs=[[z.gzipSync,z.gunzipSync],[z.deflateSync,z.inflateSync],[z.deflateRawSync,z.inflateRawSync],"
            "[z.zstdCompressSync,z.zstdDecompressSync],[c.lz4CompressSync,c.lz4DecompressSync],[c.bzip2CompressSync,c.bzip2DecompressSync]];"
            "for(const [compress,decompress] of codecs) {"
            " const encoded=compress(data);a(decompress(encoded).equals(data));"
            " for(const operation of [()=>compress(data),()=>decompress(encoded)]) {"
            "  compressionFault(0);operation();const count=nativeCalls();a(count>0);"
            "  for(let fail=1;fail<=count;fail++) {const before=nativeLive();compressionFault(fail);let caught=false;"
            "   try {operation();} catch {caught=true;} finally {compressionFault(0);} a(caught,'native allocation must fail');a.equal(nativeLive(),before,'partial native cleanup');"
            "  }"
            " }"
            " a.throws(()=>decompress(encoded,{maxOutputLength:10}),{code:'ERR_BUFFER_TOO_LARGE'});"
            " let caught=false;allocationLimit(1);try{compress(data);}catch{caught=true;}finally{allocationLimit(64*1024*1024);}a(caught,'runtime quota');"
            "}"
        )==0);
        assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);
        tracking=0;JS_FreeContext(ctx);js_std_free_handlers(rt);JS_FreeRuntime(rt);assert(live==0);
    }
    puts("PASS compression-sdk: each allocation failure, bounded output, quotas and runtime cleanup");
}
