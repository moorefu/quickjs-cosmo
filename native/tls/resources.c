#include <errno.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../module_registry.h"

/* Pull the ZIP member out of libquickjs.a for SDK and qjsc applications too. */
__static_yoink(".quickjs-cosmo/ca-bundle.pem");

static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_once_t once = PTHREAD_ONCE_INIT;
static QJSCosmoCAProvider provider;
static void *provider_opaque;
static int started;
static char *bundle;

int js_cosmo_set_ca_provider(QJSCosmoCAProvider callback, void *opaque) {
    pthread_mutex_lock(&mutex);
    if (started) {
        pthread_mutex_unlock(&mutex);
        errno = EBUSY;
        return -1;
    }
    provider = callback;
    provider_opaque = opaque;
    pthread_mutex_unlock(&mutex);
    return 0;
}

static void load_bundle(void) {
    const unsigned char *bytes = NULL;
    size_t length = 0;
    pthread_mutex_lock(&mutex);
    started = 1;
    QJSCosmoCAProvider callback = provider;
    void *opaque = provider_opaque;
    pthread_mutex_unlock(&mutex);
    if (callback) {
        if (callback(opaque, &bytes, &length) || !bytes || !length ||
            length > 4 * 1024 * 1024 || memchr(bytes, 0, length)) return;
        bundle = malloc(length + 1);
        if (bundle) { memcpy(bundle, bytes, length); bundle[length] = 0; }
        return;
    }
    FILE *file = fopen("/zip/.quickjs-cosmo/ca-bundle.pem", "rb");
    if (!file) return;
    if (!fseek(file, 0, SEEK_END)) {
        long size = ftell(file);
        if (size > 0 && size <= 4 * 1024 * 1024 && !fseek(file, 0, SEEK_SET)) {
            char *copy = malloc((size_t)size + 1);
            if (copy) {
                if (fread(copy, 1, size, file) == (size_t)size && !memchr(copy, 0, size)) {
                    copy[size] = 0;
                    bundle = copy;
                } else free(copy);
            }
        }
    }
    fclose(file);
}

const char *js_cosmo_default_ca(void) {
    pthread_once(&once, load_bundle);
    return bundle;
}

const char *js_cosmo_release_architecture(void) {
    /* Single-architecture packaging adds this member before signing/hashing.
       Fat applications and ordinary SDK links need no extra resource. */
    char value[8] = {0};
    FILE *file = fopen("/zip/.quickjs-cosmo/architecture", "rb");
    if (!file) return "fat";
    size_t size = fread(value, 1, sizeof(value), file);
    int error = ferror(file);
    fclose(file);
    if (!error && size == 3 && !memcmp(value, "x64", 3)) return "x64";
    if (!error && size == 5 && !memcmp(value, "arm64", 5)) return "arm64";
    return "invalid";
}
