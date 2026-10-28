/* Public JS networking with controlled libc faults; no test hook in production. */
#include <assert.h>
#include <arpa/inet.h>
#include <errno.h>
#include <netdb.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
#include "qjs-tasks.h"
static pthread_t owner;
static JSRuntime *owner_runtime;
static pthread_mutex_t lock=PTHREAD_MUTEX_INITIALIZER;
static int fds[128],live,short_io,send_faults,recv_faults,fail_socket_alloc,foreign;
static atomic_int stopping,dns_running;
int __real_socket(int,int,int),__real_close(int);
ssize_t __real_send(int,const void *,size_t,int),__real_recv(int,void *,size_t,int);
int __real_getaddrinfo(const char *,const char *,const struct addrinfo *,struct addrinfo **);
void *__real_js_malloc_rt(JSRuntime *,size_t),*__real_js_malloc(JSContext *,size_t),*__real_js_mallocz(JSContext *,size_t);
static int tracked(int fd){int found=0;pthread_mutex_lock(&lock);for(int i=0;i<128;i++)if(fds[i]==fd){found=1;break;}pthread_mutex_unlock(&lock);return found;}
int __wrap_socket(int domain,int type,int protocol){
    int fd=__real_socket(domain,type,protocol);
    if(owner_runtime && pthread_equal(owner,pthread_self()) && fd>=0){pthread_mutex_lock(&lock);int i;for(i=0;i<128&&fds[i]>=0;i++);assert(i<128);fds[i]=fd;live++;pthread_mutex_unlock(&lock);}return fd;
}
int __wrap_close(int fd){pthread_mutex_lock(&lock);if(fd>=0)for(int i=0;i<128;i++)if(fds[i]==fd){fds[i]=-1;live--;break;}pthread_mutex_unlock(&lock);return __real_close(fd);}
ssize_t __wrap_send(int fd,const void *data,size_t size,int flags){
    if(short_io&&tracked(fd)){if(send_faults<2){errno=send_faults++?EAGAIN:EINTR;return -1;}if(size>97)size=97;}return __real_send(fd,data,size,flags);
}
ssize_t __wrap_recv(int fd,void *data,size_t size,int flags){
    if(short_io&&tracked(fd)){if(recv_faults<2){errno=recv_faults++?EAGAIN:EINTR;return -1;}if(size>83)size=83;}return __real_recv(fd,data,size,flags);
}
int __wrap_getaddrinfo(const char *host,const char *service,const struct addrinfo *hints,struct addrinfo **result){
    if(host&&!strcmp(host,"dns-fault.invalid"))return EAI_AGAIN;
    if(host&&!strcmp(host,"system-fault.invalid")){errno=EACCES;return EAI_SYSTEM;}
    if(host&&!strcmp(host,"localhost")){atomic_store(&dns_running,1);struct timespec delay={0,80000000};nanosleep(&delay,NULL);}
    return __real_getaddrinfo(host,service,hints,result);
}
static void check_owner(JSRuntime *rt){if(rt==owner_runtime && !pthread_equal(owner,pthread_self()))foreign++;}
void *__wrap_js_malloc_rt(JSRuntime *rt,size_t size){check_owner(rt);return __real_js_malloc_rt(rt,size);}
void *__wrap_js_malloc(JSContext *ctx,size_t size){check_owner(JS_GetRuntime(ctx));return __real_js_malloc(ctx,size);}
void *__wrap_js_mallocz(JSContext *ctx,size_t size){check_owner(JS_GetRuntime(ctx));if(fail_socket_alloc&&size>=131072){fail_socket_alloc=0;JS_ThrowOutOfMemory(ctx);return NULL;}return __real_js_mallocz(ctx,size);}
static void *echo(void *opaque){
    int listener=*(int *)opaque;
    while(!atomic_load(&stopping)){
        struct pollfd ready={listener,POLLIN,0};if(poll(&ready,1,50)<=0)continue;
        int fd=accept(listener,NULL,NULL);if(fd<0)continue;int yes=1;assert(!setsockopt(fd,IPPROTO_TCP,TCP_NODELAY,&yes,sizeof(yes)));
        while(!atomic_load(&stopping)){
            struct pollfd input={fd,POLLIN,0};if(poll(&input,1,50)<=0)continue;
            char data[4096];ssize_t count=recv(fd,data,sizeof(data),0);if(count<=0)break;
            ssize_t offset=0;while(offset<count){ssize_t n=send(fd,data+offset,count-offset,MSG_NOSIGNAL);if(n<=0)break;offset+=n;}if(offset<count)break;
        }
        close(fd);
    }return NULL;
}
static void evaluate(JSContext *ctx,const char *source){
    JSValue value=JS_Eval(ctx,source,strlen(source),"<network-sdk>",JS_EVAL_TYPE_MODULE);
    if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}value=js_std_await(ctx,value);
    if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}JS_FreeValue(ctx,value);
}
int main(void){
    for(int i=0;i<128;i++)fds[i]=-1;owner=pthread_self();
    int listener=socket(AF_INET,SOCK_STREAM,0);assert(listener>=0);
    struct sockaddr_in address={.sin_family=AF_INET,.sin_addr.s_addr=htonl(INADDR_LOOPBACK)};
    assert(!bind(listener,(void *)&address,sizeof(address)));assert(!listen(listener,128));socklen_t length=sizeof(address);assert(!getsockname(listener,(void *)&address,&length));
    pthread_t server;assert(!pthread_create(&server,NULL,echo,&listener));
    for(int iteration=0;iteration<3;iteration++){
        JSRuntime *rt=JS_NewRuntime();assert(rt);owner_runtime=rt;js_std_init_handlers(rt);JSContext *ctx=JS_NewContext(rt);assert(ctx);
        JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);assert(!js_cosmo_init_modules(ctx));JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
        char source[512];snprintf(source,sizeof(source),"import net from 'node:net';import dns from 'node:dns/promises';import a from 'node:assert/strict';globalThis.f={net,dns,a};globalThis.port=%d;",ntohs(address.sin_port));evaluate(ctx,source);
        short_io=1;send_faults=recv_faults=0;
        evaluate(ctx,"globalThis.cycle=async()=>{const socket=f.net.connect({host:'127.0.0.1',port,noDelay:true}),data=Buffer.alloc(4097,71),parts=[];socket.on('data',c=>parts.push(c));await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.destroy();reject(Error('SDK echo timeout read='+socket.bytesRead+' written='+socket.bytesWritten+' state='+socket.readyState));},5000);socket.on('error',reject);socket.on('connect',()=>socket.end(data));socket.on('close',()=>{clearTimeout(timer);resolve();});});f.a(Buffer.concat(parts).equals(data));};await cycle();");
        assert(send_faults==2&&recv_faults==2);assert(live==0);short_io=0;
        evaluate(ctx,"let ticks=0;const timer=setInterval(()=>ticks++,1);await f.dns.lookup('localhost');clearInterval(timer);f.a(ticks>0);await f.a.rejects(f.dns.lookup('dns-fault.invalid'),{code:'EAI_AGAIN',errno:-3001});");assert(atomic_load(&dns_running));
        evaluate(ctx,"await f.a.rejects(f.dns.lookup('system-fault.invalid'),{code:'EACCES',syscall:'getaddrinfo',hostname:'system-fault.invalid'});");
        for(int i=0;i<4;i++)JS_RunGC(rt);JSMemoryUsage before,after;JS_ComputeMemoryUsage(rt,&before);
        evaluate(ctx,"for(let i=0;i<10;i++){await cycle();await new Promise(resolve=>{const socket=f.net.connect({host:'127.0.0.1',port});socket.on('error',()=>{});socket.on('connect',()=>{socket.write(Buffer.alloc(65536),()=>socket.destroy());socket.destroy();});socket.on('close',resolve);});}");
        for(int i=0;i<4;i++)JS_RunGC(rt);JS_ComputeMemoryUsage(rt,&after);
        fprintf(stderr,"network SDK GC delta=%lld\n",(long long)(after.malloc_size-before.malloc_size));assert(after.malloc_size<before.malloc_size+128*1024);assert(live==0&&!foreign);
        fail_socket_alloc=1;evaluate(ctx,"await new Promise(resolve=>{const socket=f.net.connect({host:'127.0.0.1',port});let failed=false;socket.on('error',()=>failed=true);socket.on('close',()=>{f.a(failed);resolve();});});");assert(!fail_socket_alloc&&live==0);
        /* Fill the runtime's 32 socket slots; rejected 33rd open must not leak. */
        evaluate(ctx,"globalThis.sockets=Array.from({length:33},()=>f.net.connect({host:'127.0.0.1',port}));let failures=0;for(const s of sockets)s.on('error',e=>{f.a.equal(e.code,'EAGAIN');failures++;});await new Promise(resolve=>setTimeout(resolve,80));f.a.equal(failures,1);await Promise.all(sockets.map(s=>s.closed?undefined:new Promise(resolve=>{s.on('close',resolve);s.destroy();})));sockets=null;");assert(live==0);
        /* Teardown while lookup and native sockets remain live. */
        evaluate(ctx,"globalThis.pending=f.dns.lookup('localhost');globalThis.socket=f.net.connect({host:'127.0.0.1',port});socket.on('error',()=>{});");
        if(iteration==1){js_cosmo_tasks_close_context(ctx);QJSCosmoTaskStats stats;js_cosmo_tasks_stats(rt,&stats);assert(!stats.active&&!stats.reserved&&live==0);}
        assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);js_std_free_handlers(rt);JS_FreeContext(ctx);JS_FreeRuntime(rt);owner_runtime=NULL;assert(live==0&&!foreign);
    }
    atomic_store(&stopping,1);pthread_join(server,NULL);close(listener);
    puts("PASS network-sdk: partial I/O, EINTR/EAGAIN, DNS offload, allocation owner, GC, quota, OOM and live teardown");
}
