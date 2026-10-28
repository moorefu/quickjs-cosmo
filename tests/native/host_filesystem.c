#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <signal.h>
#include <string.h>
#include <unistd.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
static JSContext *worker_context(JSRuntime *rt){
    JSContext *ctx=JS_NewContext(rt);if(!ctx)return NULL;
    if(js_cosmo_init_modules(ctx)<0){JS_FreeContext(ctx);return NULL;}return ctx;
}
int main(int argc,char **argv){
    if(argc==4&&!strcmp(argv[2],"--signal-child"))return kill(atoi(argv[3]),SIGUSR1)?1:0;
    js_std_set_worker_new_context_func(worker_context);
    assert(argc==3);JSRuntime *rt=JS_NewRuntime();assert(rt);js_std_init_handlers(rt);
    JSContext *ctx=JS_NewContext(rt);assert(ctx);JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);assert(!js_cosmo_init_modules(ctx));
    JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
    JSValue global=JS_GetGlobalObject(ctx);assert(JS_SetPropertyStr(ctx,global,"hostFilesystemRoot",JS_NewString(ctx,argv[2]))>=0);JS_FreeValue(ctx,global);
    global=JS_GetGlobalObject(ctx);assert(JS_SetPropertyStr(ctx,global,"hostFilesystemScript",JS_NewString(ctx,argv[1]))>=0);JS_FreeValue(ctx,global);
    size_t length;uint8_t *source=js_load_file(ctx,&length,argv[1]);assert(source);
    JSValue value=JS_Eval(ctx,(char *)source,length,argv[1],JS_EVAL_TYPE_MODULE|JS_EVAL_FLAG_COMPILE_ONLY);js_free(ctx,source);
    if(!JS_IsException(value)&&js_module_set_import_meta(ctx,value,1,1)<0){JS_FreeValue(ctx,value);value=JS_EXCEPTION;}
    if(!JS_IsException(value))value=JS_EvalFunction(ctx,value);
    if(!JS_IsException(value))value=js_std_await(ctx,value);
    if(JS_IsException(value)){js_std_dump_error(ctx);return 1;}JS_FreeValue(ctx,value);js_std_loop(ctx);
    assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);js_std_free_handlers(rt);JS_FreeContext(ctx);JS_FreeRuntime(rt);return 0;
}
