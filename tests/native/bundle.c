#include <stdio.h>
#include <string.h>
#include <assert.h>
#include "quickjs-libc.h"
static JSContext *new_context(JSRuntime *rt) {
    JSContext *ctx=JS_NewContext(rt);
    if(ctx&&js_cosmo_init_modules(ctx)<0) {JS_FreeContext(ctx);return NULL;}
    return ctx;
}
static void expect_code(JSContext *ctx,const char *expected) {
    JSValue error=JS_GetException(ctx),value=JS_GetPropertyStr(ctx,error,"code");
    const char *code=JS_ToCString(ctx,value);assert(code&&!strcmp(code,expected));
    JS_FreeCString(ctx,code);JS_FreeValue(ctx,value);JS_FreeValue(ctx,error);
}
static int ownership(const char *valid,const char *invalid) {
    JSRuntime *rt=JS_NewRuntime();assert(rt);js_std_init_handlers(rt);
    JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
    JSContext *contexts[5];char urls[4][128];
    for(int i=0;i<5;i++) {
        contexts[i]=new_context(rt);assert(contexts[i]);JS_SetContextOpaque(contexts[i],&contexts[i]);
        int rc=js_cosmo_bundle_eval(contexts[i],valid);
        if(i==4) {assert(rc<0);expect_code(contexts[i],"ERR_QJB_LIMIT");break;}
        assert(!rc);
        JSValue global=JS_GetGlobalObject(contexts[i]),value=JS_GetPropertyStr(contexts[i],global,"bundleURL");
        const char *url=JS_ToCString(contexts[i],value);assert(url&&strlen(url)<sizeof(urls[i]));strcpy(urls[i],url);
        JS_FreeCString(contexts[i],url);JS_FreeValue(contexts[i],value);JS_FreeValue(contexts[i],global);
        for(int j=0;j<i;j++)assert(strcmp(urls[j],urls[i]));
        assert(JS_GetContextOpaque(contexts[i])==&contexts[i]);
    }
    assert(!js_cosmo_bundle_resolve(contexts[1],urls[1],urls[0]));expect_code(contexts[1],"ERR_QJB_MOUNT");
    void *lease=js_cosmo_bundle_acquire(contexts[0]);assert(lease);
    JS_FreeContext(contexts[0]);JS_RunGC(rt);
    assert(js_cosmo_bundle_eval(contexts[4],valid)<0);expect_code(contexts[4],"ERR_QJB_LIMIT");
    js_cosmo_bundle_release(lease);
    assert(!js_cosmo_bundle_eval(contexts[4],valid));
    for(int i=1;i<5;i++)JS_FreeContext(contexts[i]);
    JS_RunGC(rt);
    for(int i=0;i<16;i++) {
        JSContext *ctx=new_context(rt);assert(ctx);
        assert(js_cosmo_bundle_eval(ctx,invalid)<0);expect_code(ctx,"ERR_QJB_FORMAT");
        JS_FreeContext(ctx);JS_RunGC(rt);
    }
    JSContext *ctx=new_context(rt);assert(ctx);assert(!js_cosmo_bundle_eval(ctx,valid));JS_FreeContext(ctx);
    js_std_free_handlers(rt);JS_FreeRuntime(rt);puts("PASS qjb-ownership");return 0;
}
int main(int argc,char **argv) {
    if(argc<2)return 2;
    if(argc==4&&!strcmp(argv[1],"--ownership"))return ownership(argv[2],argv[3]);
    JSRuntime *rt=JS_NewRuntime();if(!rt)return 2;
    js_std_init_handlers(rt);js_std_set_worker_new_context_func(new_context);
    JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
    int opaque=17;
    JSContext *ctx=new_context(rt);if(!ctx) {js_std_free_handlers(rt);JS_FreeRuntime(rt);return 2;}
    JS_SetContextOpaque(ctx,&opaque);
    js_std_add_helpers(ctx,argc-1,argv+1);
    int result=js_cosmo_set_cli(ctx,argc,argv,1,5);
    JSValue global=JS_GetGlobalObject(ctx);
    JS_SetPropertyStr(ctx,global,"qjbSDK",JS_TRUE);JS_FreeValue(ctx,global);
    if(result>=0)result=js_cosmo_bundle_eval(ctx,argv[1]);
    if(result<0)js_std_dump_error(ctx);else js_std_loop(ctx);
    int code=result<0?1:js_cosmo_exit_code(ctx);
    if(JS_GetContextOpaque(ctx)!=&opaque)code=3;
    js_std_free_handlers(rt);JS_FreeContext(ctx);JS_FreeRuntime(rt);
    return code;
}
