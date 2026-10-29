#include <errno.h>
#include <limits.h>
#include <pthread.h>
#include <pwd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>
#include <cosmo.h>
#include "quickjs-libc.h"
#include "module_registry.h"
#include "runtime_state.h"
#include "bundle.h"
#include "tty.h"
#include "common/windows_host.h"
#include "fs/sync.h"
#include "crypto/binding.h"
#include "compression/binding.h"
#include "process/binding.h"
#include "net/net.h"
#include "http/binding.h"
#include "stdio/binding.h"
#include "qjs-cosmo-config.h"

extern char **environ;
extern char **__argv;
static JSClassID state_class;
static pthread_once_t state_once = PTHREAD_ONCE_INIT;
static pthread_mutex_t environment_mutex = PTHREAD_MUTEX_INITIALIZER;
static struct timespec process_start;
static _Thread_local int worker_thread;
static _Thread_local const uint8_t *worker_state;
static _Thread_local size_t worker_state_size;
static _Thread_local const char *worker_base, *worker_filename;

void js_cosmo_env_lock(void) { pthread_mutex_lock(&environment_mutex); }
void js_cosmo_env_unlock(void) { pthread_mutex_unlock(&environment_mutex); }

void js_cosmo_free_environment(char **snapshot) {
    if (snapshot) {
        for (size_t i = 0; snapshot[i]; i++) free(snapshot[i]);
        free(snapshot);
    }
}

char **js_cosmo_copy_environment(void) {
    js_cosmo_env_lock();
    size_t count = 0;
    while (environ && environ[count]) count++;
    char **copy = calloc(count + 1, sizeof(char *));
    if (copy) for (size_t i = 0; i < count; i++) {
        if (!(copy[i] = strdup(environ[i]))) {
            js_cosmo_free_environment(copy); copy = NULL; break;
        }
    }
    js_cosmo_env_unlock();
    return copy;
}

static void state_once_init(void) {
    JS_NewClassID(&state_class);
    clock_gettime(CLOCK_MONOTONIC, &process_start);
}

static void state_mark(JSRuntime *rt, JSValueConst value, JS_MarkFunc *mark) {
    CosmoRuntimeState *state = JS_GetOpaque(value, state_class);
    if (state) {
        JS_MarkValue(rt, state->data, mark);
        JS_MarkValue(rt, state->apis, mark);
    }
}

static void state_finalize(JSRuntime *rt, JSValue value) {
    CosmoRuntimeState *state = JS_GetOpaque(value, state_class);
    if (state) {
        JS_FreeValueRT(rt, state->data);
        JS_FreeValueRT(rt, state->apis);
        js_free_rt(rt, state->compiled_root);
        js_free_rt(rt, state->worker_entry);
        js_cosmo_bundle_release(state->bundle);
        js_free_rt(rt, state);
    }
}

static const JSClassDef state_definition = {
    "CosmoRuntimeState", .finalizer = state_finalize, .gc_mark = state_mark,
};

static int put_string(JSContext *ctx, JSValueConst object, const char *key, const char *value) {
    JSValue text = JS_NewString(ctx, value);
    return JS_IsException(text) ? -1 : JS_SetPropertyStr(ctx, object, key, text);
}

static const char *platform_name(void) {
    return IsWindows() ? "win32" : IsXnu() ? "darwin" : IsFreebsd() ? "freebsd" :
           IsOpenbsd() ? "openbsd" : IsNetbsd() ? "netbsd" : "linux";
}

static const char *architecture(void) {
#ifdef __aarch64__
    return "arm64";
#else
    return "x64";
#endif
}

static JSValue system_error(JSContext *ctx, int number, const char *syscall, const char *path) {
    JSValue error = JS_NewError(ctx);
    const char *code = number == ENOENT ? "ENOENT" : number == ENOTDIR ? "ENOTDIR" :
        number == EACCES ? "EACCES" : number == EPERM ? "EPERM" : number == EINVAL ? "EINVAL" :
        number == ENOMEM ? "ENOMEM" : number == ENAMETOOLONG ? "ENAMETOOLONG" :
        number == ELOOP ? "ELOOP" : number == ERANGE ? "ERANGE" : number == ENOSYS ? "ENOSYS" : "EIO";
    int node_errno = !IsWindows() ? -number : number == ENOENT ? -4058 : number == ENOTDIR ? -4052 :
        number == EACCES ? -4092 : number == EPERM ? -4048 : number == EINVAL ? -4071 :
        number == ENOMEM ? -4057 : number == ENAMETOOLONG ? -4064 : number == ELOOP ? -4067 :
        number == ERANGE ? -4034 : number == ENOSYS ? -4054 : -4070;
    if (IsXnu()) node_errno = number == ENAMETOOLONG ? -63 : number == ELOOP ? -62 : number == ENOSYS ? -78 : -number;
    if (JS_IsException(error)) return error;
    if (put_string(ctx, error, "code", code) < 0 || put_string(ctx, error, "syscall", syscall) < 0 ||
        put_string(ctx, error, "message", strerror(number)) < 0 ||
        JS_SetPropertyStr(ctx, error, "errno", JS_NewInt32(ctx, node_errno)) < 0 ||
        (path && put_string(ctx, error, "path", path) < 0)) {
        JS_FreeValue(ctx, error); return JS_EXCEPTION;
    }
    return JS_Throw(ctx, error);
}

