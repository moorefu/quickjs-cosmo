#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <cosmo.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"

static void check_path(JSContext *ctx, const char *input, const char *expected) {
    char *actual = js_cosmo_normalize_path(ctx, input);
    assert(actual && !strcmp(actual, expected));
    js_free(ctx, actual);
}

int main(void) {
    for (int i = 0; i < 16; i++) {
        JSRuntime *rt = JS_NewRuntime();
        assert(rt);
        js_std_init_handlers(rt);
        JSContext *ctx = JS_NewContext(rt);
        assert(ctx && js_cosmo_init_modules(ctx) == 0);
        JS_SetModuleLoaderFunc2(rt, js_cosmo_module_normalize, js_module_loader, js_module_check_attributes, NULL);
        check_path(ctx, "", ".");
        check_path(ctx, ".", ".");
        check_path(ctx, "a/./b/../c", "a/c");
        check_path(ctx, "../../a/../b", "../../b");
        check_path(ctx, "a/..", ".");
        check_path(ctx, "/a/../../b", "/b");
        if (IsWindows()) {
            check_path(ctx, "C:\\a\\..\\b", "C:/b");
            check_path(ctx, "//server/share/a/../../b", "//server/share/b");
        }
        char *relative = js_cosmo_module_normalize(ctx, "/a/b/main.mjs", "../fixtures/../child.mjs", NULL);
        assert(relative && !strcmp(relative, "/a/child.mjs"));
        js_free(ctx, relative);
        const char script[] = "import * as a from 'std'; import * as b from 'qjs:std';"
                              "import {runtimeInfo} from 'cosmo:runtime';"
                              "import buffer, {Buffer} from 'node:buffer'; import * as alias from 'buffer';"
                              "if(a!==b || runtimeInfo().engine!=='quickjs') throw Error('SDK registry');"
                              "if(Buffer!==globalThis.Buffer || buffer.Buffer!==alias.Buffer) throw Error('SDK Buffer');"
                              "if(Buffer.from('\\ud83d\\ude00').toString('hex')!=='f09f9880') throw Error('SDK encoding');"
                              "if(new TextDecoder().decode(new TextEncoder().encode('abc'))!=='abc') throw Error('SDK text');";
        JSValue value = JS_Eval(ctx, script, strlen(script), "<sdk-registry>", JS_EVAL_TYPE_MODULE);
        if (JS_IsException(value)) { js_std_dump_error(ctx); return 1; }
        JSValue settled = js_std_await(ctx, value);
        if (JS_IsException(settled)) { js_std_dump_error(ctx); return 1; }
        JS_FreeValue(ctx, settled);
        JS_FreeContext(ctx);
        js_std_free_handlers(rt);
        JS_FreeRuntime(rt);
    }
    puts("PASS module-registry-sdk");
    return 0;
}
