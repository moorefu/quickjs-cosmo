#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <cosmo.h>
#include "windows_host.h"
#include "../module_registry.h"

#ifdef __x86_64__
#include "libc/calls/syscall-nt.internal.h"
#include "libc/calls/syscall_support-nt.internal.h"
#include "libc/nt/dll.h"
#include "libc/nt/errors.h"
#include "libc/nt/process.h"
#include "libc/nt/runtime.h"

/* Same fixed Nightly conversion used when its PE entry prepares environ. */
extern int GetDosEnviron(const char16_t *, char *, size_t, char **, size_t);

static JSValue windows_failure(JSContext *ctx, const char *syscall) {
    JSValue error = JS_NewError(ctx);
    if (JS_IsException(error)) return error;
    JSValue code = JS_NewString(ctx, "ERR_SYSTEM_ERROR");
    if (JS_IsException(code) || JS_SetPropertyStr(ctx, error, "code", code) < 0) goto fail;
    JSValue call = JS_NewString(ctx, syscall);
    if (JS_IsException(call) || JS_SetPropertyStr(ctx, error, "syscall", call) < 0) goto fail;
    return JS_Throw(ctx, error);
fail:
    JS_FreeValue(ctx, error); return JS_EXCEPTION;
}

/* JSON escapes preserve every UTF-16 code unit, including isolated surrogates. */
static JSValue from_utf16(JSContext *ctx, const char16_t *input, size_t length) {
    if (length > (SIZE_MAX - 3) / 6) return JS_ThrowOutOfMemory(ctx);
    char *json = js_malloc(ctx, length * 6 + 3);
    if (!json) return JS_EXCEPTION;
    static const char hex[] = "0123456789abcdef";
    char *p = json; *p++ = '"';
    for (size_t i = 0; i < length; i++) {
        uint16_t unit = input[i];
        *p++ = '\\'; *p++ = 'u';
        *p++ = hex[unit >> 12]; *p++ = hex[(unit >> 8) & 15];
        *p++ = hex[(unit >> 4) & 15]; *p++ = hex[unit & 15];
    }
    *p++ = '"'; *p = 0;
    JSValue value = JS_ParseJSON(ctx, json, p - json, "<native:UTF16>");
    js_free(ctx, json);
    return value;
}

static char16_t *to_utf16(JSContext *ctx, JSValueConst value, size_t *length) {
    size_t size;
    const char *text = JS_ToCStringLen2(ctx, &size, value, 1);
    if (!text) return NULL;
    if (size > SIZE_MAX / sizeof(char16_t) - 1) {
        JS_FreeCString(ctx, text); JS_ThrowOutOfMemory(ctx); return NULL;
    }
    char16_t *output = js_malloc(ctx, (size + 1) * sizeof(char16_t));
    if (!output) { JS_FreeCString(ctx, text); return NULL; }
    size_t used = 0;
    /* Input is QuickJS-generated CESU-8, never arbitrary external UTF-8. */
    for (size_t i = 0; i < size;) {
        uint32_t code = (uint8_t)text[i++];
        if (code >= 0xe0) {
            code = (code & 15) << 12;
            code |= ((uint8_t)text[i++] & 63) << 6;
            code |= (uint8_t)text[i++] & 63;
        } else if (code >= 0xc0) {
            code = ((code & 31) << 6) | ((uint8_t)text[i++] & 63);
        }
        output[used++] = code;
    }
    output[used] = 0;
    JS_FreeCString(ctx, text);
    *length = used;
    return output;
}

JSValue js_cosmo_windows_environment(JSContext *ctx) {
    char16_t *block = GetEnvironmentStrings();
    if (!block) return windows_failure(ctx, "GetEnvironmentStringsW");
    JSValue object = JS_NewObjectProto(ctx, JS_NULL);
    if (JS_IsException(object)) { FreeEnvironmentStrings(block); return object; }
    for (const char16_t *entry = block; *entry;) {
        size_t length = 0, equals = *entry == '=' ? 1 : 0;
        while (entry[length]) length++;
        while (equals < length && entry[equals] != '=') equals++;
        if (equals < length) {
            JSValue name = from_utf16(ctx, entry, equals);
            if (JS_IsException(name)) goto fail;
            JSAtom key = JS_ValueToAtom(ctx, name);
            JS_FreeValue(ctx, name);
            if (!key) goto fail;
            JSValue value = from_utf16(ctx, entry + equals + 1, length - equals - 1);
            int result = JS_IsException(value) ? -1 : JS_SetProperty(ctx, object, key, value);
            JS_FreeAtom(ctx, key);
            if (result < 0) goto fail;
        }
        entry += length + 1;
    }
    FreeEnvironmentStrings(block);
    return object;
fail:
    FreeEnvironmentStrings(block); JS_FreeValue(ctx, object); return JS_EXCEPTION;
}

