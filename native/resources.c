#include <fcntl.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "libc/runtime/zipos.internal.h"
#include "libc/zip.h"
#include "resources.h"

__static_yoink(COSMO_RESOURCE_CORE);
__static_yoink(COSMO_RESOURCE_CA);
__static_yoink(COSMO_RESOURCE_CAPABILITIES);
__static_yoink(COSMO_RESOURCE_MANIFEST);

typedef struct {
    const char *name;
    size_t size, limit;
    const char *sha256;
} ResourceSpec;
#include "qjs-resource-config.h"

extern int js_cosmo_resource_sha256(const unsigned char *, size_t, unsigned char[32]);
static pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
static struct { unsigned char *data; size_t size; int result, loaded; } cache[4];

const char *js_cosmo_resource_error(int result) {
    switch (result) {
    case COSMO_RESOURCE_OK: return "OK";
    case COSMO_RESOURCE_NAME: return "ERR_RESOURCE_NAME";
    case COSMO_RESOURCE_UNAVAILABLE: return "ERR_RESOURCE_UNAVAILABLE";
    case COSMO_RESOURCE_MISSING: return "ERR_RESOURCE_MISSING";
    case COSMO_RESOURCE_FORMAT: return "ERR_RESOURCE_FORMAT";
    case COSMO_RESOURCE_INTEGRITY: return "ERR_RESOURCE_INTEGRITY";
    case COSMO_RESOURCE_TOO_LARGE: return "ERR_RESOURCE_TOO_LARGE";
    case COSMO_RESOURCE_MEMORY: return "ERR_RESOURCE_MEMORY";
    default: return "ERR_RESOURCE_IO";
    }
}

static int available(void) {
    /* zipos itself supports an external filename/fd override. Runtime resources
       never opt into it, even if another library has already initialized ZIP. */
    return !getenv("COSMOPOLITAN_INIT_ZIPOS") && !getenv("COSMOPOLITAN_DISABLE_ZIPOS") && __zipos_get();
}

static int read_zip(const char *name, size_t limit, unsigned char **bytes, size_t *size) {
    struct Zipos *zip = __zipos_get();
    if (!zip) return COSMO_RESOURCE_UNAVAILABLE;
    size_t count = 0;
    for (size_t i = 0; i < zip->records; i++) {
        const unsigned char *entry = zip->map + zip->index[i];
        if (ZIP_CFILE_NAMESIZE(entry) == strlen(name) && !memcmp(ZIP_CFILE_NAME(entry), name, strlen(name))) {
            count++;
            if (ZIP_CFILE_UNCOMPRESSEDSIZE(entry) > limit) return COSMO_RESOURCE_TOO_LARGE;
            /* zipos allocates from the LOCAL size, not the central directory.
               Admit only bounded, matching headers before asking it to inflate. */
            size_t offset = ZIP_CFILE_OFFSET(entry), end = GetZipCdirOffset(zip->cdir);
            if (offset > end || end - offset < kZipLfileHdrMinSize) return COSMO_RESOURCE_FORMAT;
            const unsigned char *local = zip->map + offset;
            size_t header = ZIP_LFILE_HDRSIZE(local), packed = ZIP_LFILE_COMPRESSEDSIZE(local);
            if (ZIP_LFILE_UNCOMPRESSEDSIZE(local) > limit) return COSMO_RESOURCE_TOO_LARGE;
            unsigned method = ZIP_LFILE_COMPRESSIONMETHOD(local), flags = ZIP_LFILE_GENERALFLAG(local);
            if (ZIP_LFILE_MAGIC(local) != kZipLfileHdrMagic || header > end - offset || packed > end - offset - header ||
                ZIP_LFILE_UNCOMPRESSEDSIZE(local) != ZIP_CFILE_UNCOMPRESSEDSIZE(entry) ||
                packed != ZIP_CFILE_COMPRESSEDSIZE(entry) || ZIP_LFILE_CRC32(local) != ZIP_CFILE_CRC32(entry) ||
                (method != kZipCompressionNone && method != kZipCompressionDeflate) ||
                method != ZIP_CFILE_COMPRESSIONMETHOD(entry) || flags != ZIP_CFILE_GENERALFLAG(entry) ||
                (flags & ~kZipGflagUtf8) || ZIP_LFILE_NAMESIZE(local) != strlen(name) ||
                memcmp(ZIP_LFILE_NAME(local), name, strlen(name))) return COSMO_RESOURCE_FORMAT;
        }
    }
    if (!count) return COSMO_RESOURCE_MISSING;
    if (count != 1) return COSMO_RESOURCE_FORMAT;
    struct ZiposUri uri = {.len = strlen(name)};
    memcpy(uri.path, name, uri.len + 1);
    int fd = __zipos_open(&uri, O_RDONLY);
    if (fd < 0) return COSMO_RESOURCE_IO;
    struct stat st;
    int result = COSMO_RESOURCE_IO;
    if (fstat(fd, &st)) goto done;
    if (st.st_size < 1) { result = COSMO_RESOURCE_FORMAT; goto done; }
    if ((uint64_t)st.st_size > limit) { result = COSMO_RESOURCE_TOO_LARGE; goto done; }
    unsigned char *copy = malloc((size_t)st.st_size + 1);
    if (!copy) { result = COSMO_RESOURCE_MEMORY; goto done; }
    size_t total = 0;
    while (total < (size_t)st.st_size) {
        ssize_t n = read(fd, copy + total, st.st_size - total);
        if (n <= 0) { free(copy); goto done; }
        total += n;
    }
    copy[total] = 0;
    if (memchr(copy, 0, total)) { free(copy); result = COSMO_RESOURCE_FORMAT; goto done; }
    *bytes = copy; *size = total; result = 0;
done:
    close(fd);
    return result;
}

