#include <stdint.h>
#include <string.h>
#include <cosmo.h>
#include "quickjs-libc.h"
#include "module_registry.h"
#include "qjs-cosmo-config.h"

typedef JSModuleDef *(*BuiltinInit)(JSContext *, const char *);
typedef struct {
    const char *name;
    BuiltinInit init;
} Builtin;

static JSModuleDef *runtime_module(JSContext *, const char *);

/* Only real implementations belong here. There are no planned Node stubs. */
static const Builtin builtins[] = {
    { "std", js_init_module_std },
    { "os", js_init_module_os },
    { "cosmo:runtime", runtime_module },
};

static const char *canonical_builtin(const char *name) {
    if (!strcmp(name, "qjs:std")) return "std";
    if (!strcmp(name, "qjs:os")) return "os";
    for (size_t i = 0; i < sizeof(builtins) / sizeof(*builtins); i++) {
        const char *canonical = builtins[i].name;
        if (!strcmp(name, canonical)) return canonical;
        if (!strncmp(canonical, "node:", 5) && strcmp(canonical, "node:os") &&
            !strcmp(name, canonical + 5)) return canonical;
    }
    return NULL;
}

static int set_string(JSContext *ctx, JSValueConst object, const char *key, const char *text) {
    JSValue value = JS_NewString(ctx, text);
    if (JS_IsException(value)) return -1;
    return JS_SetPropertyStr(ctx, object, key, value);
}

static void unknown_builtin(JSContext *ctx, const char *name) {
    static const char prefix[] = "Unknown builtin module: ";
    JSValue error = JS_NewError(ctx);
    if (JS_IsException(error)) return;
    size_t length = strlen(name);
    if (length > SIZE_MAX - sizeof(prefix)) {
        JS_FreeValue(ctx, error); JS_ThrowOutOfMemory(ctx); return;
    }
    char *text = js_malloc(ctx, sizeof(prefix) + length);
    if (!text) { JS_FreeValue(ctx, error); return; }
    memcpy(text, prefix, sizeof(prefix) - 1);
    memcpy(text + sizeof(prefix) - 1, name, length + 1);
    JSValue message = JS_NewStringLen(ctx, text, sizeof(prefix) - 1 + length);
    js_free(ctx, text);
    if (JS_IsException(message)) { JS_FreeValue(ctx, error); return; }
    if (JS_SetPropertyStr(ctx, error, "message", message) < 0 ||
        set_string(ctx, error, "code", "ERR_UNKNOWN_BUILTIN_MODULE") < 0) {
        JS_FreeValue(ctx, error);
        return;
    }
    JS_Throw(ctx, error);
}

/* Collapse segments without realpath(), which would break qjsc resources.
   Preserve relative leading '..', absolute roots, Windows drives and UNC roots. */
char *js_cosmo_normalize_path(JSContext *ctx, const char *filename) {
    char *path = js_std_normalize_filename(ctx, filename);
    size_t read = 0, write = 0, prefix = 0, depth = 0, protected = 0;
    int absolute = 0;
    if (!path) return NULL;
    if (!path[0]) { js_free(ctx, path); return js_strdup(ctx, "."); }
    if (IsWindows() && path[0] && path[1] == ':') {
        read = write = prefix = 2;
        if (path[2] == '/') {
            path[write++] = '/';
            read++;
            prefix++;
            absolute = 1;
        }
    } else if (path[0] == '/') {
        read = write = prefix = 1;
        absolute = 1;
        if (IsWindows() && path[1] == '/') {
            read = write = prefix = 2;
            protected = 2; /* server/share cannot be removed by '..'. */
        }
    }
    while (path[read]) {
        while (path[read] == '/') read++;
        size_t start = read;
        while (path[read] && path[read] != '/') read++;
        size_t length = read - start;
        if (!length || (length == 1 && path[start] == '.')) continue;
        if (length == 2 && path[start] == '.' && path[start + 1] == '.') {
            size_t last = write;
            while (last > prefix && path[last - 1] != '/') last--;
            int parent = write - last == 2 && path[last] == '.' && path[last + 1] == '.';
            if (depth > protected && !parent) {
                write = last > prefix ? last - 1 : prefix;
                depth--;
                continue;
            }
            if (absolute) continue;
        }
        if (write > prefix) path[write++] = '/';
        memmove(path + write, path + start, length);
        write += length;
        depth++;
    }
    if (!write) path[write++] = '.';
    path[write] = '\0';
    return path;
}

