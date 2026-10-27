#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"

int main(void) {
    for (int iteration = 0; iteration < 8; iteration++) {
        JSRuntime *runtime = JS_NewRuntime();
        assert(runtime);
        js_std_init_handlers(runtime);
        JSContext *context = JS_NewContext(runtime);
        assert(context);
        JS_SetContextOpaque(context, (void *)(uintptr_t)0x1234);
        assert(js_cosmo_init_modules(context) == 0);
        JS_SetModuleLoaderFunc2(runtime, js_cosmo_module_normalize, js_module_loader, js_module_check_attributes, NULL);
        for (int round = 0; round < 2; round++) {
            const char script[] = "globalThis.trace=[];"
                "process.on('beforeExit',()=>{throw Error('SDK host owns exit');});"
                "process.nextTick(()=>trace.push('tick'));"
                "queueMicrotask(()=>trace.push('micro'));"
                "Promise.resolve().then(()=>trace.push('promise'));"
                "setTimeout(()=>{trace.push('timer');process.nextTick(()=>trace.push('timer-tick'));"
                "Promise.resolve().then(()=>trace.push('timer-promise'));},2);";
            char filename[64]; snprintf(filename, sizeof(filename), "<sdk-scheduler-%d>", round);
            JSValue value = JS_Eval(context, script, strlen(script), filename, JS_EVAL_TYPE_MODULE);
            value = js_std_await(context, value);
            if (JS_IsException(value)) js_std_dump_error(context);
            assert(!JS_IsException(value)); JS_FreeValue(context, value);
            js_std_loop(context);
            const char check[] = "if(trace.join(',')!=='micro,promise,tick,timer,timer-tick,timer-promise')throw Error(trace.join(','));";
            value = JS_Eval(context, check, strlen(check), "<sdk-scheduler-check>", JS_EVAL_TYPE_GLOBAL);
            if (JS_IsException(value)) js_std_dump_error(context);
            assert(!JS_IsException(value)); JS_FreeValue(context, value);
            assert(JS_GetContextOpaque(context) == (void *)(uintptr_t)0x1234);
            JS_RunGC(runtime);
        }
        js_std_free_handlers(runtime);
        JS_FreeContext(context);
        JS_FreeRuntime(runtime);
    }
    puts("PASS scheduler-sdk: repeated loops, ordering, ContextOpaque and cleanup");
    return 0;
}
