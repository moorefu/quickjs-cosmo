#ifndef QUICKJS_COSMO_TASKS_H
#define QUICKJS_COSMO_TASKS_H
#include <stddef.h>
#include <stdint.h>
#include "quickjs.h"
#ifdef __cplusplus
extern "C" {
#endif

typedef struct QJSCosmoTask QJSCosmoTask;
/* work runs on a native thread. It may use only task-owned copied data,
   the arena and host APIs, and must cooperate with cancellation. finish
   runs on the submitting context's thread and returns a value/exception.
   It must copy any returned arena data: the arena is wiped before JS jobs run. */
typedef int (*QJSCosmoTaskWork)(QJSCosmoTask *);
typedef JSValue (*QJSCosmoTaskFinish)(JSContext *,QJSCosmoTask *,int);
typedef void (*QJSCosmoTaskCleanup)(QJSCosmoTask *);
typedef struct {size_t active,queued,running,ready,reserved,workers;} QJSCosmoTaskStats;

QJSCosmoTask *js_cosmo_task_create(JSContext *,size_t,size_t,QJSCosmoTaskWork,QJSCosmoTaskFinish);
void *js_cosmo_task_data(QJSCosmoTask *);
/* Register while prepared. Runs exactly once on the owner thread, including
   discard, cancellation and shutdown. It must not execute JavaScript. */
void js_cosmo_task_set_cleanup(QJSCosmoTask *,QJSCosmoTaskCleanup);
void *js_cosmo_task_alloc(QJSCosmoTask *,size_t);
void *js_cosmo_task_realloc(QJSCosmoTask *,void *,size_t);
void js_cosmo_task_free(QJSCosmoTask *,void *);
int js_cosmo_task_cancelled(QJSCosmoTask *);
/* submit consumes the prepared task on both success and failure. */
JSValue js_cosmo_task_submit(JSContext *,QJSCosmoTask *,uint64_t *);
void js_cosmo_task_discard(QJSCosmoTask *);
int js_cosmo_task_cancel(JSContext *,uint64_t);
void js_cosmo_tasks_close_context(JSContext *);
void js_cosmo_tasks_shutdown(JSRuntime *);
void js_cosmo_tasks_stats(JSRuntime *,QJSCosmoTaskStats *);
int js_cosmo_tasks_pending(JSRuntime *);
int js_cosmo_tasks_poll(JSContext *);
/* The libc bridge shares its existing atomics waker, whose lifetime extends
   through worker joins. wake never invokes a QuickJS API on the worker. */
int js_cosmo_tasks_waker(JSRuntime *,void (**)(void *),void **);
#ifdef __cplusplus
}
#endif
#endif
