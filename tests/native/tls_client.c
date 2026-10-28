/* Public TLS through a manually linked SDK, including allocator/I/O faults. */
#include <assert.h>
#include <errno.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
#include "qjs-tasks.h"
#include "../../native/tls/backend.h"
static pthread_t owner;static JSRuntime *runtime;static atomic_int foreign,rng_fault,io_fault;
static atomic_int live,sends,receives;static int arena_fault;
static pthread_mutex_t fd_lock=PTHREAD_MUTEX_INITIALIZER;static int fds[128];
void *__real_js_malloc_rt(JSRuntime *,size_t),*__real_js_malloc(JSContext *,size_t),*__real_js_mallocz(JSContext *,size_t);
int __real_socket(int,int,int),__real_close(int);
ssize_t __real_send(int,const void *,size_t,int),__real_recv(int,void *,size_t,int),__real_getrandom(void *,size_t,unsigned);
void *__wrap_js_malloc_rt(JSRuntime *rt,size_t size){if(rt==runtime&&!pthread_equal(owner,pthread_self()))foreign++;return __real_js_malloc_rt(rt,size);}
void *__wrap_js_malloc(JSContext *ctx,size_t size){if(JS_GetRuntime(ctx)==runtime&&!pthread_equal(owner,pthread_self()))foreign++;return __real_js_malloc(ctx,size);}
void *__wrap_js_mallocz(JSContext *ctx,size_t size){if(JS_GetRuntime(ctx)==runtime&&!pthread_equal(owner,pthread_self()))foreign++;if(arena_fault&&size==8*1024*1024){arena_fault=0;JS_ThrowOutOfMemory(ctx);return NULL;}return __real_js_mallocz(ctx,size);}
int __wrap_socket(int a,int b,int c){int fd=__real_socket(a,b,c);if(fd>=0){pthread_mutex_lock(&fd_lock);int i;for(i=0;i<128&&fds[i]>=0;i++);assert(i<128);fds[i]=fd;live++;pthread_mutex_unlock(&fd_lock);}return fd;}
int __wrap_close(int fd){pthread_mutex_lock(&fd_lock);if(fd>=0)for(int i=0;i<128;i++)if(fds[i]==fd){fds[i]=-1;live--;break;}pthread_mutex_unlock(&fd_lock);return __real_close(fd);}
ssize_t __wrap_send(int fd,const void *data,size_t size,int flags){if(io_fault){int n=atomic_fetch_add(&sends,1);if(n<2||n%7==6){errno=n?EAGAIN:EINTR;return -1;}if(size>97)size=97;}return __real_send(fd,data,size,flags);}
ssize_t __wrap_recv(int fd,void *data,size_t size,int flags){if(io_fault){int n=atomic_fetch_add(&receives,1);if(n<2||n%7==6){errno=n?EAGAIN:EINTR;return -1;}if(size>83)size=83;}return __real_recv(fd,data,size,flags);}
ssize_t __wrap_getrandom(void *data,size_t size,unsigned flags){if(rng_fault){errno=EIO;return -1;}return __real_getrandom(data,size,flags);}
static void evaluate(JSContext *ctx,const char *source){JSValue v=JS_Eval(ctx,source,strlen(source),"<tls-client-sdk>",JS_EVAL_TYPE_MODULE);if(!JS_IsException(v))v=js_std_await(ctx,v);if(JS_IsException(v)){js_std_dump_error(ctx);assert(0);}JS_FreeValue(ctx,v);}
int main(void){
    owner=pthread_self();for(int i=0;i<128;i++)fds[i]=-1;
    const QjsTlsBackend *backend=qjs_tls_backend_api();
    for(size_t size=32768;size<=QJS_TLS_ARENA;size*=2){
        unsigned char *allocation=malloc(size+512);assert(allocation);memset(allocation,0x5a,size+512);memset(allocation+256,0,size);
        QjsTls *tls=backend->create(allocation+256,size,-1,"localhost",NULL,NULL,0);assert(tls);
        assert(backend->handshake(tls)==QJS_TLS_FAILURE);assert(backend->error(tls));backend->free(tls);
        for(int i=0;i<256;i++)assert(allocation[i]==0x5a&&allocation[256+size+i]==0x5a);
        free(allocation);
    }
    for(int cycle=0;cycle<3;cycle++){
        runtime=JS_NewRuntime();assert(runtime);js_std_init_handlers(runtime);JSContext *ctx=JS_NewContext(runtime);assert(ctx);assert(!js_cosmo_init_modules(ctx));
        JS_SetModuleLoaderFunc2(runtime,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
        evaluate(ctx,"import tls from 'node:tls';import fs from 'node:fs';import a from 'node:assert/strict';globalThis.f={tls,a};globalThis.options={host:'127.0.0.1',port:Number(process.env.NODE_COMPAT_TLS_PORT),servername:'localhost',ca:fs.readFileSync(process.env.NODE_COMPAT_TLS_CA)};");
        io_fault=1;sends=receives=0;
        evaluate(ctx,"globalThis.roundtrip=async()=>{const s=f.tls.connect(options),parts=[];s.on('data',c=>parts.push(c));await new Promise((resolve,reject)=>{s.on('error',reject);s.on('secureConnect',()=>{f.a.equal(s.authorized,true);s.end(Buffer.alloc(17003,71));});s.on('close',resolve);});f.a.equal(Buffer.concat(parts).length,17003);};await roundtrip();");
        assert(sends>2&&receives>2);io_fault=0;
        /* Collect once after initialization, then prove repeated connections do
           not keep their native arenas or JS callback graphs alive. */
        JS_RunGC(runtime);JSMemoryUsage before,after;JS_ComputeMemoryUsage(runtime,&before);
        evaluate(ctx,"for(let i=0;i<4;i++)await roundtrip();");JS_RunGC(runtime);JS_ComputeMemoryUsage(runtime,&after);
        assert(after.malloc_size<before.malloc_size+65536);
        evaluate(ctx,"await new Promise((resolve,reject)=>{const s=f.tls.connect(options);s.on('error',reject);s.on('secureConnect',()=>{s.unref();s.destroy();});s.on('close',resolve);});");assert(live==0);
        rng_fault=1;
        evaluate(ctx,"await new Promise(resolve=>{const s=f.tls.connect(options);let failed=false;s.on('error',e=>{failed=true;f.a.equal(e.code,'ERR_SSL_TLS_FAILURE');});s.on('close',()=>{f.a.ok(failed);resolve();});});");rng_fault=0;
        arena_fault=1;
        evaluate(ctx,"await new Promise(resolve=>{const s=f.tls.connect(options);let failed=false;s.on('error',()=>{failed=true;});s.on('close',()=>{f.a.ok(failed);resolve();});});");assert(!arena_fault);
        evaluate(ctx,"await new Promise(resolve=>{const s=f.tls.connect({...options,ca:'bad certificate'});s.on('error',()=>{});s.on('close',resolve);});");
        assert(live==0&&!foreign);
        evaluate(ctx,"globalThis.pending=f.tls.connect(options);pending.on('error',()=>{});await new Promise(resolve=>pending.on('connect',resolve));");
        js_cosmo_tasks_close_context(ctx);assert(live==0&&!foreign);
        js_std_free_handlers(runtime);JS_FreeContext(ctx);JS_FreeRuntime(runtime);runtime=NULL;
    }
    puts("PASS tls-client-sdk: partial I/O, EINTR/EAGAIN, RNG/OOM, owner allocation, GC and handshake teardown");
}
