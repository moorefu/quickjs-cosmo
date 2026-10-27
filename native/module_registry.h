#ifndef QUICKJS_COSMO_MODULE_REGISTRY_H
#define QUICKJS_COSMO_MODULE_REGISTRY_H
#include "quickjs.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Call once per new context. Install the normalizer on its runtime as well. */
int js_cosmo_init_modules(JSContext *ctx);
int js_cosmo_is_builtin(const char *name);
JSModuleDef *js_cosmo_load_builtin(JSContext *ctx, const char *name);
char *js_cosmo_module_normalize(JSContext *ctx, const char *base,
                               const char *name, void *opaque);
/* Syntactic only: compiled modules need not exist on disk at runtime. */
char *js_cosmo_normalize_path(JSContext *ctx, const char *filename);

#ifdef __cplusplus
}
#endif
#endif
