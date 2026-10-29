#include <assert.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
#include "qjs-tasks.h"
static pthread_t owner;
static int checked,foreign,fail_arena,injected;
void *__real_js_malloc_rt(JSRuntime *,size_t);
void *__real_js_malloc(JSContext *,size_t);
static int reject(size_t size){
    if(checked && !pthread_equal(owner,pthread_self()))foreign++;
    if(fail_arena && size>=1024*1024 && size<=1024*1024+64){fail_arena=0;injected++;return 1;}return 0;
}
void *__wrap_js_malloc_rt(JSRuntime *rt,size_t size){return reject(size)?NULL:__real_js_malloc_rt(rt,size);}
void *__wrap_js_malloc(JSContext *ctx,size_t size){
    if(reject(size)){JS_ThrowOutOfMemory(ctx);return NULL;}return __real_js_malloc(ctx,size);
}
static void evaluate(JSContext *ctx,const char *source){
    JSValue value=JS_Eval(ctx,source,strlen(source),"<file-algorithm-stream-sdk>",JS_EVAL_TYPE_MODULE);
    if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}value=js_std_await(ctx,value);
    if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}JS_FreeValue(ctx,value);
}
int main(void){
    owner=pthread_self();
    for(int iteration=0;iteration<3;iteration++){
        JSRuntime *rt=JS_NewRuntime();assert(rt);js_std_init_handlers(rt);JSContext *ctx=JS_NewContext(rt);assert(ctx);
        JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);assert(js_cosmo_init_modules(ctx)==0);
        JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);checked=1;
        evaluate(ctx,"import z from 'node:zlib';import c from 'node:crypto';import {Readable,Writable} from 'node:stream';import {pipeline} from 'node:stream/promises';import a from 'node:assert/strict';"
            "globalThis.cycle=async(length=8192)=>{for(const [encode,decode] of [['Gzip','Gunzip'],['ZstdCompress','ZstdDecompress']].filter(([name])=>typeof z['create'+name]==='function')){let count=0;const data=Buffer.alloc(length,97);const source=Readable.from([data]);await pipeline(source,z['create'+encode]({chunkSize:257}),z['create'+decode]({chunkSize:4093}),new Writable({write(c,e,cb){count+=c.length;cb();}}));a.equal(count,data.length);}"
            "const hash=c.createHash('sha256'),parts=[];hash.on('data',v=>parts.push(v));await pipeline(Readable.from(['a','b','c']),hash);a.equal(Buffer.concat(parts).toString('hex'),c.createHash('sha256').update('abc').digest('hex'));};await cycle(65537);");
        for(int gc=0;gc<4;gc++)JS_RunGC(rt);JSMemoryUsage before,after;JS_ComputeMemoryUsage(rt,&before);
        evaluate(ctx,"for(let i=0;i<6;i++)await cycle();");for(int gc=0;gc<4;gc++)JS_RunGC(rt);JS_ComputeMemoryUsage(rt,&after);
        fprintf(stderr,"stream SDK memory: before=%lld after=%lld delta=%lld\n",(long long)before.malloc_size,(long long)after.malloc_size,(long long)(after.malloc_size-before.malloc_size));
        assert(after.malloc_size<before.malloc_size+64*1024);assert(!foreign);
        QJSCosmoTaskStats stats;js_cosmo_tasks_stats(rt,&stats);assert(stats.active==0 && stats.reserved==0);
        fail_arena=1;
        evaluate(ctx,"import z from 'node:zlib';let failed=false;try{z.createGzip();}catch(e){failed=true;}if(!failed)throw Error('missing injected allocation failure');");
        assert(injected==iteration+1);assert(!fail_arena);
        /* Teardown owns queued/running work even when JS never awaits it. */
        evaluate(ctx,"import z from 'node:zlib';globalThis.pending=z.createZstdCompress?z.createZstdCompress():z.createGzip();pending.on('error',()=>{});pending.write(Buffer.alloc(65536,7));");
        assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);
        js_std_free_handlers(rt);JS_FreeContext(ctx);JS_FreeRuntime(rt);checked=0;
    }
    puts("PASS file-algorithm-stream-sdk: bounded steps, owner allocation, GC, OOM and live shutdown");
}
