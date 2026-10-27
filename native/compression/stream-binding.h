/* Included by binding.c: persistent prepaid storage; only step tasks touch it
   while busy. No QuickJS allocator or JS API is called by a codec worker. */
#include <pthread.h>
#include <stdalign.h>
#include "libc/str/str.h"
#include "stream.h"
typedef union StreamBlock StreamBlock;
union StreamBlock {struct {size_t size;StreamBlock *next;int free;} v;max_align_t alignment;};
typedef struct {
    JSRuntime *rt;QCAllocator memory;QCStream *codec;void *allocation;StreamBlock *arena;
    size_t budget;int mode,busy,closing;
} StreamState;
static JSClassID stream_class;
static pthread_once_t stream_once=PTHREAD_ONCE_INIT;
static void stream_id(void){JS_NewClassID(&stream_class);}
static void *stream_allocate(void *opaque,size_t size){
    StreamState *s=opaque;size_t align=alignof(max_align_t);if(size>SIZE_MAX-align)return NULL;
    size=(size+align-1)&~(align-1);if(!size)size=align;
    for(StreamBlock *b=s->arena;b;b=b->v.next)if(b->v.free && b->v.size>=size){
        if(b->v.size-size>=sizeof(StreamBlock)+align){
            StreamBlock *next=(void *)((char *)(b+1)+size);*next=(StreamBlock){.v={b->v.size-size-sizeof(StreamBlock),b->v.next,1}};b->v.next=next;b->v.size=size;
        }
        b->v.free=0;return b+1;
    }
    return NULL;
}
static void stream_release(void *opaque,void *data){
    if(!data)return;StreamState *s=opaque;StreamBlock *b=(StreamBlock *)data-1;
    explicit_bzero(data,b->v.size);b->v.free=1;
    for(b=s->arena;b && b->v.next;)if(b->v.free && b->v.next->v.free){b->v.size+=sizeof(StreamBlock)+b->v.next->v.size;b->v.next=b->v.next->v.next;}else b=b->v.next;
}
static void stream_close_state(StreamState *s){
    if(s->busy)return;
    qc_stream_free(s->codec);s->codec=NULL;
    if(s->allocation){explicit_bzero(s->allocation,s->budget+alignof(max_align_t));js_free_rt(s->rt,s->allocation);s->allocation=NULL;}
}
static void stream_finalizer(JSRuntime *rt,JSValue value){
    StreamState *s=JS_GetOpaque(value,stream_class);if(!s)return;stream_close_state(s);js_free_rt(rt,s);
}
static const JSClassDef stream_definition={"QjsCompressionStream",.finalizer=stream_finalizer};
static JSValue stream_create(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
    Parsed p;if(JS_IsException(parse_run(ctx,argc,args,&p)))return JS_EXCEPTION;
    if(p.mode>QC_UNZSTD)return JS_ThrowTypeError(ctx,"Unsupported compression stream codec");
    pthread_once(&stream_once,stream_id);
    JSRuntime *rt=JS_GetRuntime(ctx);
    if(!JS_IsRegisteredClass(rt,stream_class) && JS_NewClass(rt,stream_class,&stream_definition)<0)return JS_EXCEPTION;
    JSValue value=JS_NewObjectProtoClass(ctx,JS_NULL,stream_class);if(JS_IsException(value))return value;
    StreamState *s=js_mallocz(ctx,sizeof(*s));if(!s){JS_FreeValue(ctx,value);return JS_EXCEPTION;}
    s->rt=rt;s->mode=p.mode;s->budget=(p.mode<=QC_UNZIP?1:16)*1024*1024;
    s->memory=(QCAllocator){.opaque=s,.allocate=stream_allocate,.release=stream_release};JS_SetOpaque(value,s);
    s->allocation=js_malloc(ctx,s->budget+alignof(max_align_t));if(!s->allocation){JS_FreeValue(ctx,value);return JS_EXCEPTION;}
    s->arena=(void *)(((uintptr_t)s->allocation+alignof(max_align_t)-1)&~(uintptr_t)(alignof(max_align_t)-1));
    *s->arena=(StreamBlock){.v={s->budget-sizeof(StreamBlock),NULL,1}};
    QCResult result={0};QCAllocator *previous=qc_allocator_enter(&s->memory);
    s->codec=qc_stream_create(p.mode,&p.options,&s->memory,&result);qc_allocator_leave(previous);
    if(!s->codec){JS_FreeValue(ctx,value);return failure(ctx,p.mode,&result);}
    return value;
}
typedef struct {StreamState *state;JSRuntime *rt;JSValue root;uint8_t *input,*output;size_t length,capacity;int flush,level,strategy;QCResult result;} StreamTask;
static void stream_cleanup(QJSCosmoTask *task){
    StreamTask *t=js_cosmo_task_data(task);StreamState *s=t->state;
    s->busy=0;if(js_cosmo_task_cancelled(task))s->closing=1;
    if(s->closing)stream_close_state(s);JS_FreeValueRT(t->rt,t->root);
}
static int stream_work(QJSCosmoTask *task){
    StreamTask *t=js_cosmo_task_data(task);StreamState *s=t->state;
    QCAllocator *previous=qc_allocator_enter(&s->memory);
    t->result=qc_stream_step(s->codec,t->input,t->length,t->output,t->capacity,t->flush,t->level,t->strategy);
    qc_allocator_leave(previous);return 0;
}
static JSValue stream_finish(JSContext *ctx,QJSCosmoTask *task,int error){
    StreamTask *t=js_cosmo_task_data(task);
    if(error || t->result.status){t->state->closing=1;return error?JS_ThrowInternalError(ctx,"Compression stream cancelled"):failure(ctx,t->state->mode,&t->result);}
    JSValue value=JS_NewObject(ctx);if(JS_IsException(value))goto memory;
    if(put(ctx,value,"buffer",JS_NewArrayBufferCopy(ctx,t->output,t->result.output.length))<0 ||
       put(ctx,value,"consumed",JS_NewInt64(ctx,t->result.consumed))<0 ||
       put(ctx,value,"ended",JS_NewBool(ctx,t->result.backend))<0){JS_FreeValue(ctx,value);goto memory;}
    return value;
memory:t->state->closing=1;return JS_EXCEPTION;
}
static JSValue stream_step(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
    if(argc<8)return JS_ThrowTypeError(ctx,"Invalid stream step arguments");
    StreamState *s=JS_GetOpaque2(ctx,args[0],stream_class);if(!s)return JS_EXCEPTION;
    if(!s->codec || s->closing)return JS_ThrowTypeError(ctx,"Compression stream is closed");
    if(s->busy)return JS_ThrowTypeError(ctx,"Compression stream is busy");
    uint8_t *input;size_t length;int64_t capacity,flush,level,strategy;
    if(span(ctx,args+1,&input,&length)<0 || number(ctx,args[4],64,65536,&capacity)<0 || number(ctx,args[5],0,s->mode<=QC_UNZIP?5:2,&flush)<0 ||
       number(ctx,args[6],-100,9,&level)<0 || number(ctx,args[7],0,4,&strategy)<0)return JS_EXCEPTION;
    if(length>65536)return JS_ThrowRangeError(ctx,"Stream input block exceeds 64 KiB");
    QJSCosmoTask *task=js_cosmo_task_create(ctx,4096+length+capacity,sizeof(StreamTask),stream_work,stream_finish);if(!task)return JS_EXCEPTION;
    StreamTask *t=js_cosmo_task_data(task);*t=(StreamTask){.state=s,.rt=s->rt,.root=JS_DupValue(ctx,args[0]),.length=length,.capacity=capacity,.flush=flush,.level=level,.strategy=strategy};
    s->busy=1;js_cosmo_task_set_cleanup(task,stream_cleanup);
    t->input=js_cosmo_task_alloc(task,length);t->output=js_cosmo_task_alloc(task,capacity);
    if(!t->input || !t->output){js_cosmo_task_discard(task);return JS_ThrowOutOfMemory(ctx);}
    if(length)memcpy(t->input,input,length);
    return js_cosmo_task_submit(ctx,task,NULL);
}
static JSValue stream_close(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
    StreamState *s=argc?JS_GetOpaque2(ctx,args[0],stream_class):NULL;if(!s)return JS_EXCEPTION;
    s->closing=1;stream_close_state(s);return JS_UNDEFINED;
}
static JSValue stream_reset(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
    StreamState *s=argc?JS_GetOpaque2(ctx,args[0],stream_class):NULL;if(!s)return JS_EXCEPTION;
    if(!s->codec || s->closing || s->busy)return JS_ThrowTypeError(ctx,"Compression stream is busy or closed");
    int code=qc_stream_reset(s->codec);if(code)return JS_ThrowInternalError(ctx,"Compression reset failed: %d",code);return JS_UNDEFINED;
}
