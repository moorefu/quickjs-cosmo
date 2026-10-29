#ifndef QJS_COSMO_BUNDLE_H
#define QJS_COSMO_BUNDLE_H
#include "quickjs.h"
void *js_cosmo_bundle_acquire(JSContext *ctx);
void *js_cosmo_bundle_retain(void *bundle);
void js_cosmo_bundle_release(void *bundle);
void js_cosmo_bundle_enter(void *bundle);
void *js_cosmo_bundle_inherited(void);
char *js_cosmo_bundle_resolve(JSContext *ctx, const char *base, const char *name);
JSModuleDef *js_cosmo_bundle_load(JSContext *ctx, const char *name);
int js_cosmo_bundle_eval(JSContext *ctx, const char *filename);
JSValue js_cosmo_bundle_api(JSContext *ctx);
#endif
