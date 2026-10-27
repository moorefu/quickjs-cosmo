#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdalign.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
#include "tasks-source.h"
extern const uint8_t tasks_bytecode[];
extern const uint32_t tasks_bytecode_size;
static _Thread_local int inside_work;
static int fail_thread,thread_calls,fail_arena;
static atomic_int resources;
void *__real_js_malloc_rt(JSRuntime *,size_t);
int __real_pthread_create(pthread_t *,const pthread_attr_t *,void *(*)(void *),void *);
void *__wrap_js_malloc_rt(JSRuntime *rt,size_t size){assert(!inside_work);if(fail_arena){fail_arena=0;return NULL;}return __real_js_malloc_rt(rt,size);}
int __wrap_pthread_create(pthread_t *thread,const pthread_attr_t *attr,void *(*start)(void *),void *arg) {
    if(fail_thread && ++thread_calls==fail_thread)return EAGAIN;
    return __real_pthread_create(thread,attr,start,arg);
}
typedef struct {pthread_t owner;void *marker;uint32_t duration,sum;size_t length;uint8_t *input;int background,fd;} Data;
static void cleanup(QJSCosmoTask *task) {
    Data *data=js_cosmo_task_data(task);assert(pthread_equal(data->owner,pthread_self()));
    assert(close(data->fd)==0);atomic_fetch_sub(&resources,1);
}
static int work(QJSCosmoTask *task) {
    inside_work=1;Data *data=js_cosmo_task_data(task);data->background=!pthread_equal(data->owner,pthread_self());
    uint8_t *block=js_cosmo_task_alloc(task,128);assert(block && !((uintptr_t)block%alignof(max_align_t)));
    memset(block,7,128);block=js_cosmo_task_realloc(task,block,512);assert(block);
    for(int i=0;i<128;i++)assert(block[i]==7);
    js_cosmo_task_free(task,block);block=js_cosmo_task_alloc(task,128);assert(block);
    for(int i=0;i<128;i++)assert(!block[i]);js_cosmo_task_free(task,block);
    assert(!js_cosmo_task_alloc(task,SIZE_MAX));
    for(uint32_t elapsed=0;elapsed<data->duration;elapsed+=2) {
        if(js_cosmo_task_cancelled(task)){inside_work=0;return ECANCELED;}
        struct timespec pause={0,2000000};nanosleep(&pause,NULL);
    }
    for(size_t i=0;i<data->length;i++)data->sum+=data->input[i];
    inside_work=0;return 0;
}
static JSValue finish(JSContext *ctx,QJSCosmoTask *task,int error) {
    Data *data=js_cosmo_task_data(task);assert(pthread_equal(data->owner,pthread_self()));
    assert(JS_GetContextOpaque(ctx)==data->marker);
    if(error) {
        JSValue value=JS_NewError(ctx);
        JS_SetPropertyStr(ctx,value,"name",JS_NewString(ctx,"AbortError"));
        JS_SetPropertyStr(ctx,value,"code",JS_NewString(ctx,"ABORT_ERR"));return JS_Throw(ctx,value);
    }
    JSValue value=JS_NewObject(ctx);JS_SetPropertyStr(ctx,value,"sum",JS_NewUint32(ctx,data->sum));
    JS_SetPropertyStr(ctx,value,"background",JS_NewBool(ctx,data->background));return value;
}
static JSValue submit(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args) {
    int32_t duration=0;int64_t budget=65536;
    if(argc && JS_ToInt32(ctx,&duration,args[0])<0)return JS_EXCEPTION;
    if(argc>2 && JS_ToInt64(ctx,&budget,args[2])<0)return JS_EXCEPTION;
    size_t length=0;uint8_t *input=NULL;
    if(argc>1 && !JS_IsUndefined(args[1])){input=JS_GetArrayBuffer(ctx,&length,args[1]);if(JS_HasException(ctx))return JS_EXCEPTION;}
    QJSCosmoTask *task=js_cosmo_task_create(ctx,budget,sizeof(Data),work,finish);if(!task)return JS_EXCEPTION;
    Data *data=js_cosmo_task_data(task);data->owner=pthread_self();data->marker=JS_GetContextOpaque(ctx);data->duration=duration;
    data->fd=open("/dev/null",O_RDONLY|O_CLOEXEC);
    if(data->fd<0){js_cosmo_task_discard(task);return JS_ThrowInternalError(ctx,"Test resource open failed");}
    atomic_fetch_add(&resources,1);js_cosmo_task_set_cleanup(task,cleanup);
    data->length=length;
    if(length){data->input=js_cosmo_task_alloc(task,length);if(!data->input){js_cosmo_task_discard(task);return JS_ThrowOutOfMemory(ctx);}memcpy(data->input,input,length);}
    uint64_t id;JSValue promise=js_cosmo_task_submit(ctx,task,&id);if(JS_IsException(promise))return promise;
    JSValue value=JS_NewObject(ctx);
    if(JS_IsException(value)){JS_FreeValue(ctx,promise);js_cosmo_task_cancel(ctx,id);return value;}
    JS_SetPropertyStr(ctx,value,"promise",promise);JS_SetPropertyStr(ctx,value,"id",JS_NewInt64(ctx,id));return value;
}
static JSValue cancel(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args) {
    int64_t id;if(JS_ToInt64(ctx,&id,args[0])<0)return JS_EXCEPTION;return JS_NewBool(ctx,js_cosmo_task_cancel(ctx,id));
}
static JSValue detach(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){JS_DetachArrayBuffer(ctx,args[0]);return JS_UNDEFINED;}
static JSValue stats(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args) {
    QJSCosmoTaskStats info;js_cosmo_tasks_stats(JS_GetRuntime(ctx),&info);JSValue value=JS_NewObject(ctx);
    JS_SetPropertyStr(ctx,value,"active",JS_NewInt64(ctx,info.active));JS_SetPropertyStr(ctx,value,"reserved",JS_NewInt64(ctx,info.reserved));
    JS_SetPropertyStr(ctx,value,"workers",JS_NewInt64(ctx,info.workers));return value;
}
static JSContext *new_context(JSRuntime *rt) {
    JSContext *ctx=JS_NewContext(rt);assert(ctx);JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);
    assert(js_cosmo_init_modules(ctx)==0);JSValue global=JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx,global,"nativeTask",JS_NewCFunction(ctx,submit,"nativeTask",3));
    JS_SetPropertyStr(ctx,global,"cancelTask",JS_NewCFunction(ctx,cancel,"cancelTask",1));
    JS_SetPropertyStr(ctx,global,"detachInput",JS_NewCFunction(ctx,detach,"detachInput",1));
    JS_SetPropertyStr(ctx,global,"taskStats",JS_NewCFunction(ctx,stats,"taskStats",0));JS_FreeValue(ctx,global);return ctx;
}
static int settle(JSContext *ctx,JSValue value) {
    if(JS_IsException(value)){js_std_dump_error(ctx);return -1;}
    value=js_std_await(ctx,value);if(JS_IsException(value)){js_std_dump_error(ctx);return -1;}JS_FreeValue(ctx,value);return 0;
}
static JSValue evaluate(JSContext *ctx,const char *source){return JS_Eval(ctx,source,strlen(source),"<tasks-sdk>",JS_EVAL_TYPE_MODULE);}
int main(int argc,char **argv) {
    js_std_set_worker_new_context_func(new_context);
    for(int iteration=0;iteration<3;iteration++) {
        JSRuntime *rt=JS_NewRuntime();assert(rt);js_std_init_handlers(rt);
        JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
        JSContext *ctx=new_context(rt);
        for(fail_thread=1;fail_thread<=2;fail_thread++) {
            thread_calls=0;assert(!js_cosmo_task_create(ctx,65536,sizeof(Data),work,finish));
            assert(JS_HasException(ctx));JS_FreeValue(ctx,JS_GetException(ctx));
        }
        fail_thread=0;fail_arena=1;assert(!js_cosmo_task_create(ctx,65536,sizeof(Data),work,finish));
        assert(JS_HasException(ctx));JS_FreeValue(ctx,JS_GetException(ctx));
        QJSCosmoTaskStats info;js_cosmo_tasks_stats(rt,&info);assert(!info.active && !info.reserved);
        JSValue value;
        if(argc>1 && !strcmp(argv[1],"--bytecode")) {
            value=JS_ReadObject(ctx,tasks_bytecode,tasks_bytecode_size,JS_READ_OBJ_BYTECODE);
            assert(!JS_IsException(value));assert(JS_ResolveModule(ctx,value)==0);value=JS_EvalFunction(ctx,value);
        } else value=evaluate(ctx,tasks_source);
        assert(settle(ctx,value)==0);
        JSValue global=JS_GetGlobalObject(ctx);value=JS_GetPropertyStr(ctx,global,"taskFixturePassed");assert(JS_ToBool(ctx,value));JS_FreeValue(ctx,value);JS_FreeValue(ctx,global);
        /* One runtime hosts two independent contexts; closing one discards its
           callbacks and leaves the other's work and event loop operational. */
        JSContext *other=new_context(rt);
        JS_SetContextOpaque(other,(void *)(uintptr_t)0x5678);
        assert(settle(other,evaluate(other,"globalThis.otherResult=nativeTask(20).promise;"))==0);
        global=JS_GetGlobalObject(other);value=JS_GetPropertyStr(other,global,"otherResult");JS_FreeValue(other,global);
        assert(settle(ctx,value)==0);
        assert(settle(ctx,evaluate(ctx,"globalThis.keepWork=nativeTask(30).promise;"))==0);
        assert(settle(other,evaluate(other,"globalThis.closedCallback=false;nativeTask(30000).promise.then(()=>closedCallback=true);"))==0);
        js_cosmo_tasks_close_context(other);js_cosmo_tasks_stats(rt,&info);assert(info.active==1);
        global=JS_GetGlobalObject(other);value=JS_GetPropertyStr(other,global,"closedCallback");assert(!JS_ToBool(other,value));JS_FreeValue(other,value);JS_FreeValue(other,global);
        JS_FreeContext(other);
        assert(settle(ctx,evaluate(ctx,"await keepWork;const r=await nativeTask(10).promise;if(!r.background)throw Error('main context stopped');"))==0);
        /* Teardown cancels and joins a running native task without pumping JS. */
        assert(settle(ctx,evaluate(ctx,"nativeTask(30000);"))==0);
        js_std_free_handlers(rt);JS_FreeContext(ctx);JS_FreeRuntime(rt);
        assert(atomic_load(&resources)==0);
    }
    puts("PASS task-pool-sdk: nonblocking timers, snapshot/detach, bounded arenas/queue, cancellation, Worker, contexts and shutdown");
}
