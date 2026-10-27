/* E1/E2 only. Candidate archives are not registered as JavaScript modules. */
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "libc/str/blake2.h"
#include "libc/nexgen32e/crc32.h"
#include "third_party/mbedtls/md.h"
#include "third_party/mbedtls/md5.h"
#include "third_party/mbedtls/sha1.h"
#include "third_party/mbedtls/sha256.h"
#include "third_party/mbedtls/sha512.h"
#include "third_party/mbedtls/hkdf.h"
#include "third_party/mbedtls/pkcs5.h"
#include "third_party/mbedtls/version.h"
#include "third_party/haclstar/haclstar.h"
#include "third_party/zstd/zstd.h"
#include "third_party/lz4cli/lz4.h"
#include "third_party/lz4cli/lz4frame.h"
#include "third_party/bzip2/bzlib.h"
#include "third_party/zlib/zlib.h"

#define CHECK(value) do { if (!(value)) { fprintf(stderr, "backend-probe:%d: %s (errno=%d)\n", __LINE__, #value, errno); return 1; } } while (0)
#define TRACE(stage) do { fputs("NATIVE_STAGE " stage "\n", stderr); fflush(stderr); } while (0)

static void hex(const unsigned char *bytes, size_t length) {
    for (size_t i = 0; i < length; i++) printf("%02x", bytes[i]);
}