static JSValue coded_failure(JSContext *ctx, const char *code, const char *message) {
    JSValue error = JS_NewError(ctx);
    if (JS_IsException(error)) return error;
    if (put_string(ctx, error, "code", code) < 0 || put_string(ctx, error, "message", message) < 0) {
        JS_FreeValue(ctx, error); return JS_EXCEPTION;
    }
    return JS_Throw(ctx, error);
}

/* Convert Cosmo's internal slash form to the actual host's path spelling. */
static void host_separators(char *path) {
    if (!IsWindows()) return;
    if (path[0] == '/' && ((path[1] >= 'a' && path[1] <= 'z') || (path[1] >= 'A' && path[1] <= 'Z')) &&
        (path[2] == '/' || !path[2])) {
        path[0] = path[1]; path[1] = ':';
        if (!path[2]) { path[2] = '\\'; path[3] = 0; }
    } else if (path[0] == '/' && path[1] != '/') {
        /* Nightly elides its default Cosmos drive in /Users/... and /. */
        memmove(path + 2, path, strlen(path) + 1);
        char drive = js_cosmo_windows_root_drive();
        path[0] = drive >= 'a' && drive <= 'z' ? drive - 'a' + 'A' : drive;
        path[1] = ':';
    }
    for (char *p = path; *p; p++) if (*p == '/') *p = '\\';
}

static char *path_padding(JSContext *ctx, char *path) {
    if (!path) return NULL;
    char *expanded = js_realloc(ctx, path, strlen(path) + 3);
    if (!expanded) js_free(ctx, path);
    return expanded;
}

char *js_cosmo_absolute_filename(JSContext *ctx, const char *path) {
    if ((IsWindows() && ((path[0] && path[1] == ':') || path[0] == '\\')) || path[0] == '/')
        return path_padding(ctx, js_cosmo_normalize_path(ctx, path));
    char cwd[PATH_MAX];
    if (!getcwd(cwd, sizeof(cwd))) { system_error(ctx, errno, "getcwd", NULL); return NULL; }
    size_t size = strlen(cwd) + strlen(path) + 2;
    char *joined = js_malloc(ctx, size);
    if (!joined) return NULL;
    snprintf(joined, size, "%s/%s", cwd, path);
    char *result = js_cosmo_normalize_path(ctx, joined);
    js_free(ctx, joined);
    return path_padding(ctx, result);
}

static JSValue executable_path(JSContext *ctx) {
    const char *name = GetProgramExecutableName();
    if (!name || !*name) return system_error(ctx, ENOENT, "execPath", NULL);
    char *path = js_cosmo_absolute_filename(ctx, name);
    if (!path) return JS_EXCEPTION;
    host_separators(path);
    JSValue value = JS_NewString(ctx, path);
    js_free(ctx, path);
    return value;
}

static JSValue environment(JSContext *ctx) {
    if (IsWindows()) return js_cosmo_windows_environment(ctx);
    char **snapshot = js_cosmo_copy_environment();
    if (!snapshot) return JS_ThrowOutOfMemory(ctx);
    JSValue object = JS_NewObjectProto(ctx, JS_NULL);
    if (JS_IsException(object)) { js_cosmo_free_environment(snapshot); return object; }
    for (char **entry = snapshot; *entry; entry++) {
        char *equals = strchr(*entry + (IsWindows() && **entry == '='), '=');
        if (!equals) continue;
        JSAtom key = JS_NewAtomLen(ctx, *entry, equals - *entry);
        if (!key) goto fail;
        JSValue value = JS_NewString(ctx, equals + 1);
        int result = JS_IsException(value) ? -1 : JS_SetProperty(ctx, object, key, value);
        JS_FreeAtom(ctx, key);
        if (result < 0) goto fail;
    }
    js_cosmo_free_environment(snapshot);
    return object;
fail:
    js_cosmo_free_environment(snapshot);
    JS_FreeValue(ctx, object);
    return JS_EXCEPTION;
}

int js_cosmo_lookup_state(JSContext *ctx, CosmoRuntimeState **result) {
    *result = NULL;
    pthread_once(&state_once, state_once_init);
    if (!JS_IsRegisteredClass(JS_GetRuntime(ctx), state_class)) return 0;
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue symbol = JS_NewSymbol(ctx, "cosmo.internal.runtimeState", 1);
    if (JS_IsException(symbol)) { JS_FreeValue(ctx, global); return -1; }
    JSAtom key = JS_ValueToAtom(ctx, symbol);
    JS_FreeValue(ctx, symbol);
    if (!key) { JS_FreeValue(ctx, global); return -1; }
    JSValue holder = JS_GetProperty(ctx, global, key);
    JS_FreeAtom(ctx, key); JS_FreeValue(ctx, global);
    if (JS_IsException(holder)) return -1;
    if (JS_IsUndefined(holder)) return 0;
    *result = JS_GetOpaque2(ctx, holder, state_class);
    JS_FreeValue(ctx, holder);
    return *result ? 1 : -1;
}

