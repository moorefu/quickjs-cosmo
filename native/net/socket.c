#include <arpa/inet.h>
#include <cosmo.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/tcp.h>
#include <netinet/in.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>
#include "libc/sysv/errno.h"
#include "net.h"
#include "../tasks.h"
#include "../module_registry.h"
#include "../process/binding.h"
#include "../tls/backend.h"
#include "libc/str/str.h"

enum {BLOCK=65536,SOCKET_LIMIT=32};
enum {CONNECTED,DATA,READ_EOF,WRITE_DONE,END_DONE,ERROR_EVENT,SECURE_EVENT,CLOSED_EVENT};
typedef struct Connection Connection;
typedef struct {Connection *connection;} Guard;
struct Connection {
    Connection *next;JSRuntime *rt;JSContext *ctx;JSValue callback,handle;Guard *guard;
    pthread_t thread;pthread_mutex_t mutex;int thread_started,fd,stopping,referenced;
    int connecting,connected,connect_sent,want_read,read_eof,eof_sent,write_pending,write_done;
    int input_end,input_ended,end_sent,fatal,fatal_sent,operation;
    size_t input_length,input_offset,output_length;uint8_t input[BLOCK],output[BLOCK];
    void (*wake)(void *);void *waker;
    void *tls_memory;const char *identity,*sni,*ca;size_t ca_length;
    int secure,secure_sent,done;char tls_error[64],cipher[96];
};
static pthread_mutex_t registry_lock=PTHREAD_MUTEX_INITIALIZER;
static Connection *registry;static JSClassID guard_class;static pthread_once_t once=PTHREAD_ONCE_INIT;
static void class_id(void){JS_NewClassID(&guard_class);}
static void notify(Connection *c){c->wake(c->waker);}
static void fatal(Connection *c,int error,int operation){if(!c->fatal){c->fatal=error;c->operation=operation;notify(c);}}
static int ready_error(int fd){
    int code=0;socklen_t length=sizeof(code);
    if(getsockopt(fd,SOL_SOCKET,SO_ERROR,&code,&length)<0)return errno;
    /* SO_ERROR is an output payload, outside the normal syscall errno bridge.
       The pinned NT wrapper overwrites its translated value with a raw Winsock
       value on its final call; XNU also returns its native errno numbering. */
#ifdef __x86_64__
    if(IsWindows() && code>=10000)code=__errno_windows2linux(code);
#endif
    if(IsXnu())code=__errno_xnu2linux(code);
    return code;
}
static void tls_failure(Connection *c,const QjsTlsBackend *api,QjsTls *tls){
    pthread_mutex_lock(&c->mutex);strlcpy(c->tls_error,api->error(tls),sizeof(c->tls_error));fatal(c,EPROTO,1);pthread_mutex_unlock(&c->mutex);
}
static void pump_tls(Connection *c){
    const QjsTlsBackend *api=qjs_tls_backend_api();QjsTls *tls=NULL;int handshake_done=0;
    for(;;){
        pthread_mutex_lock(&c->mutex);
        int stop=c->stopping,connecting=c->connecting,connected=c->connected,failed=c->fatal;
        int writing=c->write_pending,reading=c->want_read&&!c->read_eof&&!c->output_length;
        int ending=c->input_end&&!writing&&!c->input_ended;
        size_t offset=c->input_offset,length=c->input_length;
        pthread_mutex_unlock(&c->mutex);if(stop)break;
        int events=0;
        if(!failed&&connecting)events=POLLOUT;
        else if(!failed&&connected){
            if(!tls)tls=api->create(c->tls_memory,QJS_TLS_ARENA,c->fd,c->identity,c->sni,(const unsigned char *)c->ca,c->ca_length);
            if(!handshake_done){int rc=api->handshake(tls);if(rc==QJS_TLS_FAILURE)tls_failure(c,api,tls);else if(!rc){handshake_done=1;pthread_mutex_lock(&c->mutex);c->secure=1;strlcpy(c->cipher,api->cipher(tls),sizeof(c->cipher));notify(c);pthread_mutex_unlock(&c->mutex);}events=api->want_write(tls)?POLLOUT:POLLIN;}
            else {
                if(writing){int rc=api->write(tls,c->input+offset,length-offset);
                    if(rc==QJS_TLS_FAILURE){tls_failure(c,api,tls);failed=1;}
                    else if(rc>=0){pthread_mutex_lock(&c->mutex);c->input_offset+=rc;if(c->input_offset==c->input_length){c->write_pending=0;c->write_done=1;notify(c);}pthread_mutex_unlock(&c->mutex);}
                    events|=api->want_write(tls)?POLLOUT:POLLIN;
                }
                if(reading&&!failed){int rc=api->read(tls,c->output,BLOCK);
                    if(rc==QJS_TLS_FAILURE){tls_failure(c,api,tls);failed=1;}
                    else if(rc>=0){pthread_mutex_lock(&c->mutex);if(rc)c->output_length=rc;else c->read_eof=1;notify(c);pthread_mutex_unlock(&c->mutex);}
                    if(rc==QJS_TLS_AGAIN)events|=api->want_write(tls)?POLLOUT:POLLIN;
                }
                if(ending&&!failed){int rc=api->end(tls);
                    if(rc==QJS_TLS_FAILURE)tls_failure(c,api,tls);
                    else if(!rc){pthread_mutex_lock(&c->mutex);if(shutdown(c->fd,SHUT_WR)<0&&errno!=ENOTCONN)fatal(c,errno,2);else {c->input_ended=1;notify(c);}pthread_mutex_unlock(&c->mutex);}
                    else events|=api->want_write(tls)?POLLOUT:POLLIN;
                }
            }
        }
        struct pollfd fd={events?c->fd:-1,events,0};int rc=poll(&fd,1,10),saved=errno;
        pthread_mutex_lock(&c->mutex);
        if(rc<0&&saved!=EINTR)fatal(c,saved,connecting?0:1);
        if(connecting&&fd.revents){int code=ready_error(c->fd);if(code)fatal(c,code,0);else {c->connecting=0;c->connected=1;notify(c);}}
        pthread_mutex_unlock(&c->mutex);
    }
    if(tls)api->free(tls);
    pthread_mutex_lock(&c->mutex);close(c->fd);c->fd=-1;c->done=1;notify(c);pthread_mutex_unlock(&c->mutex);
}
static void *pump(void *opaque){
    Connection *c=opaque;sigset_t mask;sigemptyset(&mask);sigaddset(&mask,SIGPIPE);pthread_sigmask(SIG_BLOCK,&mask,NULL);
    pthread_setcancelstate(PTHREAD_CANCEL_DISABLE,NULL);
    if(c->tls_memory){pump_tls(c);return NULL;}
    for(;;){
        pthread_mutex_lock(&c->mutex);
        if(c->stopping){pthread_mutex_unlock(&c->mutex);break;}
        if(c->connected && c->input_end && !c->write_pending && !c->input_ended){
            if(shutdown(c->fd,SHUT_WR)<0 && errno!=ENOTCONN)fatal(c,errno,2);
            else {c->input_ended=1;notify(c);}
        }
        int events=0;
        if(!c->fatal){if(c->connecting || c->write_pending)events|=POLLOUT;if(c->connected && c->want_read && !c->read_eof && !c->output_length)events|=POLLIN;}
        struct pollfd fd={events?c->fd:-1,events,0};pthread_mutex_unlock(&c->mutex);
        int rc=poll(&fd,1,10),saved=errno;
        pthread_mutex_lock(&c->mutex);
        if(c->stopping){pthread_mutex_unlock(&c->mutex);break;}
        if(rc<0){if(saved!=EINTR)fatal(c,saved,c->connecting?0:1);pthread_mutex_unlock(&c->mutex);continue;}
        if(c->connecting && fd.revents){
            int code=ready_error(c->fd);if(code)fatal(c,code,0);
            else {c->connecting=0;c->connected=1;notify(c);}
        }
        if(c->connected && !c->fatal){
            if(c->write_pending && (fd.revents&(POLLOUT|POLLERR|POLLHUP|POLLNVAL))){
                ssize_t n=send(c->fd,c->input+c->input_offset,c->input_length-c->input_offset,MSG_NOSIGNAL);
                if(n>0)c->input_offset+=n;
                else if(n<0 && errno!=EINTR && errno!=EAGAIN && errno!=EWOULDBLOCK)fatal(c,errno,2);
                if(c->input_offset==c->input_length){c->write_pending=0;c->write_done=1;notify(c);}
            }
            if(c->want_read && !c->read_eof && !c->output_length && (fd.revents&(POLLIN|POLLHUP|POLLERR|POLLNVAL))){
                ssize_t n=recv(c->fd,c->output,BLOCK,0);
                if(n>0){c->output_length=n;notify(c);}
                else if(!n){c->read_eof=1;notify(c);}
                else if(errno!=EINTR && errno!=EAGAIN && errno!=EWOULDBLOCK)fatal(c,errno,1);
            }
        }
        pthread_mutex_unlock(&c->mutex);
    }
    close(c->fd);c->fd=-1;return NULL;
}
static void dispose(Connection *c){
    pthread_mutex_lock(&registry_lock);Connection **link=&registry;while(*link&&*link!=c)link=&(*link)->next;if(*link)*link=c->next;pthread_mutex_unlock(&registry_lock);
    if(c->guard)c->guard->connection=NULL;
    pthread_mutex_lock(&c->mutex);c->stopping=1;pthread_mutex_unlock(&c->mutex);
    if(c->thread_started)pthread_join(c->thread,NULL);else if(c->fd>=0)close(c->fd);
    JSRuntime *rt=c->rt;JSContext *ctx=c->ctx;JSValue callback=c->callback,handle=c->handle;
    if(c->tls_memory){explicit_bzero(c->tls_memory,QJS_TLS_ARENA);js_free_rt(rt,c->tls_memory);explicit_bzero(c->input,sizeof(c->input));explicit_bzero(c->output,sizeof(c->output));}
    JS_FreeCString(ctx,c->identity);JS_FreeCString(ctx,c->sni);JS_FreeCString(ctx,c->ca);
    pthread_mutex_destroy(&c->mutex);js_free_rt(rt,c);JS_FreeValue(ctx,handle);JS_FreeValue(ctx,callback);JS_FreeContext(ctx);
}
static void finalize(JSRuntime *rt,JSValue value){Guard *g=JS_GetOpaque(value,guard_class);if(g){if(g->connection)dispose(g->connection);js_free_rt(rt,g);}}
static const JSClassDef definition={"QjsTcpSocket",.finalizer=finalize};
static int address(JSContext *ctx,JSValueConst value,int family,int port,struct sockaddr_storage *out,socklen_t *length){
    memset(out,0,sizeof(*out));size_t size;const char *text=JS_ToCStringLen(ctx,&size,value);if(!text)return -1;
    int valid=0;if(!memchr(text,0,size)){
        if(family==4){struct sockaddr_in *v=(void *)out;v->sin_family=AF_INET;v->sin_port=htons(port);valid=inet_pton(AF_INET,text,&v->sin_addr);*length=sizeof(*v);}
        else if(family==6){struct sockaddr_in6 *v=(void *)out;v->sin6_family=AF_INET6;v->sin6_port=htons(port);valid=inet_pton(AF_INET6,text,&v->sin6_addr);*length=sizeof(*v);}
    }
    JS_FreeCString(ctx,text);if(valid!=1){JS_ThrowTypeError(ctx,"Invalid native IP address");return -1;}return 0;
}
static JSValue start(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
    if(argc<6 || !JS_IsFunction(ctx,args[5]))return JS_ThrowTypeError(ctx,"Invalid native TCP arguments");
    int port,family,local_port;if(JS_ToInt32(ctx,&port,args[1])<0 || JS_ToInt32(ctx,&family,args[2])<0 || JS_ToInt32(ctx,&local_port,args[4])<0)return JS_EXCEPTION;
    if((family!=4&&family!=6)||port<0||port>65535||local_port<0||local_port>65535)return JS_ThrowRangeError(ctx,"Invalid native TCP endpoint");
    struct sockaddr_storage peer,local;socklen_t peer_length,local_length;
    if(address(ctx,args[0],family,port,&peer,&peer_length)<0)return JS_EXCEPTION;
    int binding_local=!JS_IsNull(args[3]) || local_port;
    if(binding_local){JSValue host=JS_IsNull(args[3])?JS_NewString(ctx,family==4?"0.0.0.0":"::"):JS_DupValue(ctx,args[3]);if(JS_IsException(host))return host;int rc=address(ctx,host,family,local_port,&local,&local_length);JS_FreeValue(ctx,host);if(rc<0)return JS_EXCEPTION;}
    JSRuntime *rt=JS_GetRuntime(ctx);size_t count=0;pthread_mutex_lock(&registry_lock);for(Connection *p=registry;p;p=p->next)if(p->rt==rt)count++;pthread_mutex_unlock(&registry_lock);
    JSValue result=JS_NewObject(ctx);if(JS_IsException(result))return result;int error=0;
    if(count>=SOCKET_LIMIT){error=EAGAIN;goto no_connection;}
    Connection *c=js_mallocz(ctx,sizeof(*c));if(!c){JS_FreeValue(ctx,result);return JS_EXCEPTION;}
    c->rt=rt;c->ctx=JS_DupContext(ctx);c->callback=JS_DupValue(ctx,args[5]);c->handle=JS_UNDEFINED;c->fd=-1;c->referenced=1;
    pthread_mutex_init(&c->mutex,NULL);
    if(argc>6&&!JS_IsUndefined(args[6])){
        JSValue identity=JS_GetPropertyUint32(ctx,args[6],0),sni=JS_GetPropertyUint32(ctx,args[6],1),ca=JS_GetPropertyUint32(ctx,args[6],2);
        if(!JS_IsException(identity)&&!JS_IsException(sni)&&!JS_IsException(ca)){
            size_t n;c->identity=JS_ToCStringLen(ctx,&n,identity);
            if(c->identity&&(!n||n>253||memchr(c->identity,0,n)))JS_ThrowTypeError(ctx,"Invalid TLS identity");
            if(!JS_HasException(ctx)&&!JS_IsNull(sni)){c->sni=JS_ToCStringLen(ctx,&n,sni);if(c->sni&&(!n||n>253||memchr(c->sni,0,n)))JS_ThrowTypeError(ctx,"Invalid TLS SNI");}
            if(!JS_HasException(ctx)&&!JS_IsNull(ca)){c->ca=JS_ToCStringLen(ctx,&c->ca_length,ca);if(c->ca&&(!c->ca_length||c->ca_length>4*1024*1024||memchr(c->ca,0,c->ca_length)))JS_ThrowTypeError(ctx,"Invalid TLS CA");}
        }
        JS_FreeValue(ctx,identity);JS_FreeValue(ctx,sni);JS_FreeValue(ctx,ca);
        if(JS_HasException(ctx)){dispose(c);JS_FreeValue(ctx,result);return JS_EXCEPTION;}
        c->tls_memory=js_mallocz(ctx,QJS_TLS_ARENA);if(!c->tls_memory){error=ENOMEM;goto failed;}
    }
    if(js_cosmo_tasks_waker(rt,&c->wake,&c->waker)<0){error=EINVAL;goto failed;}
    c->fd=socket(family==4?AF_INET:AF_INET6,SOCK_STREAM|SOCK_CLOEXEC|SOCK_NONBLOCK,IPPROTO_TCP);
    if(c->fd<0){error=errno;goto failed;}
    if(binding_local && bind(c->fd,(void *)&local,local_length)<0){error=errno;goto failed;}
    int rc=connect(c->fd,(void *)&peer,peer_length);
    if(rc<0 && errno!=EINPROGRESS && errno!=EWOULDBLOCK && errno!=EAGAIN){error=errno;goto failed;}
    c->connected=rc==0;c->connecting=!c->connected;
    Guard *g=js_malloc(ctx,sizeof(*g));if(!g){error=ENOMEM;goto failed;}g->connection=NULL;
    JSValue handle=JS_NewObjectProtoClass(ctx,JS_NULL,guard_class);if(JS_IsException(handle)){js_free(ctx,g);error=ENOMEM;goto failed;}
    g->connection=c;c->guard=g;JS_SetOpaque(handle,g);
    error=pthread_create(&c->thread,NULL,pump,c);
    if(error){JS_FreeValue(ctx,handle);c=NULL;goto no_connection;}c->thread_started=1;c->handle=JS_DupValue(ctx,handle);
    pthread_mutex_lock(&registry_lock);c->next=registry;registry=c;pthread_mutex_unlock(&registry_lock);
    if(JS_SetPropertyStr(ctx,result,"handle",handle)<0){dispose(c);JS_FreeValue(ctx,result);return JS_EXCEPTION;}notify(c);return result;
failed:dispose(c);
no_connection:
    if(error==ENOMEM){JS_FreeValue(ctx,result);if(!JS_HasException(ctx))JS_ThrowOutOfMemory(ctx);return JS_EXCEPTION;}
    if(JS_SetPropertyStr(ctx,result,"error",JS_NewInt32(ctx,error))<0){JS_FreeValue(ctx,result);return JS_EXCEPTION;}return result;
}
enum {READ_CONTROL,WRITE_CONTROL,END_CONTROL,CLOSE_CONTROL,REF_CONTROL,NODELAY_CONTROL,KEEPALIVE_CONTROL};
static JSValue control(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args,int magic){
    if(!argc)return JS_ThrowTypeError(ctx,"Missing socket handle");Guard *g=JS_GetOpaque2(ctx,args[0],guard_class);if(!g)return JS_EXCEPTION;
    Connection *c=g->connection;if(!c)return JS_NewInt32(ctx,magic==WRITE_CONTROL?EPIPE:0);
    if(magic==CLOSE_CONTROL){if(c->tls_memory){pthread_mutex_lock(&c->mutex);c->stopping=1;pthread_mutex_unlock(&c->mutex);return JS_NewInt32(ctx,1);}dispose(c);return JS_NewInt32(ctx,0);}
    uint8_t *bytes=NULL;size_t length=0;int value=0,delay=0;
    if(magic==WRITE_CONTROL){
        if(argc<4)return JS_ThrowTypeError(ctx,"Missing TCP data span");size_t size;int64_t offset,count;
        bytes=JS_GetArrayBuffer(ctx,&size,args[1]);if(JS_HasException(ctx))return JS_EXCEPTION;
        if(JS_ToInt64(ctx,&offset,args[2])<0||JS_ToInt64(ctx,&count,args[3])<0)return JS_EXCEPTION;
        if(offset<0||count<0||(uint64_t)offset>size||(uint64_t)count>size-offset||count>BLOCK)return JS_ThrowRangeError(ctx,"Invalid TCP data span");
        length=count;if(length)bytes+=offset;
    }else if(argc>1 && JS_ToInt32(ctx,&value,args[1])<0)return JS_EXCEPTION;
    if(magic==KEEPALIVE_CONTROL && argc>2 && JS_ToInt32(ctx,&delay,args[2])<0)return JS_EXCEPTION;
    int code=0;pthread_mutex_lock(&c->mutex);
    switch(magic){
    case READ_CONTROL:c->want_read=1;break;
    case WRITE_CONTROL:if(c->write_pending||c->write_done)code=EBUSY;else if(c->input_end||c->fatal)code=EPIPE;else {if(length)memcpy(c->input,bytes,length);c->input_length=length;c->input_offset=0;c->write_pending=1;}break;
    case END_CONTROL:c->input_end=1;break;
    case REF_CONTROL:c->referenced=!!value;break;
    case NODELAY_CONTROL:if(setsockopt(c->fd,IPPROTO_TCP,TCP_NODELAY,&value,sizeof(value))<0)code=errno;break;
    case KEEPALIVE_CONTROL:
        if(setsockopt(c->fd,SOL_SOCKET,SO_KEEPALIVE,&value,sizeof(value))<0){code=errno;break;}
        if(value){
            int interval=1,count=10;
            if(delay>0 && setsockopt(c->fd,IPPROTO_TCP,IsXnu()?0x10:TCP_KEEPIDLE,&delay,sizeof(delay))<0){code=errno;break;}
            if(TCP_KEEPINTVL>0 && setsockopt(c->fd,IPPROTO_TCP,TCP_KEEPINTVL,&interval,sizeof(interval))<0){code=errno;break;}
            if(TCP_KEEPCNT>0 && setsockopt(c->fd,IPPROTO_TCP,TCP_KEEPCNT,&count,sizeof(count))<0)code=errno;
        }
        break;
    }
    pthread_mutex_unlock(&c->mutex);return JS_NewInt32(ctx,code);
}
static JSValue info(JSContext *ctx,Connection *c){
    JSValue value=JS_NewObject(ctx);if(JS_IsException(value))return value;
    for(int i=0;i<2;i++){
        struct sockaddr_storage storage;socklen_t length=sizeof(storage);
        if((i?getpeername(c->fd,(void *)&storage,&length):getsockname(c->fd,(void *)&storage,&length))<0)continue;
        char text[INET6_ADDRSTRLEN];int port;const void *bytes;
        if(storage.ss_family==AF_INET){struct sockaddr_in *a=(void *)&storage;bytes=&a->sin_addr;port=ntohs(a->sin_port);}
        else {struct sockaddr_in6 *a=(void *)&storage;bytes=&a->sin6_addr;port=ntohs(a->sin6_port);}
        inet_ntop(storage.ss_family,bytes,text,sizeof(text));
        if(JS_SetPropertyStr(ctx,value,i?"remoteAddress":"localAddress",JS_NewString(ctx,text))<0 ||
           JS_SetPropertyStr(ctx,value,i?"remotePort":"localPort",JS_NewInt32(ctx,port))<0 ||
           JS_SetPropertyStr(ctx,value,i?"remoteFamily":"localFamily",JS_NewString(ctx,storage.ss_family==AF_INET?"IPv4":"IPv6"))<0){JS_FreeValue(ctx,value);return JS_EXCEPTION;}
    }
    return value;
}
static JSValue error_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
    int code;if(!argc||JS_ToInt32(ctx,&code,args[0])<0)return JS_EXCEPTION;
    const struct {int value,mac,windows;const char *name;} codes[]={
        {EADDRINUSE,48,-4091,"EADDRINUSE"},{EADDRNOTAVAIL,49,-4090,"EADDRNOTAVAIL"},{EAFNOSUPPORT,47,-4089,"EAFNOSUPPORT"},
        {EALREADY,37,-4084,"EALREADY"},{ECANCELED,89,-4081,"ECANCELED"},{ECONNABORTED,53,-4079,"ECONNABORTED"},
        {ECONNREFUSED,61,-4078,"ECONNREFUSED"},{ECONNRESET,54,-4077,"ECONNRESET"},{EHOSTUNREACH,65,-4073,"EHOSTUNREACH"},
        {EISCONN,56,-4069,"EISCONN"},{ENETDOWN,50,-4063,"ENETDOWN"},{ENETUNREACH,51,-4062,"ENETUNREACH"},
        {ENOTCONN,57,-4053,"ENOTCONN"},{ENOTSOCK,38,-4050,"ENOTSOCK"}};
    for(size_t i=0;i<sizeof(codes)/sizeof(*codes);i++)if(code==codes[i].value){
        JSValue value=JS_NewObject(ctx);if(JS_IsException(value))return value;
        if(JS_SetPropertyStr(ctx,value,"code",JS_NewString(ctx,codes[i].name))<0 || JS_SetPropertyStr(ctx,value,"errno",JS_NewInt32(ctx,IsWindows()?codes[i].windows:IsXnu()?-codes[i].mac:-code))<0){JS_FreeValue(ctx,value);return JS_EXCEPTION;}return value;
    }
    return js_cosmo_process_error_info(ctx,code);
}
static JSValue default_ca(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){const char *ca=qjs_tls_backend_api()->default_ca();if(!ca){CosmoResourceView view;int rc=js_cosmo_resource_open(COSMO_RESOURCE_CA,&view);return js_cosmo_resource_exception(ctx,rc,COSMO_RESOURCE_CA);}return JS_NewString(ctx,ca);}
static JSValue validate_ca(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){
    if(argc<1)return JS_ThrowTypeError(ctx,"Missing extra CA PEM");
    size_t length;const char *ca=JS_ToCStringLen(ctx,&length,argv[0]);if(!ca)return JS_EXCEPTION;
    if(!length||length>3*1024*1024||memchr(ca,0,length)){JS_FreeCString(ctx,ca);return JS_FALSE;}
    void *memory=js_mallocz(ctx,QJS_TLS_ARENA);if(!memory){JS_FreeCString(ctx,ca);return JS_EXCEPTION;}
    int valid=qjs_tls_backend_api()->validate_ca(memory,QJS_TLS_ARENA,(const unsigned char *)ca,length);
    memset(memory,0,QJS_TLS_ARENA);js_free(ctx,memory);JS_FreeCString(ctx,ca);return JS_NewBool(ctx,valid);
}
JSValue js_cosmo_net_api(JSContext *ctx){
    pthread_once(&once,class_id);if(!JS_IsRegisteredClass(JS_GetRuntime(ctx),guard_class)&&JS_NewClass(JS_GetRuntime(ctx),guard_class,&definition)<0)return JS_ThrowOutOfMemory(ctx);
    JSValue api=JS_NewObject(ctx);if(JS_IsException(api))return api;
    if(JS_SetPropertyStr(ctx,api,"start",JS_NewCFunction(ctx,start,"start",6))<0 || JS_SetPropertyStr(ctx,api,"error",JS_NewCFunction(ctx,error_info,"error",1))<0 || JS_SetPropertyStr(ctx,api,"defaultCA",JS_NewCFunction(ctx,default_ca,"defaultCA",0))<0 || JS_SetPropertyStr(ctx,api,"validateCA",JS_NewCFunction(ctx,validate_ca,"validateCA",1))<0){JS_FreeValue(ctx,api);return JS_EXCEPTION;}
    const char *names[]={"read","write","end","close","ref","noDelay","keepAlive"};
    for(int i=0;i<7;i++)if(JS_SetPropertyStr(ctx,api,names[i],JS_NewCFunctionMagic(ctx,control,names[i],1,JS_CFUNC_generic_magic,i))<0){JS_FreeValue(ctx,api);return JS_EXCEPTION;}return api;
}
int js_cosmo_net_pending(JSRuntime *rt){
    int pending=0;pthread_mutex_lock(&registry_lock);for(Connection *c=registry;c;c=c->next)if(c->rt==rt){pthread_mutex_lock(&c->mutex);pending|=c->referenced||(c->tls_memory&&c->stopping);pthread_mutex_unlock(&c->mutex);}pthread_mutex_unlock(&registry_lock);return pending;
}
int js_cosmo_net_poll(JSContext *owner){
    JSRuntime *rt=JS_GetRuntime(owner);Connection *chosen=NULL;int type=-1,code=0,operation=0;size_t length=0;
    pthread_mutex_lock(&registry_lock);
    for(Connection *c=registry;c;c=c->next)if(c->rt==rt){
        if(js_cosmo_scheduler_stopped(c->ctx)){chosen=c;type=-2;break;}
        pthread_mutex_lock(&c->mutex);
        if(c->tls_memory&&c->stopping){if(c->done)type=CLOSED_EVENT;}
        else if(c->connected&&!c->connect_sent){type=CONNECTED;c->connect_sent=1;}
        else if(c->secure&&!c->secure_sent){type=SECURE_EVENT;c->secure_sent=1;}
        else if(c->fatal&&!c->fatal_sent){type=ERROR_EVENT;code=c->fatal;operation=c->operation;c->fatal_sent=1;}
        else if(c->write_done){type=WRITE_DONE;c->write_done=0;}
        else if(c->output_length){type=DATA;length=c->output_length;}
        else if(c->input_ended&&!c->end_sent){type=END_DONE;c->end_sent=1;}
        else if(c->read_eof&&!c->eof_sent){type=READ_EOF;c->eof_sent=1;}
        pthread_mutex_unlock(&c->mutex);if(type>=0){chosen=c;break;}
    }
    if(chosen&&type>=0){Connection **link=&registry;while(*link&&*link!=chosen)link=&(*link)->next;*link=chosen->next;Connection **tail=&registry;while(*tail)tail=&(*tail)->next;*tail=chosen;chosen->next=NULL;}
    pthread_mutex_unlock(&registry_lock);if(!chosen)return 0;if(type==-2){dispose(chosen);return 1;}
    JSContext *ctx=JS_DupContext(chosen->ctx);JSValue callback=JS_DupValue(ctx,chosen->callback),data=JS_UNDEFINED;
    if(type==CONNECTED)data=info(ctx,chosen);
    else if(type==SECURE_EVENT)data=JS_NewString(ctx,chosen->cipher);
    else if(type==ERROR_EVENT&&*chosen->tls_error)data=JS_NewString(ctx,chosen->tls_error);
    else if(type==DATA){data=JS_NewArrayBufferCopy(ctx,chosen->output,length);if(!JS_IsException(data)){pthread_mutex_lock(&chosen->mutex);chosen->output_length=0;chosen->want_read=0;pthread_mutex_unlock(&chosen->mutex);}}
    if(JS_IsException(data)){dispose(chosen);js_cosmo_scheduler_error(ctx);JS_FreeValue(ctx,callback);JS_FreeContext(ctx);return 1;}
    if(type==CLOSED_EVENT)dispose(chosen);
    JSValue args[]={JS_NewInt32(ctx,type),data,JS_NewInt32(ctx,code),JS_NewInt32(ctx,operation)};
    JSValue returned=JS_Call(ctx,callback,JS_UNDEFINED,4,args);if(JS_IsException(returned))js_cosmo_scheduler_error(ctx);JS_FreeValue(ctx,returned);
    for(int i=0;i<4;i++)JS_FreeValue(ctx,args[i]);JS_FreeValue(ctx,callback);js_cosmo_checkpoint(ctx,1);JS_FreeContext(ctx);return 1;
}
void js_cosmo_net_close_context(JSContext *ctx){
    for(;;){Connection *found=NULL;pthread_mutex_lock(&registry_lock);for(Connection *c=registry;c;c=c->next)if(c->ctx==ctx){found=c;break;}pthread_mutex_unlock(&registry_lock);if(!found)return;dispose(found);}
}
void js_cosmo_net_shutdown(JSRuntime *rt){
    for(;;){Connection *found=NULL;pthread_mutex_lock(&registry_lock);for(Connection *c=registry;c;c=c->next)if(c->rt==rt){found=c;break;}pthread_mutex_unlock(&registry_lock);if(!found)return;dispose(found);}
}
