#include <assert.h>
#include <errno.h>
#include <pthread.h>
#include <stdalign.h>
#include <stdatomic.h>
#include <stdint.h>
#include <string.h>
#include "tasks.h"
#include "quickjs-libc.h"
#include "module_registry.h"
#include "process/async.h"
#include "net/net.h"
#include "stdio/binding.h"
#include "tty.h"

enum { THREADS=2,CAPACITY=64,MAX_RESERVED=64*1024*1024 };
enum { PREPARED,QUEUED,RUNNING,READY };
typedef union Block Block;
union Block {
    struct {size_t size;Block *next;int free;} v;
    max_align_t alignment;
};
typedef struct Pool Pool;
struct QJSCosmoTask {
    Pool *pool;
    QJSCosmoTask *all_next,*queue_next,*ready_next;
    JSContext *ctx;
    JSValue resolving[2];
    QJSCosmoTaskWork work;
    QJSCosmoTaskFinish finish;
    QJSCosmoTaskCleanup cleanup;
    uint64_t id;
    size_t budget;
    void *allocation,*data;
    Block *arena;
    atomic_int cancelled;
    int state,error;
};
struct Pool {
    Pool *next;
    JSRuntime *rt;
    pthread_t threads[THREADS],owner;
    pthread_mutex_t mutex;
    pthread_cond_t changed;
    QJSCosmoTask *all,*head,*tail,*ready_head,*ready_tail;
    size_t active,reserved,workers;
    uint64_t next_id;
    int closing,last_process;
    void (*wake)(void *);
    void *waker;
};
static pthread_mutex_t registry_mutex=PTHREAD_MUTEX_INITIALIZER;
static Pool *registry;

static Pool *find_pool(JSRuntime *rt) {
    pthread_mutex_lock(&registry_mutex);
    Pool *p=registry;while(p && p->rt!=rt)p=p->next;
    pthread_mutex_unlock(&registry_mutex);return p;
}
static JSValue failure(JSContext *ctx,const char *code,const char *message) {
    JSValue error=JS_NewError(ctx);if(JS_IsException(error))return error;
    if(JS_SetPropertyStr(ctx,error,"code",JS_NewString(ctx,code))<0 ||
       JS_SetPropertyStr(ctx,error,"message",JS_NewString(ctx,message))<0){JS_FreeValue(ctx,error);return JS_EXCEPTION;}
    return JS_Throw(ctx,error);
}
static void *worker(void *opaque) {
    Pool *p=opaque;
    pthread_mutex_lock(&p->mutex);
    for(;;) {
        while(!p->head && !p->closing)pthread_cond_wait(&p->changed,&p->mutex);
        if(!p->head && p->closing)break;
        QJSCosmoTask *task=p->head;p->head=task->queue_next;if(!p->head)p->tail=NULL;
        task->queue_next=NULL;task->state=RUNNING;
        pthread_mutex_unlock(&p->mutex);
        int error=js_cosmo_task_cancelled(task)?ECANCELED:task->work(task);
        pthread_mutex_lock(&p->mutex);
        task->error=js_cosmo_task_cancelled(task)?ECANCELED:error;task->state=READY;
        if(p->ready_tail)p->ready_tail->ready_next=task;else p->ready_head=task;
        p->ready_tail=task;
        pthread_cond_broadcast(&p->changed);
        /* Shutdown joins these workers before destroying the shared waker. */
        p->wake(p->waker);
    }
    pthread_mutex_unlock(&p->mutex);return NULL;
}
static Pool *get_pool(JSContext *ctx) {
    JSRuntime *rt=JS_GetRuntime(ctx);Pool *p=find_pool(rt);
    if(p)return p;
    p=js_mallocz(ctx,sizeof(*p));if(!p)return NULL;
    p->rt=rt;p->owner=pthread_self();p->next_id=1;
    if(js_cosmo_tasks_waker(rt,&p->wake,&p->waker)<0){
        js_free(ctx,p);failure(ctx,"ERR_TASK_LOOP_UNINITIALIZED","Initialize the host event loop before submitting native tasks");return NULL;
    }
    int error=pthread_mutex_init(&p->mutex,NULL);
    if(error){js_free(ctx,p);JS_ThrowInternalError(ctx,"Native task mutex initialization failed");return NULL;}
    error=pthread_cond_init(&p->changed,NULL);
    if(error){pthread_mutex_destroy(&p->mutex);js_free(ctx,p);JS_ThrowInternalError(ctx,"Native task condition initialization failed");return NULL;}
    for(size_t i=0;i<THREADS;i++) {
        error=pthread_create(p->threads+i,NULL,worker,p);
        if(error)break;
        p->workers++;
    }
    if(error) {
        pthread_mutex_lock(&p->mutex);p->closing=1;pthread_cond_broadcast(&p->changed);pthread_mutex_unlock(&p->mutex);
        for(size_t i=0;i<p->workers;i++)pthread_join(p->threads[i],NULL);
        pthread_cond_destroy(&p->changed);pthread_mutex_destroy(&p->mutex);js_free(ctx,p);
        failure(ctx,"ERR_TASK_THREAD_CREATION","Could not start the bounded native worker pool");return NULL;
    }
    pthread_mutex_lock(&registry_mutex);p->next=registry;registry=p;pthread_mutex_unlock(&registry_mutex);return p;
}
void *js_cosmo_task_alloc(QJSCosmoTask *task,size_t size) {
    if(!size)size=1;
    const size_t alignment=alignof(max_align_t);
    if(size>SIZE_MAX-alignment+1)return NULL;
    size=(size+alignment-1)&~(alignment-1);
    for(Block *b=task->arena;b;b=b->v.next)if(b->v.free && b->v.size>=size) {
        if(b->v.size-size>=sizeof(Block)+alignment) {
            Block *next=(void *)((char *)(b+1)+size);
            *next=(Block){.v={b->v.size-size-sizeof(Block),b->v.next,1}};
            b->v.next=next;b->v.size=size;
        }
        b->v.free=0;return b+1;
    }
    return NULL;
}
void js_cosmo_task_free(QJSCosmoTask *task,void *data) {
    if(!data)return;
    Block *b=(Block *)data-1;
    explicit_bzero(data,b->v.size);b->v.free=1;
    for(b=task->arena;b && b->v.next;) {
        if(b->v.free && b->v.next->v.free) {b->v.size+=sizeof(Block)+b->v.next->v.size;b->v.next=b->v.next->v.next;}
        else b=b->v.next;
    }
}
void *js_cosmo_task_realloc(QJSCosmoTask *task,void *data,size_t size) {
    if(!data)return js_cosmo_task_alloc(task,size);
    if(!size){js_cosmo_task_free(task,data);return NULL;}
    Block *b=(Block *)data-1;
    if(size<=b->v.size)return data;
    void *next=js_cosmo_task_alloc(task,size);
    if(next){memcpy(next,data,b->v.size);js_cosmo_task_free(task,data);}
    return next;
}
void *js_cosmo_task_data(QJSCosmoTask *task){return task->data;}
void js_cosmo_task_set_cleanup(QJSCosmoTask *task,QJSCosmoTaskCleanup cleanup){assert(task->state==PREPARED);task->cleanup=cleanup;}
int js_cosmo_task_cancelled(QJSCosmoTask *task){return atomic_load_explicit(&task->cancelled,memory_order_acquire);}