CosmoRuntimeState *js_cosmo_state(JSContext *ctx) {
    pthread_once(&state_once, state_once_init);
    JSRuntime *rt = JS_GetRuntime(ctx);
    if (!JS_IsRegisteredClass(rt, state_class) && JS_NewClass(rt, state_class, &state_definition) < 0) {
        if (!JS_HasException(ctx)) JS_ThrowOutOfMemory(ctx);
        return NULL;
    }
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue symbol = JS_NewSymbol(ctx, "cosmo.internal.runtimeState", 1);
    if (JS_IsException(symbol)) { JS_FreeValue(ctx, global); return NULL; }
    JSAtom key = JS_ValueToAtom(ctx, symbol);
    JS_FreeValue(ctx, symbol);
    if (!key) { JS_FreeValue(ctx, global); return NULL; }
    JSValue holder = JS_GetProperty(ctx, global, key);
    if (JS_IsException(holder)) goto fail;
    if (!JS_IsUndefined(holder)) {
        CosmoRuntimeState *state = JS_GetOpaque2(ctx, holder, state_class);
        JS_FreeValue(ctx, holder); JS_FreeAtom(ctx, key); JS_FreeValue(ctx, global);
        return state;
    }
    holder = JS_NewObjectProtoClass(ctx, JS_NULL, state_class);
    if (JS_IsException(holder)) goto fail;
    CosmoRuntimeState *state = js_mallocz(ctx, sizeof(*state));
    if (!state) { JS_FreeValue(ctx, holder); goto fail; }
    state->holder = holder; /* Borrowed: the global and native closures own this object. */
    state->data = JS_UNDEFINED; state->apis = JS_UNDEFINED;
    state->worker = worker_thread; state->mode = 3;
    state->bundle = js_cosmo_bundle_inherited();
    JS_SetOpaque(holder, state);
    state->data = worker_state ? JS_ReadObject(ctx, worker_state, worker_state_size, JS_READ_OBJ_REFERENCE) : JS_NewObject(ctx);
    if (JS_IsException(state->data)) { state->data = JS_UNDEFINED; JS_FreeValue(ctx, holder); goto fail; }
    if (worker_filename) {
        state->worker_entry = js_cosmo_module_normalize(ctx, worker_base, worker_filename, NULL);
        if (!state->worker_entry) { JS_FreeValue(ctx, holder); goto fail; }
    }
    if (!worker_state) {
        JSValue env = environment(ctx), exe;
        if (JS_IsException(env)) { JS_FreeValue(ctx, holder); goto fail; }
        if (JS_SetPropertyStr(ctx, state->data, "env", env) < 0) { JS_FreeValue(ctx, holder); goto fail; }
        JSValue raw_args = IsWindows() ? js_cosmo_windows_arguments(ctx) : JS_UNDEFINED;
        JSValue argv0 = IsWindows() && !JS_IsException(raw_args) ? JS_GetPropertyUint32(ctx, raw_args, 0) :
            JS_IsException(raw_args) ? JS_EXCEPTION : JS_NewString(ctx, __argv && __argv[0] ? __argv[0] : "");
        JS_FreeValue(ctx, raw_args);
        if (JS_IsException(argv0) || JS_SetPropertyStr(ctx, state->data, "argv0", argv0) < 0) {
            JS_FreeValue(ctx, holder); goto fail;
        }
        exe = executable_path(ctx);
        if (JS_IsException(exe) || JS_SetPropertyStr(ctx, state->data, "execPath", exe) < 0) {
            JS_FreeValue(ctx, holder); goto fail;
        }
        JSValue args = JS_NewArray(ctx), options = JS_NewArray(ctx);
        if (JS_IsException(args) || JS_IsException(options)) {
            JS_FreeValue(ctx, args); JS_FreeValue(ctx, options); JS_FreeValue(ctx, holder); goto fail;
        }
        exe = JS_GetPropertyStr(ctx, state->data, "execPath");
        if (JS_IsException(exe) || JS_SetPropertyUint32(ctx, args, 0, exe) < 0) {
            JS_FreeValue(ctx, args); JS_FreeValue(ctx, options); JS_FreeValue(ctx, holder); goto fail;
        }
        int result = JS_SetPropertyStr(ctx, state->data, "argv", args);
        if (result < 0) { JS_FreeValue(ctx, options); JS_FreeValue(ctx, holder); goto fail; }
        if (JS_SetPropertyStr(ctx, state->data, "execArgv", options) < 0) { JS_FreeValue(ctx, holder); goto fail; }
    } else {
        JSValue exe = executable_path(ctx);
        if (JS_IsException(exe) || JS_SetPropertyStr(ctx, state->data, "execPath", exe) < 0) {
            JS_FreeValue(ctx, holder); goto fail;
        }
    }
    if (JS_SetPropertyStr(ctx, state->data, "worker", JS_NewBool(ctx, state->worker)) < 0 ||
        JS_SetPropertyStr(ctx, state->data, "exitCode", JS_UNDEFINED) < 0) {
        JS_FreeValue(ctx, holder); goto fail;
    }
    if (JS_DefinePropertyValue(ctx, global, key, holder, 0) < 0) goto fail;
    JS_FreeAtom(ctx, key); JS_FreeValue(ctx, global);
    return state;
fail:
    JS_FreeAtom(ctx, key); JS_FreeValue(ctx, global);
    return NULL;
}

enum { HOST_CWD, HOST_CHDIR, HOST_SETENV, HOST_UNSETENV, HOST_EXIT, HOST_CLOCK, HOST_UPTIME,
       HOST_HOSTNAME, HOST_RELEASE, HOST_HOMEDIR, HOST_STDOUT, HOST_STDERR, HOST_GETENV, HOST_ENVIRONMENT,
       HOST_TIMER_START, HOST_TIMER_CANCEL, HOST_CHECKPOINT, HOST_MICROTASK, HOST_FAIL, HOST_TIMER_REF };

