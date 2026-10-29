#ifndef QJS_COSMO_RUNTIME_STATE_H
#define QJS_COSMO_RUNTIME_STATE_H
#include "quickjs.h"

typedef struct {
    JSValue holder, data, apis;
    JSModuleDef *modules[64];
    int worker;
    int mode;
    int scheduler_failed;
    int scheduler_finished;
    char *compiled_root;
    char *worker_entry;
    void *bundle;
} CosmoRuntimeState;

CosmoRuntimeState *js_cosmo_state(JSContext *ctx);
int js_cosmo_lookup_state(JSContext *ctx, CosmoRuntimeState **result);
JSValue js_cosmo_native_api(JSContext *ctx, CosmoRuntimeState *state);
#endif
