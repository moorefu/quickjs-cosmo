#ifndef QJS_COSMO_STDIO_BINDING_H
#define QJS_COSMO_STDIO_BINDING_H
#include "quickjs.h"
JSValue js_cosmo_stdio_api(JSContext *);
int js_cosmo_stdio_pending(JSRuntime *);
int js_cosmo_stdio_active(JSRuntime *);
int js_cosmo_stdio_poll(JSContext *);
void js_cosmo_stdio_close_context(JSContext *);
void js_cosmo_stdio_shutdown(JSRuntime *);
#endif