static void scheduler_failure(JSContext *ctx) {
    CosmoRuntimeState *state;
    if (js_cosmo_lookup_state(ctx, &state) <= 0) return;
    state->scheduler_failed = 1;
    JS_SetPropertyStr(ctx, state->data, "exitCode", JS_NewInt32(ctx, 1));
}
void js_cosmo_scheduler_error(JSContext *ctx) {js_std_dump_error(ctx);scheduler_failure(ctx);}

static JSValue microtask_job(JSContext *ctx, int argc, JSValueConst *argv) {
    (void)argc;
    if (js_cosmo_scheduler_stopped(ctx)) return JS_UNDEFINED;
    return JS_Call(ctx, argv[0], JS_UNDEFINED, 0, NULL);
}

static JSValue host_call(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv,
                         int magic, JSValue *data) {
    CosmoRuntimeState *state = JS_GetOpaque2(ctx, data[0], state_class);
    (void)this_val; (void)argc;
    if (!state) return JS_EXCEPTION;
    if (magic == HOST_TIMER_START) {
        int64_t delay;
        if (JS_ToInt64(ctx, &delay, argv[1])) return JS_EXCEPTION;
        int flags = (JS_ToBool(ctx, argv[2]) ? 1 : 0) | (JS_ToBool(ctx, argv[3]) ? 2 : 4);
        return js_cosmo_start_timer(ctx, argv[0], delay, flags);
    }
    if (magic == HOST_TIMER_CANCEL) {
        int32_t identifier;
        if (JS_ToInt32(ctx, &identifier, argv[0])) return JS_EXCEPTION;
        js_cosmo_cancel_timer(ctx, identifier); return JS_UNDEFINED;
    }
    if (magic == HOST_TIMER_REF) {
        int32_t identifier;
        if (JS_ToInt32(ctx, &identifier, argv[0])) return JS_EXCEPTION;
        return JS_NewBool(ctx, js_cosmo_ref_timer(ctx, identifier, JS_ToBool(ctx, argv[1])));
    }
    if (magic == HOST_CHECKPOINT) {
        int result = js_cosmo_checkpoint(ctx, 1);
        if (!result) js_cosmo_check_rejections(ctx);
        return JS_NewBool(ctx, result == 0 && !js_cosmo_scheduler_stopped(ctx));
    }
    if (magic == HOST_MICROTASK) {
        if (JS_EnqueueJob(ctx, microtask_job, 1, argv) < 0) return JS_EXCEPTION;
        return JS_UNDEFINED;
    }
    if (magic == HOST_FAIL) {
        JS_Throw(ctx, JS_DupValue(ctx, argv[0])); js_std_dump_error(ctx);
        scheduler_failure(ctx); return JS_UNDEFINED;
    }
    if ((magic == HOST_CHDIR || magic == HOST_EXIT) && state->worker)
        return coded_failure(ctx, "ERR_WORKER_UNSUPPORTED_OPERATION", "This operation is not available in a QuickJS Worker");
    if (magic == HOST_CWD) {
        char path[PATH_MAX + 3];
        if (!getcwd(path, sizeof(path) - 3)) return system_error(ctx, errno, "getcwd", NULL);
        host_separators(path);
        return JS_NewString(ctx, path);
    }
    if (magic == HOST_CHDIR) {
        const char *path = JS_ToCString(ctx, argv[0]);
        if (!path) return JS_EXCEPTION;
        int result = chdir(path), saved = errno;
        JSValue value = result ? system_error(ctx, saved, "chdir", NULL) : JS_UNDEFINED;
        if (result && JS_IsException(value)) {
            JSValue error = JS_GetException(ctx);
            if (!JS_IsObject(error)) { JS_FreeCString(ctx, path); return JS_Throw(ctx, error); }
            char cwd[PATH_MAX + 3];
            if (getcwd(cwd, sizeof(cwd) - 3)) {
                host_separators(cwd);
                if (put_string(ctx, error, "path", cwd) < 0) { JS_FreeValue(ctx, error); JS_FreeCString(ctx, path); return JS_EXCEPTION; }
            }
            if (put_string(ctx, error, "dest", path) < 0) { JS_FreeValue(ctx, error); JS_FreeCString(ctx, path); return JS_EXCEPTION; }
            value = JS_Throw(ctx, error);
        }
        JS_FreeCString(ctx, path);
        return value;
    }
    if (magic == HOST_SETENV || magic == HOST_UNSETENV) {
        if (IsWindows()) return js_cosmo_windows_setenv(ctx, argv[0], magic == HOST_SETENV ? argv[1] : JS_UNDEFINED,
                                                      magic == HOST_UNSETENV);
        const char *key = JS_ToCString(ctx, argv[0]);
        if (!key) return JS_EXCEPTION;
        const char *value = magic == HOST_SETENV ? JS_ToCString(ctx, argv[1]) : NULL;
        if (magic == HOST_SETENV && !value) { JS_FreeCString(ctx, key); return JS_EXCEPTION; }
        /* Match Node: invalid environment names fail silently; C NUL terminates. */
        js_cosmo_env_lock();
        int result = magic == HOST_SETENV ? setenv(key, value, 1) : unsetenv(key);
        js_cosmo_env_unlock();
        JS_FreeCString(ctx, value); JS_FreeCString(ctx, key);
        return JS_NewBool(ctx, result == 0);
    }
    if (magic == HOST_ENVIRONMENT) return environment(ctx);
    if (magic == HOST_GETENV) {
        if (IsWindows()) return js_cosmo_windows_getenv(ctx, argv[0]);
        const char *key = JS_ToCString(ctx, argv[0]);
        if (!key) return JS_EXCEPTION;
        js_cosmo_env_lock();
        const char *text = getenv(key);
        JSValue value = text ? JS_NewString(ctx, text) : JS_UNDEFINED;
        js_cosmo_env_unlock();
        JS_FreeCString(ctx, key);
        return value;
    }
    if (magic == HOST_EXIT) {
        int32_t status;
        if (JS_ToInt32(ctx, &status, argv[0]) < 0) return JS_EXCEPTION;
        fflush(NULL);
        exit(status);
    }
    if (magic == HOST_CLOCK || magic == HOST_UPTIME) {
        struct timespec now;
        if (clock_gettime(CLOCK_MONOTONIC, &now)) return system_error(ctx, errno, "clock_gettime", NULL);
        if (magic == HOST_CLOCK) return JS_NewBigUint64(ctx, (uint64_t)now.tv_sec * 1000000000 + now.tv_nsec);
        double elapsed = (double)(now.tv_sec - process_start.tv_sec) + (now.tv_nsec - process_start.tv_nsec) / 1e9;
        return JS_NewFloat64(ctx, elapsed);
    }
    if (magic == HOST_HOSTNAME || magic == HOST_RELEASE) {
        if (magic == HOST_RELEASE && IsWindows()) return js_cosmo_windows_release(ctx);
        struct utsname info;
        if (uname(&info)) return system_error(ctx, errno, "uname", NULL);
        return JS_NewString(ctx, magic == HOST_HOSTNAME ? info.nodename : info.release);
    }
    if (magic == HOST_HOMEDIR) {
        struct passwd user, *result;
        char storage[16384];
        int error = getpwuid_r(getuid(), &user, storage, sizeof(storage), &result);
        if (error || !result) return system_error(ctx, error ? error : ENOENT, "uv_os_homedir", NULL);
        char *directory = path_padding(ctx, js_strdup(ctx, user.pw_dir));
        if (!directory) return JS_EXCEPTION;
        host_separators(directory);
        JSValue value = JS_NewString(ctx, directory);
        js_free(ctx, directory);
        return value;
    }
    if (magic == HOST_STDOUT || magic == HOST_STDERR) {
        size_t length;
        const char *text = JS_ToCStringLen(ctx, &length, argv[0]);
        if (!text) return JS_EXCEPTION;
        FILE *stream = magic == HOST_STDOUT ? stdout : stderr;
        size_t written = 0, start = 0;
        flockfile(stream);
        for (size_t i = 0; i + 2 < length; i++) {
            if ((uint8_t)text[i] == 0xed && ((uint8_t)text[i + 1] & 0xe0) == 0xa0 &&
                ((uint8_t)text[i + 2] & 0xc0) == 0x80) {
                /* QuickJS C strings use WTF-8 for lone UTF-16 surrogates.
                   Node's UTF-8 stdio encoder emits one replacement character. */
                written += fwrite(text + start, 1, i - start, stream);
                written += fwrite("\xef\xbf\xbd", 1, 3, stream);
                i += 2; start = i + 1;
            }
        }
        written += fwrite(text + start, 1, length - start, stream);
        int saved = errno;
        fflush(stream);
        funlockfile(stream);
        JS_FreeCString(ctx, text);
        return written == length ? JS_UNDEFINED : system_error(ctx, saved, "write", NULL);
    }
    return JS_UNDEFINED;
}

