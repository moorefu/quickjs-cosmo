#ifndef QUICKJS_COSMO_FS_ASYNC_H
#define QUICKJS_COSMO_FS_ASYNC_H
#include "quickjs.h"
struct stat;
JSValue js_cosmo_fs_async_api(JSContext *);
JSValue js_cosmo_fs_error(JSContext *,int,const char *);
JSValue js_cosmo_fs_stat(JSContext *,const struct stat *);
char *js_cosmo_fs_path(JSContext *,JSValueConst);
int js_cosmo_fs_flags(int);
#endif