static void unlink_task(Pool *p,QJSCosmoTask *task) {
    QJSCosmoTask **link=&p->all;while(*link && *link!=task)link=&(*link)->all_next;
    assert(*link);*link=task->all_next;
}
static void destroy_task(QJSCosmoTask *task) {
    JSContext *ctx=task->ctx;JSRuntime *rt=task->pool->rt;
    if(task->cleanup)task->cleanup(task);
    JS_FreeValueRT(rt,task->resolving[0]);JS_FreeValueRT(rt,task->resolving[1]);
    if(task->allocation){explicit_bzero(task->allocation,task->budget+alignof(max_align_t));js_free_rt(rt,task->allocation);}
    js_free_rt(rt,task);JS_FreeContext(ctx);
}
static void release_task(QJSCosmoTask *task) {
    Pool *p=task->pool;size_t budget=task->budget;
    destroy_task(task);
    pthread_mutex_lock(&p->mutex);p->active--;p->reserved-=budget;pthread_mutex_unlock(&p->mutex);
}
QJSCosmoTask *js_cosmo_task_create(JSContext *ctx,size_t budget,size_t payload,QJSCosmoTaskWork work,QJSCosmoTaskFinish finish) {
    if(budget<sizeof(Block)+alignof(max_align_t) || budget>MAX_RESERVED || payload>budget-sizeof(Block) || !work || !finish){JS_ThrowRangeError(ctx,"Invalid native task arena");return NULL;}
    Pool *p=get_pool(ctx);if(!p)return NULL;
    assert(pthread_equal(p->owner,pthread_self()));
    pthread_mutex_lock(&p->mutex);
    int full=p->active>=CAPACITY,limited=budget>MAX_RESERVED-p->reserved;
    pthread_mutex_unlock(&p->mutex);
    if(full || limited){failure(ctx,full?"ERR_TASK_QUEUE_FULL":"ERR_TASK_MEMORY_LIMIT","Native task queue or reserved memory limit reached");return NULL;}
    QJSCosmoTask *task=js_mallocz(ctx,sizeof(*task));if(!task)return NULL;
    task->pool=p;task->ctx=JS_DupContext(ctx);task->budget=budget;task->work=work;task->finish=finish;
    task->resolving[0]=task->resolving[1]=JS_UNDEFINED;atomic_init(&task->cancelled,0);
    task->allocation=js_malloc_rt(p->rt,budget+alignof(max_align_t));
    if(!task->allocation){destroy_task(task);JS_ThrowOutOfMemory(ctx);return NULL;}
    task->arena=(void *)(((uintptr_t)task->allocation+alignof(max_align_t)-1)&~(uintptr_t)(alignof(max_align_t)-1));
    *task->arena=(Block){.v={budget-sizeof(Block),NULL,1}};
    task->data=js_cosmo_task_alloc(task,payload);
    if(!task->data){destroy_task(task);JS_ThrowOutOfMemory(ctx);return NULL;}
    memset(task->data,0,payload);
    pthread_mutex_lock(&p->mutex);
    task->id=p->next_id++;task->all_next=p->all;p->all=task;p->active++;p->reserved+=budget;
    pthread_mutex_unlock(&p->mutex);return task;
}
void js_cosmo_task_discard(QJSCosmoTask *task) {
    if(!task)return;
    Pool *p=task->pool;assert(task->state==PREPARED);
    pthread_mutex_lock(&p->mutex);unlink_task(p,task);pthread_mutex_unlock(&p->mutex);release_task(task);
}
JSValue js_cosmo_task_submit(JSContext *ctx,QJSCosmoTask *task,uint64_t *id) {
    if(task->ctx!=ctx){js_cosmo_task_discard(task);return JS_ThrowInternalError(ctx,"Native task context mismatch");}
    JSValue promise=JS_NewPromiseCapability(ctx,task->resolving);
    if(JS_IsException(promise)){js_cosmo_task_discard(task);return promise;}
    Pool *p=task->pool;pthread_mutex_lock(&p->mutex);
    task->state=QUEUED;if(p->tail)p->tail->queue_next=task;else p->head=task;p->tail=task;
    if(id)*id=task->id;
    pthread_cond_broadcast(&p->changed);pthread_mutex_unlock(&p->mutex);return promise;
}
int js_cosmo_task_cancel(JSContext *ctx,uint64_t id) {
    Pool *p=find_pool(JS_GetRuntime(ctx));if(!p)return 0;
    int found=0;pthread_mutex_lock(&p->mutex);
    for(QJSCosmoTask *t=p->all;t;t=t->all_next)if(t->id==id && t->ctx==ctx) {
        if(!atomic_exchange_explicit(&t->cancelled,1,memory_order_acq_rel))found=1;
        break;
    }
    pthread_cond_broadcast(&p->changed);pthread_mutex_unlock(&p->mutex);return found;
}
void js_cosmo_tasks_stats(JSRuntime *rt,QJSCosmoTaskStats *out) {
    memset(out,0,sizeof(*out));Pool *p=find_pool(rt);if(!p)return;
    pthread_mutex_lock(&p->mutex);out->active=p->active;out->reserved=p->reserved;out->workers=p->workers;
    for(QJSCosmoTask *t=p->all;t;t=t->all_next){if(t->state==QUEUED)out->queued++;else if(t->state==RUNNING)out->running++;else if(t->state==READY)out->ready++;}
    pthread_mutex_unlock(&p->mutex);
}
int js_cosmo_tasks_pending(JSRuntime *rt) {
    Pool *p=find_pool(rt);int pending=0;
    if(p){pthread_mutex_lock(&p->mutex);pending=p->active!=0;pthread_mutex_unlock(&p->mutex);}return pending || js_cosmo_process_pending(rt) || js_cosmo_net_pending(rt) || js_cosmo_stdio_pending(rt);
}
int js_cosmo_tasks_wait_ms(JSRuntime *rt,int maximum){return js_cosmo_stdio_active(rt)&&(maximum<0||maximum>10)?10:maximum;}
static _Thread_local int next_external;
static int external_poll(JSContext *ctx){
    next_external=(next_external+1)%3;
    if(next_external==0)return js_cosmo_net_poll(ctx) || js_cosmo_process_poll(ctx) || js_cosmo_stdio_poll(ctx);
    if(next_external==1)return js_cosmo_process_poll(ctx) || js_cosmo_stdio_poll(ctx) || js_cosmo_net_poll(ctx);
    return js_cosmo_stdio_poll(ctx) || js_cosmo_net_poll(ctx) || js_cosmo_process_poll(ctx);
}
int js_cosmo_tasks_poll(JSContext *ctx) {
    Pool *p=find_pool(JS_GetRuntime(ctx));if(!p)return external_poll(ctx);
    if(!p->last_process && external_poll(ctx)){p->last_process=1;return 1;}
    assert(pthread_equal(p->owner,pthread_self()));
    pthread_mutex_lock(&p->mutex);QJSCosmoTask *t=p->ready_head;
    if(t){p->ready_head=t->ready_next;if(!p->ready_head)p->ready_tail=NULL;unlink_task(p,t);}
    pthread_mutex_unlock(&p->mutex);if(!t)return external_poll(ctx);p->last_process=0;
    JSContext *owner=JS_DupContext(t->ctx);
    if(!js_cosmo_scheduler_stopped(t->ctx)) {
        int error=js_cosmo_task_cancelled(t)?ECANCELED:t->error;
        JSValue value=t->finish(t->ctx,t,error);int rejected=JS_IsException(value);
        if(rejected)value=JS_GetException(t->ctx);
        JSValue returned=JS_Call(t->ctx,t->resolving[rejected],JS_UNDEFINED,1,&value);
        JS_FreeValue(t->ctx,value);
        if(JS_IsException(returned))js_std_dump_error(t->ctx);
        JS_FreeValue(t->ctx,returned);
    }
    release_task(t);js_cosmo_checkpoint(owner,1);JS_FreeContext(owner);return 1;
}
void js_cosmo_tasks_close_context(JSContext *ctx) {
    js_cosmo_stdio_close_context(ctx);
    js_cosmo_tty_close_context(ctx);
    js_cosmo_net_close_context(ctx);
    js_cosmo_process_close_context(ctx);
    Pool *p=find_pool(JS_GetRuntime(ctx));if(!p)return;
    pthread_mutex_lock(&p->mutex);
    for(QJSCosmoTask *t=p->all;t;t=t->all_next)if(t->ctx==ctx)atomic_store_explicit(&t->cancelled,1,memory_order_release);
    pthread_cond_broadcast(&p->changed);
    for(;;) {
        int waiting=0;for(QJSCosmoTask *t=p->all;t;t=t->all_next)if(t->ctx==ctx && (t->state==QUEUED || t->state==RUNNING)){waiting=1;break;}
        if(!waiting)break;
        pthread_cond_wait(&p->changed,&p->mutex);
    }
    QJSCosmoTask *removed=NULL,**link=&p->all;
    while(*link) {
        QJSCosmoTask *t=*link;
        if(t->ctx!=ctx){link=&t->all_next;continue;}
        *link=t->all_next;t->all_next=removed;removed=t;p->active--;p->reserved-=t->budget;
    }
    p->ready_tail=NULL;link=&p->ready_head;
    while(*link) {QJSCosmoTask *t=*link;if(t->ctx==ctx)*link=t->ready_next;else {p->ready_tail=t;link=&t->ready_next;}}
    pthread_mutex_unlock(&p->mutex);
    while(removed){QJSCosmoTask *next=removed->all_next;destroy_task(removed);removed=next;}
}
void js_cosmo_tasks_shutdown(JSRuntime *rt) {
    js_cosmo_stdio_shutdown(rt);
    js_cosmo_tty_shutdown(rt);
    js_cosmo_net_shutdown(rt);
    js_cosmo_process_shutdown(rt);
    pthread_mutex_lock(&registry_mutex);Pool **link=&registry;
    while(*link && (*link)->rt!=rt)link=&(*link)->next;
    Pool *p=*link;if(p)*link=p->next;pthread_mutex_unlock(&registry_mutex);if(!p)return;
    assert(pthread_equal(p->owner,pthread_self()));
    pthread_mutex_lock(&p->mutex);p->closing=1;
    for(QJSCosmoTask *t=p->all;t;t=t->all_next)atomic_store_explicit(&t->cancelled,1,memory_order_release);
    pthread_cond_broadcast(&p->changed);pthread_mutex_unlock(&p->mutex);
    for(size_t i=0;i<p->workers;i++)pthread_join(p->threads[i],NULL);
    while(p->all){QJSCosmoTask *next=p->all->all_next;destroy_task(p->all);p->all=next;}
    pthread_cond_destroy(&p->changed);pthread_mutex_destroy(&p->mutex);js_free_rt(rt,p);
}