JSValue js_cosmo_native_api(JSContext *ctx, CosmoRuntimeState *state) {
    JSValue api = JS_NewObject(ctx);
    if (JS_IsException(api)) return api;
    const char *keys[] = {"cwd", "chdir", "setenv", "unsetenv", "exit", "clock", "uptime",
                          "hostname", "release", "homedir", "stdout", "stderr", "getenv", "environment",
                          "timerStart", "timerCancel", "checkpoint", "enqueueMicrotask", "fail", "timerRef"};
    for (size_t i = 0; i < sizeof(keys) / sizeof(*keys); i++) {
        JSValue fn = JS_NewCFunctionData(ctx, host_call, 0, i, 1, &state->holder);
        if (JS_IsException(fn) || JS_SetPropertyStr(ctx, api, keys[i], fn) < 0) goto fail;
    }
    if (put_string(ctx, api, "platform", platform_name()) < 0 || put_string(ctx, api, "arch", architecture()) < 0 ||
        put_string(ctx, api, "quickjsVersion", QJS_COSMO_QUICKJS_VERSION) < 0 ||
        put_string(ctx, api, "quickjsCommit", QJS_COSMO_QUICKJS_COMMIT) < 0 ||
        put_string(ctx, api, "cosmopolitanVersion", QJS_COSMO_VERSION) < 0 ||
        put_string(ctx, api, "cosmopolitanCommit", QJS_COSMO_COMMIT) < 0 ||
        JS_SetPropertyStr(ctx, api, "pid", JS_NewUint32(ctx, IsWindows() ? js_cosmo_windows_pid() : getpid())) < 0 ||
        JS_SetPropertyStr(ctx, api, "ppid", JS_NewUint32(ctx, IsWindows() ? js_cosmo_windows_ppid() : getppid())) < 0) goto fail;
    JSValue exe = executable_path(ctx);
    if (JS_IsException(exe) || JS_SetPropertyStr(ctx, api, "executablePath", exe) < 0) goto fail;
    JSValue fs = js_cosmo_fs_api(ctx);
    if (JS_IsException(fs) || JS_SetPropertyStr(ctx, api, "fs", fs) < 0) goto fail;
    JSValue crypto = js_cosmo_crypto_api(ctx);
    if (JS_IsException(crypto) || JS_SetPropertyStr(ctx, api, "crypto", crypto) < 0) goto fail;
    JSValue compression = js_cosmo_compression_api(ctx);
    if (JS_IsException(compression) || JS_SetPropertyStr(ctx, api, "compression", compression) < 0) goto fail;
    JSValue child_process = js_cosmo_child_process_api(ctx);
    if (JS_IsException(child_process) || JS_SetPropertyStr(ctx, api, "childProcess", child_process) < 0) goto fail;
    JSValue dns = js_cosmo_dns_api(ctx);
    if (JS_IsException(dns) || JS_SetPropertyStr(ctx, api, "dns", dns) < 0) goto fail;
    JSValue net = js_cosmo_net_api(ctx);
    if (JS_IsException(net) || JS_SetPropertyStr(ctx, api, "net", net) < 0) goto fail;
    JSValue http = js_cosmo_http_api(ctx);
    if (JS_IsException(http) || JS_SetPropertyStr(ctx, api, "http", http) < 0) goto fail;
    JSValue stdio = js_cosmo_stdio_api(ctx);
    if (JS_IsException(stdio) || JS_SetPropertyStr(ctx, api, "stdio", stdio) < 0) goto fail;
    JSValue bundle = js_cosmo_bundle_api(ctx);
    if (JS_IsException(bundle) || JS_SetPropertyStr(ctx, api, "bundle", bundle) < 0) goto fail;
    JSValue tty = js_cosmo_tty_api(ctx);
    if (JS_IsException(tty) || JS_SetPropertyStr(ctx, api, "tty", tty) < 0) goto fail;
    return api;
fail:
    JS_FreeValue(ctx, api); return JS_EXCEPTION;
}

