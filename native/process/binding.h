#ifndef QUICKJS_COSMO_PROCESS_BINDING_H
#define QUICKJS_COSMO_PROCESS_BINDING_H
#include "quickjs.h"
JSValue js_cosmo_child_process_api(JSContext *);
JSValue js_cosmo_process_error_info(JSContext *,int);
#endif
