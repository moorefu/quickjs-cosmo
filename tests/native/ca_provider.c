#include <assert.h>
#include <errno.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "qjs-cosmo.h"
#include "../../native/tls/backend.h"

static int calls, missing;
static unsigned char *pem;
static size_t length;
static void *load_ca(void *opaque) { return (void *)js_cosmo_default_ca(); }
static int provider(void *opaque, const unsigned char **bytes, size_t *size) {
    assert(opaque == &calls);
    calls++;
    *bytes = pem;
    *size = length;
    return missing;
}

int main(int argc, char **argv) {
    assert(argc == 4);
    int supplied = strcmp(argv[1], "default");
    FILE *file = fopen(argv[2], "rb"); assert(file);
    assert(!fseek(file, 0, SEEK_END)); long size = ftell(file); assert(size > 0);
    assert(!fseek(file, 0, SEEK_SET)); length = size;
    pem = malloc(length); assert(pem);
    assert(fread(pem, 1, length, file) == length); fclose(file);
    if (supplied) {
        missing = !strcmp(argv[1], "missing");
        if (!strcmp(argv[1], "nul")) pem[0] = 0;
        assert(!js_cosmo_set_ca_provider(provider, &calls));
    }
    pthread_t threads[4];void *results[4];
    for(int i=0;i<4;i++)assert(!pthread_create(&threads[i],NULL,load_ca,NULL));
    for(int i=0;i<4;i++)assert(!pthread_join(threads[i],&results[i]));
    const char *ca = js_cosmo_default_ca();
    for(int i=0;i<4;i++)assert(results[i]==ca);
    assert(js_cosmo_default_ca() == ca);
    assert(calls == (supplied ? 1 : 0));
    errno = 0;
    assert(js_cosmo_set_ca_provider(NULL, NULL) == -1 && errno == EBUSY);
    if (missing || !strcmp(argv[1], "nul")) assert(!ca);
    else {
        assert(ca && strlen(ca) > 100);
        assert(strlen(ca)==length && !memcmp(ca,pem,length));
        if (supplied) { assert(ca != (char *)pem); memset(pem, 0, length); }
        void *arena = malloc(8 * 1024 * 1024); assert(arena);
        assert(qjs_tls_backend_api()->validate_ca(arena, 8 * 1024 * 1024, (const unsigned char *)ca, strlen(ca)));
        free(arena);
        FILE *file = fopen(argv[3], "wb"); assert(file);
        assert(fwrite(ca, 1, strlen(ca), file) == strlen(ca)); fclose(file);
    }
    free(pem);
    puts("PASS CA provider: default resource, ownership, validation and immutable configuration");
}
