#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"

int main(int argc, char **argv) {
    assert(argc == 3);
    int teardown = !strcmp(argv[2], "teardown");
    for (int iteration = 0; iteration < (teardown ? 4 : 1); iteration++) {
    JSRuntime *rt = JS_NewRuntime(); assert(rt); js_std_init_handlers(rt);
    JSContext *ctx = JS_NewContext(rt); assert(ctx); assert(!js_cosmo_init_modules(ctx));
    JS_SetModuleLoaderFunc2(rt, js_cosmo_module_normalize, js_module_loader, js_module_check_attributes, NULL);
    JSValue global = JS_GetGlobalObject(ctx);
    assert(JS_SetPropertyStr(ctx, global, "sdkStdioMode", JS_NewString(ctx, argv[2])) >= 0);
    JS_FreeValue(ctx, global);
    size_t size; uint8_t *source = js_load_file(ctx, &size, argv[1]); assert(source);
    JSValue value = JS_Eval(ctx, (char *)source, size, argv[1], JS_EVAL_TYPE_MODULE);
    js_free(ctx, source);
    if (!JS_IsException(value)) value = js_std_await(ctx, value);
    if (JS_IsException(value)) { js_std_dump_error(ctx); return 1; }
    JS_FreeValue(ctx, value);
    if (teardown) {
        const char *pending = "process.stdin.once('error',error=>{throw error;});process.stdin.resume();process.stdin.unref();";
        value = JS_Eval(ctx, pending, strlen(pending), "<stdio-teardown>", JS_EVAL_TYPE_GLOBAL);
        assert(!JS_IsException(value)); JS_FreeValue(ctx, value);
        assert(js_cosmo_checkpoint(ctx, 1) >= 0);
    } else js_std_loop(ctx);
    js_std_free_handlers(rt); JS_FreeContext(ctx); JS_FreeRuntime(rt);
    }
    return 0;
}
