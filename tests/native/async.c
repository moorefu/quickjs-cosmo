/* Exercise task backends through public JS APIs, with native faults only here. */
#include <assert.h>
#include <errno.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/random.h>
#include <time.h>
#include <unistd.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
static pthread_mutex_t lock=PTHREAD_MUTEX_INITIALIZER;
static int descriptors[256],tracking,live,mode,read_calls,interrupted,fail_output;
static JSRuntime *owner_runtime;
static pthread_t owner;
void *__real_js_malloc_rt(JSRuntime *,size_t);
void *__real_js_malloc(JSContext *,size_t);
int __real_qjs_cosmo_fs_openat(int,const char *,int,...);
int __real___fcntl_dupfd_cloexec(int,...);
int __real_close(int);
ssize_t __real_read(int,void *,size_t);
ssize_t __real_write(int,const void *,size_t);
ssize_t __real_getrandom(void *,size_t,unsigned);
void *__wrap_js_malloc_rt(JSRuntime *rt,size_t size){if(rt==owner_runtime)assert(pthread_equal(owner,pthread_self()));return __real_js_malloc_rt(rt,size);}
void *__wrap_js_malloc(JSContext *ctx,size_t size){if(JS_GetRuntime(ctx)==owner_runtime)assert(pthread_equal(owner,pthread_self()));if(fail_output){fail_output=0;return NULL;}return __real_js_malloc(ctx,size);}
static int contains(int fd){if(fd<0)return 0;int found=0;pthread_mutex_lock(&lock);for(int i=0;i<256;i++)if(descriptors[i]==fd){found=1;break;}pthread_mutex_unlock(&lock);return found;}
static void remember(int fd){pthread_mutex_lock(&lock);int i;for(i=0;i<256 && descriptors[i]>=0;i++);assert(i<256);descriptors[i]=fd;live++;pthread_mutex_unlock(&lock);}
int __wrap_qjs_cosmo_fs_openat(int dir,const char *path,int flags,...) {
    va_list args;va_start(args,flags);unsigned permissions=va_arg(args,unsigned);va_end(args);
    int fd=__real_qjs_cosmo_fs_openat(dir,path,flags,permissions);
    if(tracking && fd>=0 && strstr(path,".async-fault-data"))remember(fd);return fd;
}
int __wrap___fcntl_dupfd_cloexec(int fd,...) {
    va_list args;va_start(args,fd);int minimum=va_arg(args,int);va_end(args);
    int duplicate=__real___fcntl_dupfd_cloexec(fd,minimum);if(duplicate>=0 && contains(fd))remember(duplicate);return duplicate;
}
int __wrap_close(int fd) {
    pthread_mutex_lock(&lock);if(fd>=0)for(int i=0;i<256;i++)if(descriptors[i]==fd){descriptors[i]=-1;live--;break;}pthread_mutex_unlock(&lock);return __real_close(fd);
}
ssize_t __wrap_read(int fd,void *data,size_t size) {
    if(!contains(fd))return __real_read(fd,data,size);
    if(mode==1 && !(interrupted&1)){interrupted|=1;errno=EINTR;return -1;}
    if(mode==2 && read_calls++){errno=EIO;return -1;}
    return __real_read(fd,data,size>7?7:size);
}
ssize_t __wrap_write(int fd,const void *data,size_t size) {
    if(!contains(fd))return __real_write(fd,data,size);
    if(mode==1 && !(interrupted&2)){interrupted|=2;errno=EINTR;return -1;}
    return __real_write(fd,data,size>7?7:size);
}
ssize_t __wrap_getrandom(void *data,size_t size,unsigned flags){if(mode==3){errno=EIO;return -1;}return __real_getrandom(data,size,flags);}
static JSValue evaluate(JSContext *ctx,const char *source,int type){return JS_Eval(ctx,source,strlen(source),"<async-sdk>",type);}
static void settle(JSContext *ctx,JSValue value) {
    if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}
    value=js_std_await(ctx,value);if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}JS_FreeValue(ctx,value);
}
static int64_t now(void){struct timespec value;clock_gettime(CLOCK_MONOTONIC,&value);return value.tv_sec*INT64_C(1000)+value.tv_nsec/1000000;}
static void pause_work(void){struct timespec delay={0,1000000};nanosleep(&delay,NULL);}
static void wait_task(JSRuntime *rt,int ready) {
    int64_t deadline=now()+10000;
    for(;;){QJSCosmoTaskStats s;js_cosmo_tasks_stats(rt,&s);if(ready?s.ready>0:s.running>0)return;assert(now()<deadline);pause_work();}
}
static JSContext *context(JSRuntime **out) {
    JSRuntime *rt=JS_NewRuntime();assert(rt);owner_runtime=rt;owner=pthread_self();js_std_init_handlers(rt);
    JSContext *ctx=JS_NewContext(rt);assert(ctx);JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);assert(js_cosmo_init_modules(ctx)==0);
    JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
    settle(ctx,evaluate(ctx,"import fs from 'node:fs';import fsp from 'node:fs/promises';import c from 'node:crypto';import z from 'node:zlib';import a from 'node:assert/strict';"
        "globalThis.f={fs,fsp,c,z,a};globalThis.file=process.cwd()+'/.async-fault-data';",JS_EVAL_TYPE_MODULE));
    *out=rt;return ctx;
}
static void dispose(JSContext *ctx,JSRuntime *rt){js_std_free_handlers(rt);assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);JS_FreeContext(ctx);JS_FreeRuntime(rt);owner_runtime=NULL;assert(live==0);}
int main(void) {
    for(int i=0;i<256;i++)descriptors[i]=-1;
    for(int iteration=0;iteration<3;iteration++) {
        JSRuntime *rt;JSContext *ctx=context(&rt);tracking=1;mode=1;interrupted=0;
        settle(ctx,evaluate(ctx,"await f.fsp.writeFile(file,'x'.repeat(100),{flush:true});f.a.equal((await f.fsp.readFile(file,'utf8')).length,100);",JS_EVAL_TYPE_MODULE));assert(live==0);assert((interrupted&3)==3);
        mode=2;read_calls=0;
        settle(ctx,evaluate(ctx,"let caught=false;try{await f.fsp.readFile(file);}catch(e){caught=e.code==='EIO';}f.a(caught);",JS_EVAL_TYPE_MODULE));assert(live==0);
        mode=0;
        settle(ctx,evaluate(ctx,"await new Promise((resolve,reject)=>f.z.gzip(Buffer.alloc(15000,7),(e,zipped)=>{if(e)return reject(e);f.z.gunzip(zipped,(e,data)=>{if(e)return reject(e);f.a.equal(data.length,15000);resolve();});}));"
            "await new Promise(resolve=>f.z.gunzip(Buffer.from('invalid'),(e,data)=>{f.a(e);resolve();}));",JS_EVAL_TYPE_MODULE));
        mode=3;
        settle(ctx,evaluate(ctx,"await new Promise(resolve=>f.c.randomBytes(8,(e,v)=>{f.a(e);f.a.equal(v,undefined);resolve();}));",JS_EVAL_TYPE_MODULE));
        mode=0;
        settle(ctx,evaluate(ctx,"globalThis.p=new Promise(resolve=>f.c.randomBytes(8,(e,v)=>{f.a(e);resolve();}));void 0;",JS_EVAL_TYPE_GLOBAL));
        wait_task(rt,1);fail_output=1;
        JSValue global=JS_GetGlobalObject(ctx),promise=JS_GetPropertyStr(ctx,global,"p");JS_FreeValue(ctx,global);settle(ctx,promise);assert(!fail_output);
        settle(ctx,evaluate(ctx,"globalThis.abandoned=await f.fsp.open(file,'r');",JS_EVAL_TYPE_MODULE));assert(live>0);
        /* Open finished in the worker, but its fd has not reached FileHandle. */
        settle(ctx,evaluate(ctx,"globalThis.unconsumed=f.fsp.open(file,'r');void 0;",JS_EVAL_TYPE_GLOBAL));wait_task(rt,1);assert(live>0);
        dispose(ctx,rt);assert(live==0);tracking=0;
        /* Keep the internally opened fd owned while the high-level operation awaits I/O. */
        const char *operations[]={"f.fsp.readFile(file)","f.fsp.writeFile(file,'abc')","f.fsp.copyFile(file,file+'.copy')"};
        for(int operation=0;operation<3;operation++) {
            ctx=context(&rt);tracking=1;mode=0;
            char source[256];snprintf(source,sizeof(source),"globalThis.pending=%s;void 0;",operations[operation]);
            settle(ctx,evaluate(ctx,source,JS_EVAL_TYPE_GLOBAL));wait_task(rt,1);
            assert(js_cosmo_tasks_poll(ctx));assert(live>0);
            dispose(ctx,rt);tracking=0;
        }
        ctx=context(&rt);
        settle(ctx,evaluate(ctx,"globalThis.callbackRan=false;f.c.pbkdf2('p','s',30000000,32,'sha512',()=>callbackRan=true);",JS_EVAL_TYPE_GLOBAL));
        wait_task(rt,0);for(int i=0;i<10;i++)pause_work();
        int64_t start=now();js_std_free_handlers(rt);assert(now()-start<5000);
        global=JS_GetGlobalObject(ctx);JSValue ran=JS_GetPropertyStr(ctx,global,"callbackRan");assert(!JS_ToBool(ctx,ran));JS_FreeValue(ctx,ran);JS_FreeValue(ctx,global);
        settle(ctx,evaluate(ctx,"f.fs.unlinkSync(file);",JS_EVAL_TYPE_GLOBAL));
        JS_FreeContext(ctx);JS_FreeRuntime(rt);owner_runtime=NULL;assert(live==0);
    }
    puts("PASS async-sdk: short/EINTR I/O, failure cleanup, RNG/output failures, pending-open ownership and running PBKDF2 shutdown");
}