int main(void) {
    unsigned char sample[8193], compressed[32768], restored[16418], digest[64], duplicate[64];
    unsigned char key[32], hmac[32], hkdf[42], pbkdf[32];
    for (size_t i = 0; i < sizeof(sample); i++) sample[i] = (i * 131 + 7) & 255;
    for (size_t i = 0; i < sizeof(key); i++) key[i] = i;
    TRACE("self-md5"); CHECK(mbedtls_md5_self_test(0) == 0);
    TRACE("self-sha1"); CHECK(mbedtls_sha1_self_test(0) == 0);
    TRACE("self-sha256"); CHECK(mbedtls_sha256_self_test(0) == 0);
    TRACE("self-sha512"); CHECK(mbedtls_sha512_self_test(0) == 0);
    TRACE("self-pbkdf2"); CHECK(mbedtls_pkcs5_self_test(0) == 0);

    TRACE("hash-stream-copy");
    const mbedtls_md_type_t types[] = {MBEDTLS_MD_MD5, MBEDTLS_MD_SHA1, MBEDTLS_MD_SHA224,
        MBEDTLS_MD_SHA256, MBEDTLS_MD_SHA384, MBEDTLS_MD_SHA512};
    const char *names[] = {"md5", "sha1", "sha224", "sha256", "sha384", "sha512"};
    unsigned char hashes[6][64];
    for (size_t i = 0; i < sizeof(types) / sizeof(*types); i++) {
        const mbedtls_md_info_t *info = mbedtls_md_info_from_type(types[i]);
        CHECK(info);
        CHECK(mbedtls_md(info, sample, sizeof(sample), hashes[i]) == 0);
        mbedtls_md_context_t state, copy;
        mbedtls_md_init(&state); mbedtls_md_init(&copy);
        CHECK(mbedtls_md_setup(&state, info, 0) == 0 && mbedtls_md_setup(&copy, info, 0) == 0);
        CHECK(mbedtls_md_starts(&state) == 0);
        const size_t chunks[] = {1, 55, 56, 63, 64, 65, 1024};
        size_t offset = 0, chunk = 0;
        while (offset < sizeof(sample) / 2) {
            size_t size = chunks[chunk++ % 7];
            if (size > sizeof(sample) / 2 - offset) size = sizeof(sample) / 2 - offset;
            CHECK(mbedtls_md_update(&state, sample + offset, size) == 0); offset += size;
        }
        CHECK(mbedtls_md_clone(&copy, &state) == 0);
        CHECK(mbedtls_md_update(&state, sample + offset, sizeof(sample) - offset) == 0);
        CHECK(mbedtls_md_update(&copy, sample + offset, sizeof(sample) - offset) == 0);
        CHECK(mbedtls_md_finish(&state, digest) == 0 && mbedtls_md_finish(&copy, duplicate) == 0);
        CHECK(!memcmp(digest, hashes[i], mbedtls_md_get_size(info)) && !memcmp(digest, duplicate, mbedtls_md_get_size(info)));
        mbedtls_md_free(&state); mbedtls_md_free(&copy);
    }
    TRACE("hmac-hkdf-pbkdf2");
    const mbedtls_md_info_t *sha256 = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
    unsigned char hmac_key[20]; memset(hmac_key, 0x0b, sizeof(hmac_key));
    CHECK(mbedtls_md_hmac(sha256, hmac_key, sizeof(hmac_key), (unsigned char *)"Hi There", 8, hmac) == 0);
    unsigned char ikm[22], salt[13], info[10]; memset(ikm, 0x0b, sizeof(ikm));
    for (size_t i = 0; i < sizeof(salt); i++) salt[i] = i;
    for (size_t i = 0; i < sizeof(info); i++) info[i] = 0xf0 + i;
    CHECK(mbedtls_hkdf(sha256, salt, sizeof(salt), ikm, sizeof(ikm), info, sizeof(info), hkdf, sizeof(hkdf)) == 0);
    unsigned char rejected_output[255 * 32 + 1 + 32]; memset(rejected_output, 0xa5, sizeof(rejected_output));
    CHECK(mbedtls_hkdf_expand(sha256, hmac, sizeof(hmac), info, sizeof(info), rejected_output, 255 * 32 + 1) != 0);
    for (size_t i = 0; i < sizeof(rejected_output); i++) CHECK(rejected_output[i] == 0xa5);
    mbedtls_md_context_t kdf; mbedtls_md_init(&kdf);
    CHECK(mbedtls_md_setup(&kdf, sha256, 1) == 0);
    CHECK(mbedtls_pkcs5_pbkdf2_hmac(&kdf, "password", 8, "salt", 4, 2, sizeof(pbkdf), pbkdf) == 0);
    mbedtls_md_free(&kdf);

    TRACE("blake2b");
    unsigned char blake512[64], blake256[32], keyed[64];
    Hacl_Hash_Blake2b_hash_with_key(blake512, 64, sample, sizeof(sample), key, 0);
    Hacl_Hash_Blake2b_hash_with_key(blake256, 32, sample, sizeof(sample), key, 0);
    Hacl_Hash_Blake2b_hash_with_key(keyed, 64, sample, sizeof(sample), key, sizeof(key));
    CHECK(BLAKE2B256(sample, sizeof(sample), digest) == 0 && !memcmp(digest, blake256, 32));
    Hacl_Hash_Blake2b_state_t *blake = Hacl_Hash_Blake2b_malloc(); CHECK(blake);
    CHECK(Hacl_Hash_Blake2b_update(blake, sample, 63) == Hacl_Streaming_Types_Success);
    Hacl_Hash_Blake2b_state_t *copy = Hacl_Hash_Blake2b_copy(blake); CHECK(copy);
    CHECK(Hacl_Hash_Blake2b_update(blake, sample + 63, sizeof(sample) - 63) == Hacl_Streaming_Types_Success);
    CHECK(Hacl_Hash_Blake2b_update(copy, sample + 63, sizeof(sample) - 63) == Hacl_Streaming_Types_Success);
    CHECK(Hacl_Hash_Blake2b_digest(blake, digest) == 64 && Hacl_Hash_Blake2b_digest(copy, duplicate) == 64);
    CHECK(!memcmp(digest, blake512, 64) && !memcmp(digest, duplicate, 64));
    Hacl_Hash_Blake2b_reset(blake);
    CHECK(Hacl_Hash_Blake2b_digest(blake, digest) == 64);
    Hacl_Hash_Blake2b_hash_with_key(duplicate, 64, sample, 0, key, 0);
    CHECK(!memcmp(digest, duplicate, 64));
    Hacl_Hash_Blake2b_free(copy); Hacl_Hash_Blake2b_free(blake);

    TRACE("zstd");
    size_t zstd_size = ZSTD_compress(compressed, sizeof(compressed), sample, sizeof(sample), 3);
    CHECK(ZSTD_versionNumber() == ZSTD_VERSION_NUMBER);
    CHECK(LZ4_versionNumber() == LZ4_VERSION_NUMBER);
    CHECK(!ZSTD_isError(zstd_size));
    CHECK(ZSTD_decompress(restored, sizeof(restored), compressed, zstd_size) == sizeof(sample));
    CHECK(!memcmp(restored, sample, sizeof(sample)));
    memset(restored, 0xa5, sizeof(restored));
    CHECK(ZSTD_isError(ZSTD_decompress(restored, 100, compressed, zstd_size)));
    for (size_t i = 100; i < sizeof(restored); i++) CHECK(restored[i] == 0xa5);
    compressed[0] ^= 1;
    CHECK(ZSTD_isError(ZSTD_decompress(restored, sizeof(restored), compressed, zstd_size)));

    TRACE("lz4");
    size_t lz4_size = LZ4F_compressFrame(compressed, sizeof(compressed), sample, sizeof(sample), NULL);
    CHECK(!LZ4F_isError(lz4_size));
    LZ4F_dctx *lz4; CHECK(!LZ4F_isError(LZ4F_createDecompressionContext(&lz4, LZ4F_VERSION)));
    size_t consumed = lz4_size, produced = sizeof(restored);
    CHECK(LZ4F_decompress(lz4, restored, &produced, compressed, &consumed, NULL) == 0);
    CHECK(consumed == lz4_size && produced == sizeof(sample) && !memcmp(restored, sample, sizeof(sample)));
    CHECK(LZ4F_freeDecompressionContext(lz4) == 0);
    CHECK(!LZ4F_isError(LZ4F_createDecompressionContext(&lz4, LZ4F_VERSION)));
    compressed[0] ^= 1; consumed = lz4_size; produced = sizeof(restored);
    CHECK(LZ4F_isError(LZ4F_decompress(lz4, restored, &produced, compressed, &consumed, NULL)));
    LZ4F_freeDecompressionContext(lz4);

    TRACE("bzip2");
    unsigned int bz_size = sizeof(compressed);
    CHECK(BZ2_bzBuffToBuffCompress((char *)compressed, &bz_size, (char *)sample, sizeof(sample), 9, 0, 30) == BZ_OK);
    unsigned int bz_output = sizeof(restored);
    CHECK(BZ2_bzBuffToBuffDecompress((char *)restored, &bz_output, (char *)compressed, bz_size, 0, 0) == BZ_OK);
    CHECK(bz_output == sizeof(sample) && !memcmp(restored, sample, sizeof(sample)));
    memset(restored, 0xa5, sizeof(restored)); bz_output = 100;
    CHECK(BZ2_bzBuffToBuffDecompress((char *)restored, &bz_output, (char *)compressed, bz_size, 0, 0) == BZ_OUTBUFF_FULL);
    for (size_t i = 100; i < sizeof(restored); i++) CHECK(restored[i] == 0xa5);
    compressed[0] ^= 1; bz_output = sizeof(restored);
    CHECK(BZ2_bzBuffToBuffDecompress((char *)restored, &bz_output, (char *)compressed, bz_size, 0, 0) == BZ_DATA_ERROR_MAGIC);

    printf("NATIVE_BACKEND_PROBE {\"versions\":{\"mbedtls\":\"%s\",\"zstd\":%u,\"lz4\":%d,\"bzip2\":\"%s\"},\"vectors\":{", MBEDTLS_VERSION_STRING_FULL, ZSTD_versionNumber(), LZ4_versionNumber(), BZ2_bzlibVersion());
    for (size_t i = 0; i < 6; i++) {
        printf("%s\"%s\":\"", i ? "," : "", names[i]); hex(hashes[i], mbedtls_md_get_size(mbedtls_md_info_from_type(types[i]))); printf("\"");
    }
    printf(",\"hmac-sha256\":\""); hex(hmac, sizeof(hmac));
    printf("\",\"hkdf-sha256\":\""); hex(hkdf, sizeof(hkdf));
    printf("\",\"pbkdf2-sha256\":\""); hex(pbkdf, sizeof(pbkdf));
    printf("\",\"blake2b512\":\""); hex(blake512, sizeof(blake512));
    printf("\",\"blake2b256\":\""); hex(blake256, sizeof(blake256));
    printf("\",\"blake2b-keyed\":\""); hex(keyed, sizeof(keyed));
    printf("\"},\"selfTests\":true,\"streamCopy\":true,\"corruption\":true,\"outputBounds\":true,\"roundTrips\":true,\"crc32\":%lu,\"adler32\":%lu,\"crc32c\":%u}\n",
           (unsigned long)crc32(0, sample, sizeof(sample)), (unsigned long)adler32(1, sample, sizeof(sample)), crc32c(0, "123456789", 9));
    return 0;
}
