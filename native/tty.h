#ifndef QJS_COSMO_TTY_H
#define QJS_COSMO_TTY_H
#include "quickjs.h"
JSValue js_cosmo_tty_api(JSContext *ctx);
JSValue js_cosmo_tty_legacy(JSContext *ctx, int argc, JSValueConst *argv);
void js_cosmo_tty_close_context(JSContext *ctx);
void js_cosmo_tty_shutdown(JSRuntime *rt);
void js_cosmo_tty_restore_all(void);
void js_cosmo_tty_signal(int number, void (*handler)(int));
#endif
