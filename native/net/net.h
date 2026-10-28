#ifndef QUICKJS_COSMO_NET_H
#define QUICKJS_COSMO_NET_H
#include "quickjs.h"
JSValue js_cosmo_net_api(JSContext *);
JSValue js_cosmo_dns_api(JSContext *);
int js_cosmo_net_pending(JSRuntime *);
int js_cosmo_net_poll(JSContext *);
void js_cosmo_net_close_context(JSContext *);
void js_cosmo_net_shutdown(JSRuntime *);
#endif