void js_cosmo_worker_enter(const uint8_t *data, size_t size, const char *base, const char *filename) {
    worker_thread = 1; worker_state = data; worker_state_size = size;
    worker_base = base; worker_filename = filename;
}

uint8_t *js_cosmo_worker_snapshot(JSContext *ctx, size_t *size) {
    CosmoRuntimeState *state = js_cosmo_state(ctx);
    if (!state) return NULL;
    JSValue snapshot = state->data;
    if (!JS_IsUndefined(state->apis)) {
        JSValue factory = JS_GetPropertyStr(ctx, state->apis, "_snapshot");
        if (JS_IsException(factory)) return NULL;
        snapshot = JS_Call(ctx, factory, JS_UNDEFINED, 0, NULL);
        JS_FreeValue(ctx, factory);
        if (JS_IsException(snapshot)) return NULL;
    } else snapshot = JS_DupValue(ctx, snapshot);
    uint8_t *encoded = JS_WriteObject(ctx, size, snapshot, JS_WRITE_OBJ_REFERENCE);
    JS_FreeValue(ctx, snapshot);
    if (!encoded) return NULL;
    uint8_t *copy = malloc(*size);
    if (!copy) JS_ThrowOutOfMemory(ctx);
    else memcpy(copy, encoded, *size);
    js_free(ctx, encoded);
    return copy;
}

int js_cosmo_set_cli(JSContext *ctx, int argc, char **argv, int first, int mode) {
    CosmoRuntimeState *state = js_cosmo_state(ctx);
    if (!state) return -1;
    state->mode = mode == 5 ? 3 : mode;
    JSValue args = JS_NewArray(ctx), options = JS_NewArray(ctx);
    JSValue raw = IsWindows() ? js_cosmo_windows_arguments(ctx) : JS_UNDEFINED;
    if (JS_IsException(args) || JS_IsException(options) || JS_IsException(raw)) goto fail;
    int raw_count = argc;
    if (IsWindows()) {
        JSValue length = JS_GetPropertyStr(ctx, raw, "length");
        int rc = JS_ToInt32(ctx, &raw_count, length);
        JS_FreeValue(ctx, length);
        if (rc < 0) goto fail;
    }
    JSValue exe = JS_GetPropertyStr(ctx, state->data, "execPath");
    if (JS_IsException(exe) || JS_SetPropertyUint32(ctx, args, 0, exe) < 0) goto fail;
    unsigned index = 1;
    if (mode == 2) {
        exe = JS_GetPropertyStr(ctx, state->data, "execPath");
        if (JS_IsException(exe) || JS_SetPropertyUint32(ctx, args, index++, exe) < 0) goto fail;
        first = 1;
    } else if ((mode == 0 || mode == 4 || mode == 5) && first < argc) {
        char *entry = js_cosmo_absolute_filename(ctx, argv[first++]);
        if (!entry) goto fail;
        host_separators(entry);
        JSValue path = JS_NewString(ctx, entry);
        js_free(ctx, entry);
        if (JS_IsException(path) || JS_SetPropertyUint32(ctx, args, index++, path) < 0) goto fail;
    }
    for (int i = first; i < raw_count; i++) {
        JSValue arg = IsWindows() ? JS_GetPropertyUint32(ctx, raw, i) : JS_NewString(ctx, argv[i]);
        if ((mode == 4 || mode == 5) && i == first) {
            const char *text = JS_ToCString(ctx, arg);
            if (!text) { JS_FreeValue(ctx,arg); goto fail; }
            int separator = !strcmp(text,"--"); JS_FreeCString(ctx,text);
            if (separator) { JS_FreeValue(ctx,arg); continue; }
        }
        if (JS_IsException(arg) || JS_SetPropertyUint32(ctx, args, index++, arg) < 0) goto fail;
    }
    if (mode != 2) for (int i = 1; i < (mode == 0 || mode == 4 || mode == 5 ? first - 1 : first); i++) {
        JSValue arg = IsWindows() ? JS_GetPropertyUint32(ctx, raw, i) : JS_NewString(ctx, argv[i]);
        if (JS_IsException(arg) || JS_SetPropertyUint32(ctx, options, i - 1, arg) < 0) goto fail;
    }
    int result = JS_SetPropertyStr(ctx, state->data, "argv", args);
    args = JS_UNDEFINED;
    if (result < 0) goto fail;
    if (mode == 4 || mode == 5) {
        JSValue process_args=JS_GetPropertyStr(ctx,state->data,"argv"),script_args=JS_NewArray(ctx);
        if(JS_IsException(process_args)||JS_IsException(script_args)) {JS_FreeValue(ctx,process_args);JS_FreeValue(ctx,script_args);goto fail;}
        for(unsigned i=1;i<index;i++) {
            JSValue arg=JS_GetPropertyUint32(ctx,process_args,i);
            if(JS_IsException(arg)||JS_SetPropertyUint32(ctx,script_args,i-1,arg)<0) {JS_FreeValue(ctx,process_args);JS_FreeValue(ctx,script_args);goto fail;}
        }
        JS_FreeValue(ctx,process_args);
        JSValue global=JS_GetGlobalObject(ctx);
        int rc=JS_SetPropertyStr(ctx,global,"scriptArgs",script_args);JS_FreeValue(ctx,global);
        if(rc<0)goto fail;
    }
    result = JS_SetPropertyStr(ctx, state->data, "execArgv", options);
    options = JS_UNDEFINED;
    JS_FreeValue(ctx, raw);
    return result;
fail:
    JS_FreeValue(ctx, args); JS_FreeValue(ctx, options); JS_FreeValue(ctx, raw); return -1;
}