char *js_cosmo_module_normalize(JSContext *ctx, const char *base,
                               const char *name, void *opaque) {
    const char *canonical = canonical_builtin(name);
    char *relative, *joined, *result, *normalized_base;
    const char *slash;
    size_t directory, length;
    (void)opaque;
    if (canonical) return js_strdup(ctx, canonical);
    if (!strncmp(name, "node:", 5) || !strncmp(name, "cosmo:", 6) || !strncmp(name, "qjs:", 4) ||
        !strncmp(name, "@runtime/", 9)) {
        unknown_builtin(ctx, name);
        return NULL;
    }
    relative = js_std_normalize_filename(ctx, name);
    if (!relative) return NULL;
    if (relative[0] != '.') {
        result = js_cosmo_normalize_path(ctx, relative);
        js_free(ctx, relative);
        return result;
    }
    normalized_base = js_std_normalize_filename(ctx, base);
    if (!normalized_base) { js_free(ctx, relative); return NULL; }
    slash = strrchr(normalized_base, '/');
    directory = slash ? (size_t)(slash - normalized_base + 1) : 0;
    length = strlen(relative);
    if (directory > SIZE_MAX - length - 1) {
        js_free(ctx, relative);
        js_free(ctx, normalized_base);
        JS_ThrowOutOfMemory(ctx);
        return NULL;
    }
    joined = js_malloc(ctx, directory + length + 1);
    if (!joined) {
        js_free(ctx, relative);
        js_free(ctx, normalized_base);
        return NULL;
    }
    memcpy(joined, normalized_base, directory);
    memcpy(joined + directory, relative, length + 1);
    result = js_cosmo_normalize_path(ctx, joined);
    js_free(ctx, joined);
    js_free(ctx, relative);
    js_free(ctx, normalized_base);
    return result;
}

int js_cosmo_is_builtin(const char *name) {
    return canonical_builtin(name) != NULL;
}

JSModuleDef *js_cosmo_load_builtin(JSContext *ctx, const char *name) {
    const char *canonical = canonical_builtin(name);
    if (canonical) {
        for (size_t i = 0; i < sizeof(builtins) / sizeof(*builtins); i++)
            if (!strcmp(canonical, builtins[i].name)) return builtins[i].init(ctx, canonical);
    }
    unknown_builtin(ctx, name);
    return NULL;
}

int js_cosmo_init_modules(JSContext *ctx) {
    for (size_t i = 0; i < sizeof(builtins) / sizeof(*builtins); i++)
        if (!builtins[i].init(ctx, builtins[i].name)) return -1;
    return 0;
}

static JSValue runtime_info(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    JSValue info = JS_NewObject(ctx), modules;
    const char *platform;
    (void)self; (void)argc; (void)argv;
    if (JS_IsException(info)) return info;
    modules = JS_NewArray(ctx);
    if (JS_IsException(modules)) { JS_FreeValue(ctx, info); return modules; }
    for (size_t i = 0; i < sizeof(builtins) / sizeof(*builtins); i++) {
        JSValue name = JS_NewString(ctx, builtins[i].name);
        if (JS_IsException(name) || JS_SetPropertyUint32(ctx, modules, i, name) < 0) {
            JS_FreeValue(ctx, modules); JS_FreeValue(ctx, info); return JS_EXCEPTION;
        }
    }
    if (JS_SetPropertyStr(ctx, info, "builtinModules", modules) < 0) goto fail;
#if defined(__aarch64__)
    const char *arch = "arm64";
#else
    const char *arch = "x64";
#endif
    platform = IsWindows() ? "win32" : IsXnu() ? "darwin" : IsFreebsd() ? "freebsd" :
               IsOpenbsd() ? "openbsd" : IsNetbsd() ? "netbsd" : "linux";
    const char *keys[] = {"engine", "quickjsVersion", "quickjsCommit", "cosmopolitanVersion",
                          "cosmopolitanCommit", "nodeApiTarget", "platform", "arch"};
    const char *values[] = {"quickjs", QJS_COSMO_QUICKJS_VERSION, QJS_COSMO_QUICKJS_COMMIT,
                            QJS_COSMO_VERSION, QJS_COSMO_COMMIT, QJS_COSMO_NODE_TARGET, platform, arch};
    for (size_t i = 0; i < sizeof(keys) / sizeof(*keys); i++)
        if (set_string(ctx, info, keys[i], values[i]) < 0) goto fail;
    return info;
fail:
    JS_FreeValue(ctx, info);
    return JS_EXCEPTION;
}

static int runtime_init(JSContext *ctx, JSModuleDef *module) {
    JSValue function = JS_NewCFunction(ctx, runtime_info, "runtimeInfo", 0);
    if (JS_IsException(function)) return -1;
    return JS_SetModuleExport(ctx, module, "runtimeInfo", function);
}

static JSModuleDef *runtime_module(JSContext *ctx, const char *name) {
    JSModuleDef *module = JS_NewCModule(ctx, name, runtime_init);
    if (!module || JS_AddModuleExport(ctx, module, "runtimeInfo") < 0) return NULL;
    return module;
}
