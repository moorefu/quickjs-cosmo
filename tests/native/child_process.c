/* A native child and fault injection travel in this single SDK executable. */
#include <assert.h>
#include <cosmo.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
static int tracking,calls,fail_at,live,mode,interrupted,created[64],count;
static void *blocks[2048];
void *__real_js_malloc_rt(JSRuntime *,size_t);
void __real_js_free_rt(JSRuntime *,void *);
int __real_pipe2(int [2],int);
int __real_poll(struct pollfd *,unsigned long,int);
ssize_t __real_read(int,void *,size_t);
ssize_t __real_write(int,const void *,size_t);
int __real_pthread_create(pthread_t *,const pthread_attr_t *,void *(*)(void *),void *);
void *__wrap_js_malloc_rt(JSRuntime *rt,size_t size) {
    if(tracking && ++calls==fail_at)return NULL;
    void *p=__real_js_malloc_rt(rt,size);
    if(tracking && p){int i;for(i=0;i<2048 && blocks[i];i++);assert(i<2048);blocks[i]=p;live++;}
    return p;
}
void __wrap_js_free_rt(JSRuntime *rt,void *p) {
    if(p)for(int i=0;i<2048;i++)if(blocks[i]==p){blocks[i]=NULL;live--;break;}
    __real_js_free_rt(rt,p);
}
int __wrap_pipe2(int pair[2],int flags) {
    if(tracking && mode==1){errno=EMFILE;return -1;}
    int rc=__real_pipe2(pair,flags);
    if(tracking && !rc){assert(count+2<=64);created[count++]=pair[0];created[count++]=pair[1];}
    return rc;
}
int __wrap_poll(struct pollfd *fds,unsigned long n,int timeout) {
    if(tracking && mode==2 && !(interrupted&1)){interrupted|=1;errno=EINTR;return -1;}
    if(tracking && mode==3){errno=EIO;return -1;}
    return __real_poll(fds,n,timeout);
}
ssize_t __wrap_read(int fd,void *p,size_t n) {
    if(tracking && mode==2 && !(interrupted&2)){interrupted|=2;errno=EINTR;return -1;}
    return __real_read(fd,p,tracking && mode==2 && n>127?127:n);
}
ssize_t __wrap_write(int fd,const void *p,size_t n) {
    if(tracking && mode==2 && fd>2 && !(interrupted&4)){interrupted|=4;errno=EINTR;return -1;}
    return __real_write(fd,p,tracking && mode==2 && fd>2 && n>127?127:n);
}
int __wrap_pthread_create(pthread_t *id,const pthread_attr_t *attr,void *(*fn)(void *),void *arg) {
    if(tracking && mode==4)return EAGAIN;
    return __real_pthread_create(id,attr,fn,arg);
}
static void send_all(int fd,const void *data,size_t size) {
    while(size){ssize_t n=write(fd,data,size);if(n<0 && errno==EINTR)continue;assert(n>0);data=(char *)data+n;size-=n;}
}
static int child(const char *name) {
    if(!strcmp(name,"sleep")){sleep(30);return 0;}
    if(!strcmp(name,"close"))return 7;
    char block[4096];memset(block,'o',sizeof(block));
    for(int i=0;i<64;i++){send_all(1,block,sizeof(block));send_all(2,block,sizeof(block));}
    size_t length=0;ssize_t n;
    while((n=read(0,block,sizeof(block)))!=0){if(n<0 && errno==EINTR)continue;assert(n>0);length+=n;}
    return length==262144?0:8;
}
static int evaluate(JSContext *ctx,const char *source) {
    JSValue value=JS_Eval(ctx,source,strlen(source),"<child-sdk>",JS_EVAL_TYPE_MODULE);
    if(JS_IsException(value)){js_std_dump_error(ctx);return -1;}
    value=js_std_await(ctx,value);
    if(JS_IsException(value)){js_std_dump_error(ctx);return -1;}
    JS_FreeValue(ctx,value);return 0;
}
static void reset(void){calls=0;count=0;interrupted=0;}
static void closed_pipes(void){for(int i=0;i<count;i++){errno=0;assert(fcntl(created[i],F_GETFD)==-1 && errno==EBADF);}}
int main(int argc,char **argv) {
    if(argc==3 && !strcmp(argv[1],"--qp-child"))return child(argv[2]);
    for(int iteration=0;iteration<3;iteration++) {
        JSRuntime *rt=JS_NewRuntime();assert(rt);js_std_init_handlers(rt);
        JSContext *ctx=JS_NewContext(rt);assert(ctx);JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);
        assert(js_cosmo_init_modules(ctx)==0);
        JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
        assert(evaluate(ctx,"import cp from 'node:child_process';import a from 'node:assert/strict';globalThis.fixture={cp,a};"
            "globalThis.childPath=process.execPath;"
            "globalThis.invoke=()=>cp.spawnSync(childPath,['--qp-child','flood'],{input:Buffer.alloc(262144,7),maxBuffer:1048576,timeout:30000,windowsHide:true});")==0);
        tracking=1;mode=0;reset();
        assert(evaluate(ctx,"{const r=invoke();fixture.a.equal(r.status,0,JSON.stringify(r.error));fixture.a.equal(r.stdout.length,262144);fixture.a.equal(r.stderr.length,262144);}")==0);
        int allocations=calls;assert(allocations>0);JS_RunGC(rt);assert(live==0);closed_pipes();
        for(int fail=1;fail<=allocations;fail++) {
            reset();fail_at=fail;
            assert(evaluate(ctx,"{let caught=false;try{invoke();}catch{caught=true;}if(!caught)throw Error('allocation failure was lost');}")==0);
            fail_at=0;JS_RunGC(rt);assert(live==0);closed_pipes();
        }
        for(mode=1;mode<=4;mode++) {
            reset();
            assert(evaluate(ctx,"{const r=invoke();if(r.status===0){fixture.a.equal(r.stdout.length,262144);}else fixture.a(r.error);}")==0);
            JS_RunGC(rt);assert(live==0);closed_pipes();
        }
        mode=0;reset();
        assert(evaluate(ctx,"{const {cp,a}=fixture;const r=cp.spawnSync(childPath,['--qp-child','sleep'],{input:Buffer.alloc(1048576),timeout:100,windowsHide:true});a.equal(r.error.code,'ETIMEDOUT');"
            "const e=cp.spawnSync(childPath,['--qp-child','close'],{input:Buffer.alloc(1048576),timeout:10000,windowsHide:true});a.equal(e.status,7);a.equal(e.error,undefined);}")==0);
        JS_RunGC(rt);assert(live==0);closed_pipes();assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);
        tracking=0;JS_FreeContext(ctx);js_std_free_handlers(rt);JS_FreeRuntime(rt);assert(live==0);
    }
    puts("PASS child-process-sdk: native duplex child, allocation/pipe/thread/poll failures, EINTR/short I/O, timeout and cleanup");
}
