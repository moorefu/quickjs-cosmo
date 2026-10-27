#ifndef QUICKJS_COSMO_PROCESS_ASYNC_H
#define QUICKJS_COSMO_PROCESS_ASYNC_H
#include "quickjs.h"
#include "core.h"
JSValue js_cosmo_process_async_api(JSContext *);
JSValue js_cosmo_process_start(JSContext *,const QPRequest *,QPAllocator *,JSValueConst);
int js_cosmo_process_pending(JSRuntime *);
int js_cosmo_process_poll(JSContext *);
void js_cosmo_process_close_context(JSContext *);
void js_cosmo_process_shutdown(JSRuntime *);
#endif