static int check_digest(const unsigned char *bytes, size_t size, const char *expected) {
    unsigned char hash[32]; char hex[65];
    if (js_cosmo_resource_sha256(bytes, size, hash)) return COSMO_RESOURCE_IO;
    for (int i = 0; i < 32; i++) snprintf(hex + 2 * i, 3, "%02x", hash[i]);
    return strcmp(hex, expected) ? COSMO_RESOURCE_INTEGRITY : 0;
}

static int token(const char **cursor, const char *literal) {
    size_t size = strlen(literal);
    if (strncmp(*cursor, literal, size)) return 0;
    *cursor += size; return 1;
}

/* Only the generated canonical schema is admitted. Bounds and fixed names
   precede the anchored digest, so malformed and substituted manifests differ. */
static int manifest_format(const char *text) {
    const char *p = text;
    if (!token(&p, "{\"format\":1,\"resources\":[")) return COSMO_RESOURCE_FORMAT;
    for (size_t i = 0; i < 3; i++) {
        if ((i && !token(&p, ",")) || !token(&p, "{\"name\":\"") ||
            !token(&p, specs[i].name) || !token(&p, "\",\"size\":")) return COSMO_RESOURCE_FORMAT;
        size_t size = 0;
        if (*p < '1' || *p > '9') return COSMO_RESOURCE_FORMAT;
        while (*p >= '0' && *p <= '9') {
            unsigned digit = *p++ - '0';
            if (size > (specs[i].limit - digit) / 10) return COSMO_RESOURCE_TOO_LARGE;
            size = size * 10 + digit;
        }
        if (!token(&p, ",\"sha256\":\"")) return COSMO_RESOURCE_FORMAT;
        for (int j = 0; j < 64; j++, p++)
            if (!((*p >= '0' && *p <= '9') || (*p >= 'a' && *p <= 'f'))) return COSMO_RESOURCE_FORMAT;
        if (!token(&p, "\"}")) return COSMO_RESOURCE_FORMAT;
    }
    return token(&p, "]}\n") && !*p ? 0 : COSMO_RESOURCE_FORMAT;
}

static int load(size_t index) {
    if (cache[index].loaded) return cache[index].result;
    const ResourceSpec *spec = &specs[index];
    unsigned char *bytes = NULL; size_t size = 0;
    int rc = index == 3 ? 0 : load(3);
    if (!rc) rc = read_zip(spec->name, spec->limit, &bytes, &size);
    if (!rc && index == 3) rc = manifest_format((const char *)bytes);
    if (!rc && size != spec->size) rc = COSMO_RESOURCE_INTEGRITY;
    if (!rc) rc = check_digest(bytes, size, spec->sha256);
    if (rc) free(bytes);
    else { cache[index].data = bytes; cache[index].size = size; }
    cache[index].result = rc; cache[index].loaded = 1;
    return rc;
}

int js_cosmo_resource_open(const char *name, CosmoResourceView *view) {
    if (!view) return COSMO_RESOURCE_NAME;
    memset(view, 0, sizeof(*view));
    size_t index;
    for (index = 0; index < 4; index++) if (name && !strcmp(name, specs[index].name)) break;
    if (index == 4) return COSMO_RESOURCE_NAME;
    if (!available()) return COSMO_RESOURCE_UNAVAILABLE;
    pthread_mutex_lock(&mutex);
    int rc = load(index);
    if (!rc) *view = (CosmoResourceView){cache[index].data, cache[index].size, specs[index].name};
    pthread_mutex_unlock(&mutex);
    return rc;
}

void js_cosmo_resource_close(CosmoResourceView *view) {
    if (view) memset(view, 0, sizeof(*view));
}

const char *js_cosmo_default_ca(void) {
    CosmoResourceView view;
    return js_cosmo_resource_open(COSMO_RESOURCE_CA, &view) ? NULL : (const char *)view.data;
}

const char *js_cosmo_release_architecture(void) {
    if (!available()) return "invalid";
    unsigned char *bytes = NULL; size_t size = 0;
    int rc = read_zip(".quickjs-cosmo/architecture", 8, &bytes, &size);
    if (rc == COSMO_RESOURCE_MISSING) return "fat";
    const char *result = !rc && size == 3 && !memcmp(bytes, "x64", 3) ? "x64" :
        !rc && size == 5 && !memcmp(bytes, "arm64", 5) ? "arm64" : "invalid";
    free(bytes); return result;
}
