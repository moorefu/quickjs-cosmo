#include <assert.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "qjs-cosmo.h"
#include "../../native/tls/backend.h"

static const char *names[] = {COSMO_RESOURCE_CORE, COSMO_RESOURCE_CA,
                            COSMO_RESOURCE_CAPABILITIES, COSMO_RESOURCE_MANIFEST};
static const unsigned char *pointers[4][4];
static void *load_resources(void *opaque) {
    size_t thread = (size_t)opaque;
    for (size_t i = 0; i < 4; i++) {
        CosmoResourceView view;
        assert(!js_cosmo_resource_open(names[i], &view));
        assert(view.data && view.size && !view.data[view.size]);
        assert(!strcmp(view.name, names[i]));
        pointers[thread][i] = view.data;
        js_cosmo_resource_close(&view);
        assert(!view.data && !view.size && !view.name);
        js_cosmo_resource_close(&view);
    }
    return NULL;
}

int main(int argc, char **argv) {
    assert(argc == 4);
    if (strcmp(argv[1], "default")) {
        int expected = !strcmp(argv[1], "missing") ? COSMO_RESOURCE_MISSING :
            !strcmp(argv[1], "format") ? COSMO_RESOURCE_FORMAT :
            !strcmp(argv[1], "integrity") ? COSMO_RESOURCE_INTEGRITY :
            !strcmp(argv[1], "too-large") ? COSMO_RESOURCE_TOO_LARGE :
            !strcmp(argv[1], "io") ? COSMO_RESOURCE_IO :
            !strcmp(argv[1], "unavailable") ? COSMO_RESOURCE_UNAVAILABLE : COSMO_RESOURCE_NAME;
        for (int i = 0; i < 2; i++) {
            CosmoResourceView view = {(void *)1, 99, "invalid"};
            int rc = js_cosmo_resource_open(argv[2], &view);
            if (rc != expected) { fprintf(stderr, "expected %s, got %s for %s\n", js_cosmo_resource_error(expected), js_cosmo_resource_error(rc), argv[2]); return 1; }
            assert(!view.data && !view.size && !view.name);
        }
        printf("PASS resource %s\n", js_cosmo_resource_error(expected));
        return 0;
    }
    pthread_t threads[4];
    for (size_t i = 0; i < 4; i++) assert(!pthread_create(&threads[i], NULL, load_resources, (void *)i));
    for (int i = 0; i < 4; i++) assert(!pthread_join(threads[i], NULL));
    for (int i = 0; i < 4; i++) for (int j = 1; j < 4; j++) assert(pointers[0][i] == pointers[j][i]);
    CosmoResourceView view;
    const char *invalid[] = {"runtime-core.js", "/zip/" COSMO_RESOURCE_CORE,
        ".quickjs-cosmo/../runtime-core.js", "C:/ca-bundle.pem", NULL};
    for (size_t i = 0; i < 5; i++) assert(js_cosmo_resource_open(invalid[i], &view) == COSMO_RESOURCE_NAME);
    const char *ca = js_cosmo_default_ca();
    assert(ca && ca == (const char *)pointers[0][1]);
    FILE *file = fopen(argv[2], "rb"); assert(file);
    assert(!fseek(file, 0, SEEK_END)); long size = ftell(file); assert(size > 0);
    assert(!fseek(file, 0, SEEK_SET));
    unsigned char *pem = malloc(size); assert(pem);
    assert(fread(pem, 1, size, file) == size); fclose(file);
    assert(strlen(ca) == size && !memcmp(ca, pem, size)); free(pem);
    void *arena = malloc(8 * 1024 * 1024); assert(arena);
    assert(qjs_tls_backend_api()->validate_ca(arena, 8 * 1024 * 1024, (const unsigned char *)ca, size));
    free(arena);
    file = fopen(argv[3], "wb"); assert(file);
    assert(fwrite(ca, 1, size, file) == size); fclose(file);
    puts("PASS runtime resources: concurrent shared views, fixed names, lifetime and X.509 validation");
}
