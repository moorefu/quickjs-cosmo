/* Manually linked public HTTPS/Fetch with ownership, I/O and teardown checks. */
#include <assert.h>
#include <errno.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
#include "qjs-tasks.h"
static pthread_t owner;static JSRuntime *runtime;static atomic_int foreign,io_fault,live,sends,receives;
static pthread_mutex_t fd_lock=PTHREAD_MUTEX_INITIALIZER;static int fds[128];
void *__real_js_malloc_rt(JSRuntime *,size_t),*__real_js_malloc(JSContext *,size_t),*__real_js_mallocz(JSContext *,size_t),*__real_js_realloc(JSContext *,void *,size_t);
int __real_socket(int,int,int),__real_close(int);ssize_t __real_send(int,const void *,size_t,int),__real_recv(int,void *,size_t,int);
static void check_owner(JSRuntime *rt){if(rt==runtime&&!pthread_equal(owner,pthread_self()))foreign++;}
void *__wrap_js_malloc_rt(JSRuntime *rt,size_t n){check_owner(rt);return __real_js_malloc_rt(rt,n);}
void *__wrap_js_malloc(JSContext *ctx,size_t n){check_owner(JS_GetRuntime(ctx));return __real_js_malloc(ctx,n);}
void *__wrap_js_mallocz(JSContext *ctx,size_t n){check_owner(JS_GetRuntime(ctx));return __real_js_mallocz(ctx,n);}
void *__wrap_js_realloc(JSContext *ctx,void *p,size_t n){check_owner(JS_GetRuntime(ctx));return __real_js_realloc(ctx,p,n);}
int __wrap_socket(int a,int b,int c){int fd=__real_socket(a,b,c);if(fd>=0){pthread_mutex_lock(&fd_lock);int i;for(i=0;i<128&&fds[i]>=0;i++);assert(i<128);fds[i]=fd;live++;pthread_mutex_unlock(&fd_lock);}return fd;}
int __wrap_close(int fd){pthread_mutex_lock(&fd_lock);if(fd>=0)for(int i=0;i<128;i++)if(fds[i]==fd){fds[i]=-1;live--;break;}pthread_mutex_unlock(&fd_lock);return __real_close(fd);}
ssize_t __wrap_send(int fd,const void *data,size_t n,int flags){if(io_fault){int count=atomic_fetch_add(&sends,1);if(count<2||count%7==6){errno=count?EAGAIN:EINTR;return -1;}if(n>1021)n=1021;}return __real_send(fd,data,n,flags);}
ssize_t __wrap_recv(int fd,void *data,size_t n,int flags){if(io_fault){int count=atomic_fetch_add(&receives,1);if(count<2||count%7==6){errno=count?EAGAIN:EINTR;return -1;}if(n>997)n=997;}return __real_recv(fd,data,n,flags);}
/* QuickJS removes weak zombies before its cycle pass; the stream/abort
   state tables can therefore need subsequent passes to release their values. */