int js_cosmo_set_compiled_root(JSContext *ctx, const char *root) {
    CosmoRuntimeState *state = js_cosmo_state(ctx);
    if (!state) return -1;
    char *path = js_cosmo_absolute_filename(ctx, root);
    if (!path) return -1;
    js_free(ctx, state->compiled_root); state->compiled_root = path; state->mode = 2;
    return 0;
}

int js_cosmo_exit_code(JSContext *ctx) {
    CosmoRuntimeState *state = js_cosmo_state(ctx);
    int32_t status = 0;
    if (!state || state->worker) return 0;
    JSValue value = JS_GetPropertyStr(ctx, state->data, "exitCode");
    if (!JS_IsUndefined(value)) JS_ToInt32(ctx, &status, value);
    JS_FreeValue(ctx, value);
    return status;
}

int js_cosmo_install_helpers(JSContext *ctx) {
    CosmoRuntimeState *state;
    int found = js_cosmo_lookup_state(ctx, &state);
    if (found <= 0) return found;
    if (JS_IsUndefined(state->apis)) return 0;
    JSValue console = JS_GetPropertyStr(ctx, state->apis, "_console");
    if (JS_IsException(console)) return -1;
    JSValue global = JS_GetGlobalObject(ctx);
    int result = JS_SetPropertyStr(ctx, global, "console", console);
    JS_FreeValue(ctx, global);
    return result < 0 ? -1 : 0;
}

int js_cosmo_import_meta(JSContext *ctx, JSValueConst value, int use_realpath, int main) {
    CosmoRuntimeState *state;
    int found = js_cosmo_lookup_state(ctx, &state);
    if (found < 0) return -1;
    if (!found || JS_IsUndefined(state->apis)) return 1;
    JSModuleDef *module = JS_VALUE_GET_PTR(value);
    JSAtom atom = JS_GetModuleName(ctx, module);
    const char *filename = JS_AtomToCString(ctx, atom);
    JS_FreeAtom(ctx, atom);
    if (!filename) return -1;
    if (state->worker_entry && !strcmp(filename, state->worker_entry)) main = 1;
    if (!strncmp(filename,"qjb://",6)) {
        JSValue meta=JS_GetImportMeta(ctx,module);
        int rc=JS_IsException(meta)?-1:JS_DefinePropertyValueStr(ctx,meta,"url",JS_NewString(ctx,filename),JS_PROP_C_W_E);
        if(rc>=0)rc=JS_DefinePropertyValueStr(ctx,meta,"main",JS_NewBool(ctx,main),JS_PROP_C_W_E);
        JS_FreeValue(ctx,meta);JS_FreeCString(ctx,filename);return rc<0?-1:0;
    }
    char *path;
    int internal = filename[0] == '<' && strcmp(filename, "<cmdline>");
    if (internal) main = 0;
    if (!internal && state->mode != 2 && !(state->mode == 1 && main) && use_realpath) {
        char buffer[PATH_MAX];
        path = js_cosmo_host_realpath(filename, buffer) ? path_padding(ctx, js_strdup(ctx, buffer)) : NULL;
        if (!path) system_error(ctx, errno, "realpath", filename);
    } else path = internal ? js_strdup(ctx, filename) : js_cosmo_absolute_filename(ctx, filename);
    JS_FreeCString(ctx, filename);
    if (!path) return -1;
    if (state->mode != 2) host_separators(path);
    JSValue factory = JS_GetPropertyStr(ctx, state->apis, "_importMeta");
    if (JS_IsException(factory)) { js_free(ctx, path); return -1; }
    JSValue args[] = {JS_NewString(ctx, path), JS_NewBool(ctx, main), JS_NewInt32(ctx, state->mode),
                      state->compiled_root ? JS_NewString(ctx, state->compiled_root) : JS_UNDEFINED};
    js_free(ctx, path);
    int failed = JS_IsException(args[0]) || JS_IsException(args[3]);
    JSValue fields = failed ? JS_EXCEPTION : JS_Call(ctx, factory, JS_UNDEFINED, 4, args);
    JS_FreeValue(ctx, factory);
    for (int i = 0; i < 4; i++) JS_FreeValue(ctx, args[i]);
    if (JS_IsException(fields)) return -1;
    JSValue meta = JS_GetImportMeta(ctx, module);
    if (JS_IsException(meta)) { JS_FreeValue(ctx, fields); return -1; }
    int result = 0;
    const char *keys[] = {"url", "filename", "dirname"};
    for (unsigned i = 0; i < sizeof(keys) / sizeof(*keys) && result >= 0; i++) {
        JSValue field = JS_GetPropertyStr(ctx, fields, keys[i]);
        if (JS_IsException(field)) result = -1;
        else if (!JS_IsUndefined(field)) result = JS_DefinePropertyValueStr(ctx, meta, keys[i], field, JS_PROP_C_W_E);
        else JS_FreeValue(ctx, field);
    }
    JS_FreeValue(ctx, fields);
    if (result >= 0) result = JS_DefinePropertyValueStr(ctx, meta, "main", JS_NewBool(ctx, main), JS_PROP_C_W_E);
    JS_FreeValue(ctx, meta);
    return result < 0 ? -1 : 0;
}

