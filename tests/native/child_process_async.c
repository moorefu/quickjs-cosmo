/* Async native supervision: no JS allocator or callback runs on its I/O threads. */
#include <assert.h>
#include <cosmo.h>
#include <errno.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
#include "../../native/process/core.h"
static pthread_mutex_t lock=PTHREAD_MUTEX_INITIALIZER;
static int tracking,mode,pipe_calls,thread_calls,interrupted,live_fds,live_children,fail_child,fail_guard,fail_output,output_ready;
static int descriptors[128];static uint32_t children[64];
static JSRuntime *owner_runtime;static pthread_t owner;
void *__real_js_malloc_rt(JSRuntime *,size_t);
void *__real_js_malloc(JSContext *,size_t);
int __real_pipe2(int [2],int);
int __real_close(int);
int __real_poll(struct pollfd *,unsigned long,int);
ssize_t __real_read(int,void *,size_t);
ssize_t __real_write(int,const void *,size_t);
int __real_pthread_create(pthread_t *,const pthread_attr_t *,void *(*)(void *),void *);
int __real_qp_unix_launch(const QPRequest *,const char *,const int [3],QPResult *);
int __real_qp_windows_launch(const QPRequest *,const char *,const int [3],QPResult *);
int __real_qp_wait_child(QPResult *);
int __real_qp_force_reap(QPResult *);
void __real_qp_windows_close(QPResult *);
void *__wrap_js_malloc_rt(JSRuntime *rt,size_t size){if(rt==owner_runtime)assert(pthread_equal(owner,pthread_self()));if(fail_child && size>128*1024){fail_child=0;return NULL;}return __real_js_malloc_rt(rt,size);}
void *__wrap_js_malloc(JSContext *ctx,size_t size){if(JS_GetRuntime(ctx)==owner_runtime)assert(pthread_equal(owner,pthread_self()));if(fail_guard && size==sizeof(void *)){fail_guard=0;return NULL;}if(fail_output && size>=32){fail_output=0;return NULL;}return __real_js_malloc(ctx,size);}
static int contains(int fd){int found=0;pthread_mutex_lock(&lock);if(fd>=0)for(int i=0;i<128;i++)if(descriptors[i]==fd){found=1;break;}pthread_mutex_unlock(&lock);return found;}
static void remember(int fd){pthread_mutex_lock(&lock);int i;for(i=0;i<128 && descriptors[i]>=0;i++);assert(i<128);descriptors[i]=fd;live_fds++;pthread_mutex_unlock(&lock);}
int __wrap_pipe2(int pair[2],int flags){if(tracking && mode>=10 && mode<=12 && ++pipe_calls==mode-9){errno=EMFILE;return -1;}int rc=__real_pipe2(pair,flags);if(tracking && !rc){remember(pair[0]);remember(pair[1]);}return rc;}
int __wrap_close(int fd){pthread_mutex_lock(&lock);if(fd>=0)for(int i=0;i<128;i++)if(descriptors[i]==fd){descriptors[i]=-1;live_fds--;break;}pthread_mutex_unlock(&lock);return __real_close(fd);}
int __wrap_pthread_create(pthread_t *thread,const pthread_attr_t *attr,void *(*start)(void *),void *arg){if(tracking && mode>=20 && mode<=21 && ++thread_calls==mode-19)return EAGAIN;return __real_pthread_create(thread,attr,start,arg);}
int __wrap_poll(struct pollfd *fds,unsigned long n,int timeout){int child=0;for(unsigned long i=0;i<n;i++)child|=contains(fds[i].fd);if(tracking && child && mode==4){errno=EIO;return -1;}return __real_poll(fds,n,timeout);}
ssize_t __wrap_read(int fd,void *data,size_t size){int tracked=tracking && contains(fd);if(tracked){if(mode==3){errno=EIO;return -1;}if(mode==1){pthread_mutex_lock(&lock);int first=!(interrupted&1);interrupted|=1;pthread_mutex_unlock(&lock);if(first){errno=EINTR;return -1;}if(size>7)size=7;}}ssize_t n=__real_read(fd,data,size);if(tracked && n>0){pthread_mutex_lock(&lock);output_ready=1;pthread_mutex_unlock(&lock);}return n;}
ssize_t __wrap_write(int fd,const void *data,size_t size){if(tracking && contains(fd)){if(mode==2){errno=EIO;return -1;}if(mode==1){pthread_mutex_lock(&lock);int first=!(interrupted&2);interrupted|=2;pthread_mutex_unlock(&lock);if(first){errno=EINTR;return -1;}if(size>7)size=7;}}return __real_write(fd,data,size);}
static void launched(QPResult *r,int code){if(!tracking || code || !r->pid)return;pthread_mutex_lock(&lock);int i;for(i=0;i<64 && children[i];i++);assert(i<64);children[i]=r->pid;live_children++;pthread_mutex_unlock(&lock);}
static void reaped(QPResult *r){if(!r->pid)return;pthread_mutex_lock(&lock);for(int i=0;i<64;i++)if(children[i]==r->pid){children[i]=0;live_children--;break;}pthread_mutex_unlock(&lock);}
int __wrap_qp_unix_launch(const QPRequest *a,const char *b,const int c[3],QPResult *d){int rc=__real_qp_unix_launch(a,b,c,d);launched(d,rc);return rc;}
int __wrap_qp_windows_launch(const QPRequest *a,const char *b,const int c[3],QPResult *d){int rc=__real_qp_windows_launch(a,b,c,d);launched(d,rc);return rc;}
int __wrap_qp_wait_child(QPResult *r){if(tracking && mode==5){pthread_mutex_lock(&lock);int first=!(interrupted&4);interrupted|=4;pthread_mutex_unlock(&lock);if(first){errno=EIO;return -1;}}int rc=__real_qp_wait_child(r);if(rc>0)reaped(r);return rc;}
int __wrap_qp_force_reap(QPResult *r){int rc=__real_qp_force_reap(r);if(r->exited)reaped(r);return rc;}
void __wrap_qp_windows_close(QPResult *r){if(tracking && r->pid)assert(r->exited);reaped(r);__real_qp_windows_close(r);}
static void write_all(int fd,const void *data,size_t length){size_t offset=0;while(offset<length){ssize_t n=write(fd,(const char *)data+offset,length-offset);if(n<0 && errno==EINTR)continue;if(n<=0)_Exit(2);offset+=n;}}
static int native_child(const char *kind){
    if(!strcmp(kind,"sleep")){struct timespec delay={30,0};nanosleep(&delay,NULL);return 0;}
    if(!strcmp(kind,"output")){char data[64];memset(data,'o',sizeof(data));write_all(1,data,sizeof(data));return 0;}
    if(!strcmp(kind,"duplex")){char data[4096];memset(data,'a',sizeof(data));for(int i=0;i<64;i++)write_all(1,data,sizeof(data));memset(data,'b',sizeof(data));for(int i=0;i<64;i++)write_all(2,data,sizeof(data));}
    char block[4096];ssize_t n;while((n=read(0,block,sizeof(block)))>0)write_all(1,block,n);return 0;
}
static JSValue evaluate(JSContext *ctx,const char *source,int type){return JS_Eval(ctx,source,strlen(source),"<child-async-sdk>",type);}
static void settle(JSContext *ctx,JSValue value){if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}value=js_std_await(ctx,value);if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}JS_FreeValue(ctx,value);}
static int64_t now(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*INT64_C(1000)+t.tv_nsec/1000000;}
static JSContext *context(JSRuntime **out){
    JSRuntime *rt=JS_NewRuntime();assert(rt);owner_runtime=rt;owner=pthread_self();js_std_init_handlers(rt);JSContext *ctx=JS_NewContext(rt);assert(ctx);JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);assert(js_cosmo_init_modules(ctx)==0);
    JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
    settle(ctx,evaluate(ctx,"import cp from 'node:child_process';import a from 'node:assert/strict';globalThis.f={cp,a};globalThis.run=async function(kind,input){const child=cp.spawn(process.execPath,['--native',kind],{windowsHide:true}),out=[],errors=[];child.stdin.on('error',e=>errors.push(e.code));child.stdout.on('error',e=>errors.push(e.code));child.stderr.on('error',e=>errors.push(e.code));child.stdout.on('data',b=>out.push(b));child.stderr.resume();let spawnError=null;child.on('error',e=>spawnError=e.code);const closed=new Promise(resolve=>child.on('close',()=>resolve()));child.stdin.end(input);await closed;return {output:Buffer.concat(out),spawnError,errors};};",JS_EVAL_TYPE_MODULE));
    *out=rt;return ctx;
}
static void dispose(JSContext *ctx,JSRuntime *rt){js_std_free_handlers(rt);assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);JS_FreeContext(ctx);JS_FreeRuntime(rt);owner_runtime=NULL;assert(!live_fds && !live_children);}
int main(int argc,char **argv){
    if(argc>2 && !strcmp(argv[1],"--native"))return native_child(argv[2]);
    for(int i=0;i<128;i++)descriptors[i]=-1;
    for(int iteration=0;iteration<2;iteration++) {
        JSRuntime *rt;JSContext *ctx=context(&rt);tracking=1;mode=0;
        settle(ctx,evaluate(ctx,"let ticks=0;const timer=setInterval(()=>ticks++,1);const r=await run('duplex',Buffer.alloc(4096,9));clearInterval(timer);f.a.equal(r.output.length,64*4096+4096);f.a(ticks>0);f.a.equal(r.spawnError,null);",JS_EVAL_TYPE_MODULE));assert(!live_fds && !live_children);
        mode=1;interrupted=0;settle(ctx,evaluate(ctx,"const r=await run('echo',Buffer.alloc(64,9));f.a.equal(r.output.length,64);f.a.equal(r.errors.length,0);",JS_EVAL_TYPE_MODULE));assert((interrupted&3)==3);assert(!live_fds && !live_children);
        for(int fault=2;fault<=4;fault++){mode=fault;settle(ctx,evaluate(ctx,"const r=await run('echo',Buffer.alloc(64,9));f.a(r.errors.length>0);",JS_EVAL_TYPE_MODULE));assert(!live_fds && !live_children);}
        mode=5;interrupted=0;settle(ctx,evaluate(ctx,"const r=await run('sleep',Buffer.alloc(8));f.a.equal(r.spawnError,'EIO');",JS_EVAL_TYPE_MODULE));assert(!live_fds && !live_children);
        for(int fault=10;fault<=12;fault++){mode=fault;pipe_calls=0;settle(ctx,evaluate(ctx,"const r=await run('echo',Buffer.alloc(8));f.a.equal(r.spawnError,'EMFILE');",JS_EVAL_TYPE_MODULE));assert(!live_fds && !live_children);}
        for(int fault=20;fault<=21;fault++){mode=fault;thread_calls=0;settle(ctx,evaluate(ctx,"const r=await run('echo',Buffer.alloc(8));f.a.equal(r.spawnError,'EAGAIN');",JS_EVAL_TYPE_MODULE));assert(!live_fds && !live_children);}
        mode=0;fail_child=1;settle(ctx,evaluate(ctx,"let caught=false;try{f.cp.spawn(process.execPath,['--native','echo'],{windowsHide:true});}catch(e){caught=true;}f.a(caught);",JS_EVAL_TYPE_MODULE));assert(!fail_child);assert(!live_fds && !live_children);
        fail_guard=1;settle(ctx,evaluate(ctx,"let caught=false;try{f.cp.spawn(process.execPath,['--native','echo'],{windowsHide:true});}catch(e){caught=true;}f.a(caught);",JS_EVAL_TYPE_MODULE));assert(!fail_guard);assert(!live_fds && !live_children);
        settle(ctx,evaluate(ctx,"globalThis.abandoned=f.cp.spawn(process.execPath,['--native','sleep'],{windowsHide:true});",JS_EVAL_TYPE_MODULE));assert(live_children>0);int64_t start=now();dispose(ctx,rt);assert(now()-start<5000);tracking=0;
        ctx=context(&rt);tracking=1;mode=0;output_ready=0;
        settle(ctx,evaluate(ctx,"globalThis.pending=f.cp.spawn(process.execPath,['--native','output'],{windowsHide:true});pending.stdout.on('data',()=>{});pending.stderr.resume();pending.stdin.end();void 0;",JS_EVAL_TYPE_GLOBAL));
        start=now();for(;;){pthread_mutex_lock(&lock);int ready=output_ready;pthread_mutex_unlock(&lock);if(ready)break;assert(now()-start<10000);struct timespec pause={0,1000000};nanosleep(&pause,NULL);}
        fail_output=1;while(js_cosmo_tasks_pending(rt)){assert(now()-start<10000);js_cosmo_tasks_poll(ctx);}assert(!fail_output);assert(!live_fds && !live_children);dispose(ctx,rt);tracking=0;
    }
    puts("PASS child-process-async-sdk: duplex/backpressure, owner allocations, partial/EINTR I/O, failures and shutdown cleanup");
}