static void collect(JSRuntime *rt){for(int i=0;i<3;i++)JS_RunGC(rt);}
static void evaluate(JSContext *ctx,const char *source){JSValue v=JS_Eval(ctx,source,strlen(source),"<https-client-sdk>",JS_EVAL_TYPE_MODULE);if(!JS_IsException(v))v=js_std_await(ctx,v);if(JS_IsException(v)){js_std_dump_error(ctx);assert(0);}JS_FreeValue(ctx,v);}
int main(void){
    owner=pthread_self();for(int i=0;i<128;i++)fds[i]=-1;
    for(int cycle=0;cycle<3;cycle++){
        runtime=JS_NewRuntime();assert(runtime);js_std_init_handlers(runtime);JSContext *ctx=JS_NewContext(runtime);assert(ctx);JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);assert(!js_cosmo_init_modules(ctx));JS_SetModuleLoaderFunc2(runtime,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
        evaluate(ctx,"import http from 'node:https';import a from 'node:assert/strict';globalThis.f={http,a};globalThis.base='https://127.0.0.1:'+process.env.NODE_COMPAT_HTTPS_PORT;globalThis.cycle=async()=>{const r=await fetch(base+'/gzip');f.a.equal(await r.text(),'HTTPS compressed 中文');const bytes=await fetch(base+'/bytes').then(r=>r.bytes());f.a.equal(bytes.length,262147);f.a.ok(bytes.every(v=>v===120));};await cycle();");
        evaluate(ctx,"f.a.equal((await fetch('https://[::1]:'+process.env.NODE_COMPAT_HTTPS_PORT6+'/small').then(r=>r.bytes())).length,17003);");
        /* Reading the last body byte precedes socket close and decoder teardown.
           Warm allocation size classes, then drain close callbacks before both
           snapshots; compare steady state rather than an in-flight baseline. */
        evaluate(ctx,"for(let i=0;i<3;i++)await cycle();await new Promise(r=>setTimeout(r,50));");
        assert(live==0);collect(runtime);JSMemoryUsage before,after;JS_ComputeMemoryUsage(runtime,&before);
        for(int batch=0;batch<3;batch++){
            evaluate(ctx,"for(let i=0;i<3;i++)await cycle();await new Promise(r=>setTimeout(r,50));");
            assert(live==0);collect(runtime);JS_ComputeMemoryUsage(runtime,&after);
            QJSCosmoTaskStats task_stats;js_cosmo_tasks_stats(runtime,&task_stats);assert(!task_stats.active&&!task_stats.reserved);
            if(after.malloc_size>=before.malloc_size+65536)fprintf(stderr,"HTTPS GC growth: malloc=%lld used=%lld objects=%lld\n",(long long)(after.malloc_size-before.malloc_size),(long long)(after.memory_used_size-before.memory_used_size),(long long)(after.obj_count-before.obj_count));
            assert(after.malloc_size<before.malloc_size+65536);assert(after.obj_count<before.obj_count+64);
        }
        io_fault=1;sends=receives=0;
        evaluate(ctx,"await new Promise((resolve,reject)=>{f.http.get(base+'/small',{agent:false},r=>{let n=0;r.on('data',c=>n+=c.length);r.on('error',reject);r.on('end',()=>{f.a.equal(n,17003);resolve();});}).on('error',reject);});");assert(sends>2&&receives>2);io_fault=0;
        evaluate(ctx,"const c=new AbortController(),r=await fetch(base+'/stall-body',{signal:c.signal}),reader=r.body.getReader();f.a.equal(new TextDecoder().decode((await reader.read()).value),'first');c.abort('stop');f.a.equal(await reader.read().then(()=>null,e=>e),'stop');reader.releaseLock();");
        evaluate(ctx,"const lateC=new AbortController(),late=await fetch(base+'/echo',{signal:lateC.signal}),copy=late.clone();await new Promise(r=>setTimeout(r,100));lateC.abort('late-stop');for(const body of [late,copy])f.a.equal(await body.text().then(()=>null,e=>e),'late-stop');");
        /* Body rejection precedes asynchronous TLS close/worker disposal. */
        for(int retry=0;live&&retry<200;retry++)evaluate(ctx,"await new Promise(resolve=>setTimeout(resolve,5));");
        assert(live==0&&!foreign);
        evaluate(ctx,"globalThis.pending=f.http.get(base+'/stall',{agent:false});pending.on('error',()=>{});await new Promise(resolve=>pending.once('socket',s=>s.once('connect',resolve)));");
        assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);js_cosmo_tasks_close_context(ctx);assert(live==0&&!foreign);js_std_free_handlers(runtime);JS_FreeContext(ctx);JS_FreeRuntime(runtime);runtime=NULL;
    }
    puts("PASS https-client-sdk: HTTPS/Fetch, partial I/O, EINTR/EAGAIN, allocation owner, GC, abort and live teardown");
}
