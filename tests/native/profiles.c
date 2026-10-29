#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
#include "profiles-source.h"
int main(void) {
    JSRuntime *rt=JS_NewRuntime(); assert(rt); js_std_init_handlers(rt);
    JSContext *ctx=JS_NewContext(rt); assert(ctx);
    assert(!js_cosmo_init_modules(ctx));
    JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
    JSValue value=JS_Eval(ctx,profile_source,strlen(profile_source),"<profile-sdk>",JS_EVAL_TYPE_MODULE);
    if(JS_IsException(value)){js_std_dump_error(ctx);return 1;}
    value=js_std_await(ctx,value);
    if(JS_IsException(value)){js_std_dump_error(ctx);return 1;}
    JS_FreeValue(ctx,value);JS_FreeContext(ctx);js_std_free_handlers(rt);JS_FreeRuntime(rt);
    puts("PASS profiles-sdk");
}
