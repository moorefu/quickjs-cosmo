#include <cosmo.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "async.h"
#include "binding.h"
#include "../module_registry.h"
#include "../tasks.h"
#include "../runtime_state.h"

enum {BLOCK=65536,CHILD_LIMIT=16};
enum {DATA,EOF_EVENT,WRITE_EVENT,INPUT_CLOSED,EXIT_EVENT,DONE_EVENT};
typedef struct Child Child;
typedef struct {Child *child;} Guard;
struct Child {
    Child *next;
    JSRuntime *rt;JSContext *ctx;JSValue callback,handle;
    Guard *guard;
    pthread_mutex_t mutex;pthread_cond_t changed;
    pthread_t pump,writer;
    int pump_started,writer_started,stopping,detaching,drop_input,input_end,pump_done,referenced,io_ref[3];
    int fd[3],pipe[3],eof_sent[3],exit_sent,write_pending,write_done,write_error,read_error[3],round;
    size_t input_length,output_length[3];
    uint8_t input[BLOCK],output[2][BLOCK];
    int want[3];
    QPResult result;
    void (*wake)(void *);void *waker;
};
static pthread_mutex_t registry_lock=PTHREAD_MUTEX_INITIALIZER;
static Child *registry;
static JSClassID guard_class;
static pthread_once_t guard_once=PTHREAD_ONCE_INIT;
static void guard_id(void){JS_NewClassID(&guard_class);}
static void close_fd(int *fd){if(*fd>=0){close(*fd);*fd=-1;}}
static void notify(Child *child){child->wake(child->waker);}
static void *input_thread(void *opaque) {
    Child *c=opaque;sigset_t mask;sigemptyset(&mask);sigaddset(&mask,SIGPIPE);pthread_sigmask(SIG_BLOCK,&mask,NULL);
    pthread_setcancelstate(PTHREAD_CANCEL_DISABLE,NULL);
    pthread_mutex_lock(&c->mutex);
    for(;;) {
        while(!c->stopping && !c->drop_input && !c->write_pending && !c->input_end)pthread_cond_wait(&c->changed,&c->mutex);
        if(c->stopping || c->drop_input)break;
        if(!c->write_pending && c->input_end)break;
        int fd=c->fd[0];size_t length=c->input_length,offset=0;pthread_mutex_unlock(&c->mutex);int code=0;
        while(offset<length) {
            pthread_setcancelstate(PTHREAD_CANCEL_ENABLE,NULL);
            ssize_t n=write(fd,c->input+offset,length-offset);int saved=errno;
            pthread_setcancelstate(PTHREAD_CANCEL_DISABLE,NULL);
            if(n<0 && saved==EINTR)continue;
            if(n<=0){code=n<0?saved:EIO;break;}offset+=n;
        }
        pthread_mutex_lock(&c->mutex);c->write_pending=0;c->write_done=1;c->write_error=code;notify(c);
        if(code)break;
        /* Acknowledgement is consumed on the JS thread before another write. */
        while(c->write_done && !c->stopping && !c->drop_input)pthread_cond_wait(&c->changed,&c->mutex);
    }
    close_fd(c->fd);pthread_mutex_unlock(&c->mutex);notify(c);return NULL;
}
static void join_input(Child *c) {
    if(!c->writer_started)return;
    pthread_cancel(c->writer);pthread_join(c->writer,NULL);c->writer_started=0;
    pthread_mutex_lock(&c->mutex);close_fd(c->fd);if(c->write_pending){c->write_pending=0;c->write_done=1;c->write_error=EPIPE;}pthread_mutex_unlock(&c->mutex);notify(c);
}
static void *pump_thread(void *opaque) {
    Child *c=opaque;pthread_setcancelstate(PTHREAD_CANCEL_DISABLE,NULL);
    for(;;) {
        pthread_mutex_lock(&c->mutex);
        if(c->stopping){if(!c->detaching && !c->result.exited)qp_kill_child(&c->result,SIGKILL);close_fd(c->fd+1);close_fd(c->fd+2);c->drop_input=1;}
        if(!c->result.exited && qp_wait_child(&c->result)<0){
            int error=errno;QPResult result=c->result;
            pthread_mutex_unlock(&c->mutex);qp_force_reap(&result);pthread_mutex_lock(&c->mutex);
            c->result=result;c->result.error=error;close_fd(c->fd+1);close_fd(c->fd+2);c->drop_input=1;
        }
        if(c->result.exited)c->drop_input=1;
        int join=c->writer_started && (c->drop_input || c->fd[0]<0);
        if(join)pthread_cond_broadcast(&c->changed);
        pthread_mutex_unlock(&c->mutex);if(join)join_input(c);
        pthread_mutex_lock(&c->mutex);
        if((c->result.exited || (c->stopping && c->detaching)) && c->fd[0]<0 && c->fd[1]<0 && c->fd[2]<0){c->pump_done=1;pthread_mutex_unlock(&c->mutex);notify(c);return NULL;}
        struct pollfd pipes[2];for(int i=0;i<2;i++)pipes[i]=(struct pollfd){c->output_length[i+1]? -1:c->fd[i+1],POLLIN,0};
        pthread_mutex_unlock(&c->mutex);notify(c);
        int rc=poll(pipes,2,10),saved=errno;if(rc<0 && saved==EINTR)continue;
        pthread_mutex_lock(&c->mutex);
        for(int i=0;i<2;i++) {
            int index=i+1;if(c->fd[index]<0 || c->fd[index]!=pipes[i].fd || c->output_length[index])continue;
            if(rc<0){c->read_error[index]=saved;close_fd(c->fd+index);continue;}
            if(!pipes[i].revents)continue;
            ssize_t n=read(c->fd[index],c->output[i],BLOCK);
            if(n<0){if(errno!=EINTR && errno!=EAGAIN){c->read_error[index]=errno;close_fd(c->fd+index);}}
            else if(!n)close_fd(c->fd+index);else c->output_length[index]=n;
        }
        pthread_mutex_unlock(&c->mutex);
    }
}
static void unlink_child(Child *c) {
    pthread_mutex_lock(&registry_lock);Child **p=&registry;while(*p && *p!=c)p=&(*p)->next;if(*p)*p=c->next;pthread_mutex_unlock(&registry_lock);
}
static void dispose_mode(Child *c,int detach) {
    unlink_child(c);if(c->guard)c->guard->child=NULL;
    pthread_mutex_lock(&c->mutex);c->stopping=1;c->detaching=detach;c->drop_input=1;pthread_cond_broadcast(&c->changed);pthread_mutex_unlock(&c->mutex);
    if(c->pump_started)pthread_join(c->pump,NULL);
    else {
        join_input(c);if(c->result.pid && !c->result.exited){qp_kill_child(&c->result,SIGKILL);while(qp_wait_child(&c->result)==0){struct timespec delay={0,1000000};nanosleep(&delay,NULL);}}
    }
    for(int i=0;i<3;i++)close_fd(c->fd+i);
    if(IsWindows())qp_windows_close(&c->result);
    JSRuntime *rt=c->rt;JSContext *ctx=c->ctx;JSValue callback=c->callback,handle=c->handle;
    pthread_cond_destroy(&c->changed);pthread_mutex_destroy(&c->mutex);js_free_rt(rt,c);JS_FreeValue(ctx,handle);JS_FreeValue(ctx,callback);JS_FreeContext(ctx);
}
static void dispose(Child *c){dispose_mode(c,0);}
static void guard_finalize(JSRuntime *rt,JSValue value){Guard *g=JS_GetOpaque(value,guard_class);if(g){if(g->child)dispose(g->child);js_free_rt(rt,g);}}
static const JSClassDef definition={"QjsChildProcess",.finalizer=guard_finalize};
JSValue js_cosmo_process_start(JSContext *ctx,const QPRequest *request,QPAllocator *memory,JSValueConst callback) {
    if(!JS_IsFunction(ctx,callback))return JS_ThrowTypeError(ctx,"Invalid child progress callback");
    JSRuntime *rt=JS_GetRuntime(ctx);size_t count=0;pthread_mutex_lock(&registry_lock);for(Child *p=registry;p;p=p->next)if(p->rt==rt)count++;pthread_mutex_unlock(&registry_lock);
    JSValue info=JS_NewObject(ctx);if(JS_IsException(info))return info;
    if(count>=CHILD_LIMIT){JS_SetPropertyStr(ctx,info,"error",js_cosmo_process_error_info(ctx,EAGAIN));return info;}
    Child *c=js_malloc_rt(rt,sizeof(*c));if(!c){JS_FreeValue(ctx,info);return JS_ThrowOutOfMemory(ctx);}memset(c,0,sizeof(*c));
    c->rt=rt;c->ctx=JS_DupContext(ctx);c->callback=JS_DupValue(ctx,callback);c->handle=JS_UNDEFINED;c->result.handle=-1;c->referenced=1;
    for(int i=0;i<3;i++){c->fd[i]=-1;c->result.sync_handles[i]=-1;c->result.sync_fds[i]=-1;c->pipe[i]=request->stdio[i]==QP_PIPE;c->io_ref[i]=c->pipe[i];c->eof_sent[i]=!c->pipe[i];}
    pthread_mutex_init(&c->mutex,NULL);pthread_cond_init(&c->changed,NULL);
    int error=0,child[3]={-1,-1,-1};
    if(js_cosmo_tasks_waker(rt,&c->wake,&c->waker)<0){error=EINVAL;goto failed;}
    for(int i=0;i<3;i++) {
        if(request->stdio[i]==QP_PIPE){int pair[2];if(qp_make_pipe(pair)<0){error=errno;goto failed;}c->fd[i]=pair[i?0:1];child[i]=pair[i?1:0];}
        else if(request->stdio[i]==QP_IGNORE)child[i]=open("/dev/null",O_RDWR|O_CLOEXEC);
        else child[i]=fcntl(request->stdio[i],F_DUPFD_CLOEXEC,3);
        if(child[i]<0){error=errno;goto failed;}
        if(child[i]<3){int copy=fcntl(child[i],F_DUPFD_CLOEXEC,3),saved=errno;close_fd(child+i);child[i]=copy;if(copy<0){error=saved;goto failed;}}
    }
    if(IsXnu() && c->fd[0]>=0 && fcntl(c->fd[0],73,1)<0){error=errno;goto failed;}
    error=qp_launch(request,child,&c->result,memory);for(int i=0;i<3;i++)close_fd(child+i);if(error)goto failed;
    Guard *g=js_malloc(ctx,sizeof(*g));if(!g){error=ENOMEM;goto failed;}g->child=NULL;
    JSValue handle=JS_NewObjectProtoClass(ctx,JS_NULL,guard_class);if(JS_IsException(handle)){js_free(ctx,g);error=ENOMEM;goto failed;}
    g->child=c;c->guard=g;JS_SetOpaque(handle,g);
    if(c->fd[0]>=0){error=pthread_create(&c->writer,NULL,input_thread,c);if(error){JS_FreeValue(ctx,handle);c=NULL;goto disposed;}c->writer_started=1;}
    error=pthread_create(&c->pump,NULL,pump_thread,c);if(error){JS_FreeValue(ctx,handle);c=NULL;goto disposed;}c->pump_started=1;
    c->handle=JS_DupValue(ctx,handle);
    pthread_mutex_lock(&registry_lock);c->next=registry;registry=c;pthread_mutex_unlock(&registry_lock);
    if(JS_SetPropertyStr(ctx,info,"handle",handle)<0 || JS_SetPropertyStr(ctx,info,"pid",JS_NewUint32(ctx,c->result.pid))<0){dispose(c);JS_FreeValue(ctx,info);return JS_EXCEPTION;}
    return info;
failed:
    for(int i=0;i<3;i++)close_fd(child+i);
    dispose(c);
disposed:
    if(error==ENOMEM){JS_FreeValue(ctx,info);if(!JS_HasException(ctx))JS_ThrowOutOfMemory(ctx);return JS_EXCEPTION;}
    if(JS_SetPropertyStr(ctx,info,"error",js_cosmo_process_error_info(ctx,error))<0){JS_FreeValue(ctx,info);return JS_EXCEPTION;}return info;
}
enum {WRITE_INPUT,END_INPUT,DROP_INPUT,DROP_OUTPUT,WANT_OUTPUT,KILL,REF_CHILD,REF_IO};
static JSValue control(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args,int magic) {
    if(!argc)return JS_ThrowTypeError(ctx,"Missing native child handle");
    Guard *g=JS_GetOpaque2(ctx,args[0],guard_class);if(!g)return JS_EXCEPTION;
    Child *c=g->child;int index=0,value=0;if(argc>1 && magic!=WRITE_INPUT && JS_ToInt32(ctx,&index,args[1])<0)return JS_EXCEPTION;
    if(argc>2 && magic!=WRITE_INPUT && JS_ToInt32(ctx,&value,args[2])<0)return JS_EXCEPTION;
    if(!c)return JS_NewInt32(ctx,magic==WRITE_INPUT?EPIPE:magic==KILL?ESRCH:0);
    uint8_t *bytes=NULL;size_t length=0;if(magic==WRITE_INPUT){if(argc<4)return JS_ThrowTypeError(ctx,"Missing input span");size_t capacity;bytes=JS_GetArrayBuffer(ctx,&capacity,args[1]);if(JS_HasException(ctx))return JS_EXCEPTION;int64_t offset,amount;if(JS_ToInt64(ctx,&offset,args[2])<0 || JS_ToInt64(ctx,&amount,args[3])<0)return JS_EXCEPTION;if(offset<0 || amount<0 || (uint64_t)offset>capacity || (uint64_t)amount>capacity-(uint64_t)offset || amount>BLOCK)return JS_ThrowRangeError(ctx,"Invalid child input span");if(bytes)bytes+=offset;length=amount;}
    int result=0;pthread_mutex_lock(&c->mutex);
    switch(magic) {
    case WRITE_INPUT:if(c->fd[0]<0 || c->drop_input || c->input_end)result=EPIPE;else if(c->write_pending || c->write_done)result=EBUSY;else {if(length)memcpy(c->input,bytes,length);c->input_length=length;c->write_pending=1;pthread_cond_broadcast(&c->changed);}break;
    case END_INPUT:c->input_end=1;pthread_cond_broadcast(&c->changed);break;
    case DROP_INPUT:c->drop_input=1;pthread_cond_broadcast(&c->changed);break;
    case DROP_OUTPUT:if(index<1 || index>2){result=EINVAL;break;}close_fd(c->fd+index);c->output_length[index]=0;break;
    case WANT_OUTPUT:if(index<1 || index>2){result=EINVAL;break;}c->want[index]=1;break;
    case KILL:if(c->result.exited)result=ESRCH;else if(index==0 && IsWindows()){if(qp_windows_wait(&c->result)>0)result=ESRCH;}else if(qp_kill_child(&c->result,index)<0)result=errno;break;
    case REF_CHILD:c->referenced=!!index;break;
    case REF_IO:if(index<0 || index>2)result=EINVAL;else c->io_ref[index]=!!value;break;
    }
    pthread_mutex_unlock(&c->mutex);notify(c);return JS_NewInt32(ctx,result);
}
static JSValue error_code(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){int code;if(!argc || JS_ToInt32(ctx,&code,args[0])<0)return JS_EXCEPTION;return js_cosmo_process_error_info(ctx,code);}
JSValue js_cosmo_process_async_api(JSContext *ctx) {
    pthread_once(&guard_once,guard_id);if(!JS_IsRegisteredClass(JS_GetRuntime(ctx),guard_class) && JS_NewClass(JS_GetRuntime(ctx),guard_class,&definition)<0)return JS_ThrowInternalError(ctx,"Cannot register child owner");
    JSValue api=JS_NewObject(ctx);if(JS_IsException(api))return api;
    const char *names[]={"write","end","dropInput","dropOutput","read","kill","ref","refIO"};
    for(int i=0;i<sizeof(names)/sizeof(*names);i++)if(JS_SetPropertyStr(ctx,api,names[i],JS_NewCFunctionMagic(ctx,control,names[i],3,JS_CFUNC_generic_magic,i))<0){JS_FreeValue(ctx,api);return JS_EXCEPTION;}
    if(JS_SetPropertyStr(ctx,api,"error",JS_NewCFunction(ctx,error_code,"error",1))<0){JS_FreeValue(ctx,api);return JS_EXCEPTION;}return api;
}
int js_cosmo_process_pending(JSRuntime *rt) {
    int pending=0;pthread_mutex_lock(&registry_lock);for(Child *c=registry;c;c=c->next)if(c->rt==rt){pthread_mutex_lock(&c->mutex);pending=c->referenced;for(int i=0;i<3;i++)pending|=c->io_ref[i] && !c->eof_sent[i];pthread_mutex_unlock(&c->mutex);if(pending)break;}pthread_mutex_unlock(&registry_lock);return pending;
}
static void output_free(JSRuntime *rt,void *opaque,void *data){js_free_rt(rt,data);}
static JSValue copy_output(JSContext *ctx,const uint8_t *data,size_t length) {
    uint8_t *copy=js_malloc(ctx,length);if(!copy)return JS_ThrowOutOfMemory(ctx);memcpy(copy,data,length);
    JSValue value=JS_NewArrayBuffer(ctx,copy,length,output_free,NULL,0);if(JS_IsException(value))js_free(ctx,copy);return value;
}
int js_cosmo_process_poll(JSContext *owner) {
    JSRuntime *rt=JS_GetRuntime(owner);Child *chosen=NULL;int type=-1,index=0,code=0;uint32_t status=0;size_t length=0;JSValue data=JS_UNDEFINED;
    pthread_mutex_lock(&registry_lock);
    for(Child *c=registry;c;c=c->next)if(c->rt==rt) {
        if(js_cosmo_scheduler_stopped(c->ctx)){chosen=c;type=-2;break;}
        pthread_mutex_lock(&c->mutex);
        if(c->write_done){type=WRITE_EVENT;code=c->write_error;c->write_done=0;pthread_cond_broadcast(&c->changed);}
        else if(c->pipe[0] && c->fd[0]<0 && !c->eof_sent[0]){type=INPUT_CLOSED;c->eof_sent[0]=1;}
        else if(c->result.exited && !c->exit_sent){type=EXIT_EVENT;status=c->result.status;code=c->result.signal;c->exit_sent=1;}
        else {
            for(int n=0;n<2;n++){int i=1+(c->round+n)%2;if(c->want[i] && c->output_length[i]){type=DATA;index=i;length=c->output_length[i];break;}if(c->pipe[i] && c->fd[i]<0 && !c->eof_sent[i] && !c->output_length[i]){type=EOF_EVENT;index=i;code=c->read_error[i];c->eof_sent[i]=1;break;}}
            if(type<0 && c->pump_done && c->exit_sent && c->eof_sent[0] && c->eof_sent[1] && c->eof_sent[2]){type=DONE_EVENT;code=c->result.error;}
        }
        pthread_mutex_unlock(&c->mutex);if(type>=0){chosen=c;break;}
    }
    if(chosen && type>=0){Child **link=&registry;while(*link && *link!=chosen)link=&(*link)->next;if(*link){*link=chosen->next;chosen->next=NULL;Child **tail=&registry;while(*tail)tail=&(*tail)->next;*tail=chosen;}}
    pthread_mutex_unlock(&registry_lock);if(!chosen)return 0;
    if(type==-2){dispose(chosen);return 1;}
    JSContext *ctx=JS_DupContext(chosen->ctx);JSValue callback=JS_DupValue(ctx,chosen->callback);
    if(type==EXIT_EVENT && IsWindows()){pthread_mutex_lock(&chosen->mutex);qp_windows_close(&chosen->result);pthread_mutex_unlock(&chosen->mutex);}
    /* The rooted guard keeps the child alive through allocation/GC. The pump
       cannot modify an occupied output block until this owner consumes it. */
    if(type==DATA){data=copy_output(ctx,chosen->output[index-1],length);if(!JS_IsException(data)){pthread_mutex_lock(&chosen->mutex);chosen->output_length[index]=0;chosen->want[index]=0;chosen->round=index%2;pthread_mutex_unlock(&chosen->mutex);}}
    if(JS_IsException(data)){dispose(chosen);js_cosmo_scheduler_error(ctx);JS_FreeValue(ctx,callback);JS_FreeContext(ctx);return 1;}
    JSValue args[]={JS_NewInt32(ctx,type),JS_NewInt32(ctx,index),type==EXIT_EVENT?JS_NewUint32(ctx,status):data,JS_NewInt32(ctx,code)};
    if(type==DONE_EVENT)dispose(chosen);
    if(!js_cosmo_scheduler_stopped(ctx)){JSValue returned=JS_Call(ctx,callback,JS_UNDEFINED,4,args);if(JS_IsException(returned))js_cosmo_scheduler_error(ctx);JS_FreeValue(ctx,returned);}
    for(int i=0;i<4;i++)JS_FreeValue(ctx,args[i]);
    JS_FreeValue(ctx,callback);js_cosmo_checkpoint(ctx,1);JS_FreeContext(ctx);return 1;
}
static void close_children(JSRuntime *rt,JSContext *ctx,int shutdown) {
    for(;;){Child *found=NULL;pthread_mutex_lock(&registry_lock);for(Child *c=registry;c;c=c->next)if(c->rt==rt && (!ctx || c->ctx==ctx)){found=c;break;}pthread_mutex_unlock(&registry_lock);if(!found)return;
        int detach=0;CosmoRuntimeState *state=NULL;
        if(shutdown && !IsWindows() && js_cosmo_lookup_state(found->ctx,&state)>0 && state->mode!=3 && !state->worker){pthread_mutex_lock(&found->mutex);int referenced=found->referenced;for(int i=0;i<3;i++)referenced|=found->io_ref[i] && !found->eof_sent[i];detach=!referenced;pthread_mutex_unlock(&found->mutex);}
        dispose_mode(found,detach);
    }
}
void js_cosmo_process_close_context(JSContext *ctx){close_children(JS_GetRuntime(ctx),ctx,0);}
void js_cosmo_process_shutdown(JSRuntime *rt){close_children(rt,NULL,1);}