static int scheduler_hook(JSContext *ctx, const char *name) {
    CosmoRuntimeState *state;
    int found = js_cosmo_lookup_state(ctx, &state);
    if (found <= 0) return found;
    if (JS_IsUndefined(state->apis)) return 0;
    JSValue function = JS_GetPropertyStr(ctx, state->apis, name);
    if (JS_IsException(function)) return -1;
    if (JS_IsUndefined(function)) { JS_FreeValue(ctx, function); return 0; }
    JSValue value = JS_Call(ctx, function, JS_UNDEFINED, 0, NULL);
    JS_FreeValue(ctx, function);
    if (JS_IsException(value)) { js_std_dump_error(ctx); scheduler_failure(ctx); return -1; }
    int32_t count = 0;
    int result = JS_IsUndefined(value) ? 0 : JS_ToInt32(ctx, &count, value);
    JS_FreeValue(ctx, value);
    return result < 0 ? -1 : count;
}

int js_cosmo_scheduler_stopped(JSContext *ctx) {
    CosmoRuntimeState *state;
    int found = js_cosmo_lookup_state(ctx, &state);
    return found < 0 || (found && (state->scheduler_failed || state->scheduler_finished));
}

/* A native callback drains nextTick before ECMAScript jobs. ESM entry uses
   jobs first. Ticks created by a job run after that entire microtask drain. */
int js_cosmo_checkpoint(JSContext *ctx, int ticks_first) {
    if (js_cosmo_scheduler_stopped(ctx)) return -1;
    if (ticks_first && scheduler_hook(ctx, "_drainTicks") < 0) return -1;
    for (;;) {
        int result;
        JSContext *job_context = ctx;
        while ((result = JS_ExecutePendingJob(JS_GetRuntime(ctx), &job_context)) > 0) {
            if (js_cosmo_scheduler_stopped(ctx)) return -1;
        }
        if (result < 0) {
            js_std_dump_error(job_context ? job_context : ctx);
            scheduler_failure(ctx); return -1;
        }
        int count = scheduler_hook(ctx, "_drainTicks");
        if (count < 0 || js_cosmo_scheduler_stopped(ctx)) return -1;
        if (!count && !JS_IsJobPending(JS_GetRuntime(ctx))) return 0;
    }
}

int js_cosmo_before_exit(JSContext *ctx) {
    if (js_cosmo_scheduler_stopped(ctx)) return -1;
    CosmoRuntimeState *state;
    if (js_cosmo_lookup_state(ctx, &state) > 0 && state->mode == 3 && !state->worker)
        return js_cosmo_checkpoint(ctx, 1); /* The SDK host owns its lifetime. */
    if (scheduler_hook(ctx, "_beforeExit") < 0) return -1;
    int result = js_cosmo_checkpoint(ctx, 1);
    if (!result) js_cosmo_check_rejections(ctx);
    return result < 0 || js_cosmo_scheduler_stopped(ctx) ? -1 : 0;
}

void js_cosmo_finish_loop(JSContext *ctx, int unsettled) {
    CosmoRuntimeState *state;
    if (js_cosmo_lookup_state(ctx, &state) <= 0 || state->scheduler_finished) return;
    if (!unsettled && state->mode == 3 && !state->worker) return;
    if (unsettled < 0) scheduler_failure(ctx);
    if (unsettled > 0 && !state->worker) {
        JSValue code = JS_GetPropertyStr(ctx, state->data, "exitCode");
        if (JS_IsUndefined(code)) JS_SetPropertyStr(ctx, state->data, "exitCode", JS_NewInt32(ctx, 13));
        JS_FreeValue(ctx, code);
    }
    state->scheduler_finished = 1;
    scheduler_hook(ctx, "_exit");
}
