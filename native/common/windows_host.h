#ifndef QJS_COSMO_WINDOWS_HOST_H
#define QJS_COSMO_WINDOWS_HOST_H
#include "quickjs.h"
JSValue js_cosmo_windows_environment(JSContext *ctx);
JSValue js_cosmo_windows_arguments(JSContext *ctx);
char *js_cosmo_host_realpath(const char *path, char *resolved);
char *js_cosmo_legacy_realpath(const char *path, char *resolved);
JSValue js_cosmo_windows_getenv(JSContext *ctx, JSValueConst name);
JSValue js_cosmo_windows_setenv(JSContext *ctx, JSValueConst name, JSValueConst value, int remove);
JSValue js_cosmo_windows_release(JSContext *ctx);
uint32_t js_cosmo_windows_pid(void);
uint32_t js_cosmo_windows_ppid(void);
char js_cosmo_windows_root_drive(void);
#endif
