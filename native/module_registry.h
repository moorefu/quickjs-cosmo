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
/* CLI modes: source=0, eval=1, compiled=2, SDK=3 (default). */
int js_cosmo_set_cli(JSContext *ctx, int argc, char **argv, int first, int mode);
int js_cosmo_set_compiled_root(JSContext *ctx, const char *root);
int js_cosmo_exit_code(JSContext *ctx);
uint8_t *js_cosmo_worker_snapshot(JSContext *ctx, size_t *size);
void js_cosmo_worker_enter(const uint8_t *data, size_t size, const char *base, const char *filename);
char *js_cosmo_absolute_filename(JSContext *ctx, const char *filename);
/* Returns 1 only when this is a plain upstream context, with no project state. */
int js_cosmo_import_meta(JSContext *ctx, JSValueConst module, int realpath, int main);
int js_cosmo_install_helpers(JSContext *ctx);
/* Shared with std's environment helpers; no JS callback runs under this lock. */
void js_cosmo_env_lock(void);
void js_cosmo_env_unlock(void);
char **js_cosmo_copy_environment(void);
void js_cosmo_free_environment(char **snapshot);

#ifdef __cplusplus
}
#endif
#endif