JSValue js_cosmo_windows_getenv(JSContext *ctx, JSValueConst name) {
    size_t size;
    char16_t *key = to_utf16(ctx, name, &size);
    if (!key) return JS_EXCEPTION;
    SetLastError(0);
    uint32_t count = GetEnvironmentVariable(key, NULL, 0);
    if (!count) {
        JSValue result = GetLastError() == kNtErrorEnvvarNotFound ? JS_UNDEFINED : JS_NewString(ctx, "");
        js_free(ctx, key); return result;
    }
    for (int retry = 0; retry < 3; retry++) {
        char16_t *value = js_malloc(ctx, (size_t)count * sizeof(char16_t));
        if (!value) { js_free(ctx, key); return JS_EXCEPTION; }
        SetLastError(0);
        uint32_t written = GetEnvironmentVariable(key, value, count);
        if (written < count) {
            JSValue result = !written && GetLastError() == kNtErrorEnvvarNotFound ? JS_UNDEFINED : from_utf16(ctx, value, written);
            js_free(ctx, value); js_free(ctx, key); return result;
        }
        js_free(ctx, value); count = written;
    }
    js_free(ctx, key);
    return windows_failure(ctx, "GetEnvironmentVariableW");
}

JSValue js_cosmo_windows_setenv(JSContext *ctx, JSValueConst name, JSValueConst value, int remove) {
    size_t key_size, value_size = 0;
    char16_t *key = to_utf16(ctx, name, &key_size), *text = NULL;
    if (!key) return JS_EXCEPTION;
    if (!remove && !(text = to_utf16(ctx, value, &value_size))) { js_free(ctx, key); return JS_EXCEPTION; }
    size_t units = key_size + value_size + 3;
    char16_t *block = js_mallocz(ctx, units * sizeof(char16_t));
    char *converted = js_malloc(ctx, units * 4 + 1), *equals = NULL;
    if (!block || !converted) {
        js_free(ctx, block); js_free(ctx, converted); js_free(ctx, key); js_free(ctx, text);
        return JS_EXCEPTION;
    }
    memcpy(block, key, key_size * sizeof(char16_t)); block[key_size] = '=';
    if (text) memcpy(block + key_size + 1, text, value_size * sizeof(char16_t));
    char *entries[2];
    if (GetDosEnviron(block, converted, units * 4 + 1, entries, 2) == 1) equals = strchr(converted, '=');
    if (equals) *equals = 0;
    js_cosmo_env_lock();
    int result = SetEnvironmentVariable(key, text) != 0;
    if ((result || remove) && equals) {
        if (remove) unsetenv(converted); else setenv(converted, equals + 1, 1);
    }
    js_cosmo_env_unlock();
    js_free(ctx, block); js_free(ctx, converted);
    js_free(ctx, key); js_free(ctx, text);
    return JS_NewBool(ctx, result);
}

JSValue js_cosmo_windows_release(JSContext *ctx) {
    /* Documented RTL_OSVERSIONINFOW layout; do not use manifest-sensitive GetVersionEx. */
    struct Version { uint32_t size, major, minor, build, platform; char16_t service_pack[128]; } version = {0};
    _Static_assert(sizeof(struct Version) == 276, "Windows version structure ABI");
    typedef int32_t(__msabi *GetVersionFn)(struct Version *);
    int64_t module = GetModuleHandleW(u"ntdll.dll");
    GetVersionFn get_version = module ? (GetVersionFn)GetProcAddress(module, "RtlGetVersion") : NULL;
    version.size = sizeof(version);
    if (!get_version || get_version(&version) < 0) return windows_failure(ctx, "RtlGetVersion");
    char result[64];
    snprintf(result, sizeof(result), "%u.%u.%u", version.major, version.minor, version.build);
    return JS_NewString(ctx, result);
}

uint32_t js_cosmo_windows_pid(void) { return GetCurrentProcessId(); }
uint32_t js_cosmo_windows_ppid(void) { return sys_getppid_nt_win32(); }
char js_cosmo_windows_root_drive(void) { return __getcosmosdrive(); }
#else
JSValue js_cosmo_windows_environment(JSContext *ctx) { (void)ctx; return JS_UNDEFINED; }
JSValue js_cosmo_windows_getenv(JSContext *ctx, JSValueConst key) { (void)ctx; (void)key; return JS_UNDEFINED; }
JSValue js_cosmo_windows_setenv(JSContext *ctx, JSValueConst key, JSValueConst value, int remove) {
    (void)ctx; (void)key; (void)value; (void)remove; return JS_UNDEFINED;
}
JSValue js_cosmo_windows_release(JSContext *ctx) { (void)ctx; return JS_UNDEFINED; }
uint32_t js_cosmo_windows_pid(void) { return 0; }
uint32_t js_cosmo_windows_ppid(void) { return 0; }
char js_cosmo_windows_root_drive(void) { return 0; }
#endif
