#ifndef QUICKJS_COSMO_RESOURCES_H
#define QUICKJS_COSMO_RESOURCES_H
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define COSMO_RESOURCE_CORE ".quickjs-cosmo/runtime-core.js"
#define COSMO_RESOURCE_CA ".quickjs-cosmo/ca-bundle.pem"
#define COSMO_RESOURCE_CAPABILITIES ".quickjs-cosmo/capabilities.json"
#define COSMO_RESOURCE_MANIFEST ".quickjs-cosmo/resource-manifest.json"

typedef struct {
    const unsigned char *data;
    size_t size;
    const char *name;
} CosmoResourceView;

enum {
    COSMO_RESOURCE_OK = 0,
    COSMO_RESOURCE_NAME = -1,
    COSMO_RESOURCE_UNAVAILABLE = -2,
    COSMO_RESOURCE_MISSING = -3,
    COSMO_RESOURCE_FORMAT = -4,
    COSMO_RESOURCE_INTEGRITY = -5,
    COSMO_RESOURCE_TOO_LARGE = -6,
    COSMO_RESOURCE_IO = -7,
    COSMO_RESOURCE_MEMORY = -8
};

/* Fixed names only. Views borrow immutable, NUL-terminated process storage.
   close clears the view; it never frees shared bytes. Errors are cached too.
   No filesystem/provider override is supported, including non-APE builds. */
int js_cosmo_resource_open(const char *name, CosmoResourceView *view);
void js_cosmo_resource_close(CosmoResourceView *view);
const char *js_cosmo_resource_error(int result);
const char *js_cosmo_default_ca(void);
const char *js_cosmo_release_architecture(void);

#ifdef __cplusplus
}
#endif
#endif
