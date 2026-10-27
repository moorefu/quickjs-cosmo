#ifndef QUICKJS_COSMO_FS_SYNC_H
#define QUICKJS_COSMO_FS_SYNC_H
#include "quickjs.h"
JSValue js_cosmo_fs_api(JSContext *ctx);
int qjs_cosmo_fs_openat(int, const char *, int, ...);
int qjs_cosmo_fs_mkdirat(int, const char *, unsigned);
int qjs_cosmo_fs_renameat(int, const char *, int, const char *);
char *qjs_cosmo_fs_mkdtemp(char *);
#endif
