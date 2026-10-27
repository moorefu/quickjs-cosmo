/* Probe only: no candidate backend is linked into the production runtime. */
#include <errno.h>
#include <netdb.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/random.h>
#include <sys/socket.h>
#include <unistd.h>
#include "libc/str/blake2.h"
#include "third_party/zlib/zlib.h"

#define CHECK(x) do { if (!(x)) { fprintf(stderr, "probe:%d: %s (errno=%d)\n", __LINE__, #x, errno); return 1; } } while (0)

int main(void) {
    static const unsigned char input[] = "QuickJS\0Cosmopolitan";
    unsigned char compressed[128], restored[128], random[32], digest[32];
    static const unsigned char blake_expected[32] = {
        0xbd,0xdd,0x81,0x3c,0x63,0x42,0x39,0x72,0x31,0x71,0xef,0x3f,0xee,0x98,0x57,0x9b,
        0x94,0x96,0x4e,0x3b,0xb1,0xcb,0x3e,0x42,0x72,0x62,0xc8,0xc0,0x68,0xd5,0x23,0x19
    };
    uLongf compressed_length = sizeof(compressed), restored_length = sizeof(restored);
    struct addrinfo hints = {0}, *addresses = NULL;
    FILE *file;
    size_t offset = 0;
    int descriptor;
    CHECK(compress2(compressed, &compressed_length, input, sizeof(input), 6) == Z_OK);
    CHECK(uncompress(restored, &restored_length, compressed, compressed_length) == Z_OK);
    CHECK(restored_length == sizeof(input) && !memcmp(restored, input, sizeof(input)));
    CHECK(crc32(0, (const Bytef *)"123456789", 9) == 0xcbf43926u);
    CHECK(BLAKE2B256("abc", 3, digest) == 0);
    CHECK(!memcmp(digest, blake_expected, sizeof(digest)));
    while (offset < sizeof(random)) {
        ssize_t count = getrandom(random + offset, sizeof(random) - offset, 0);
        if (count < 0 && errno == EINTR) continue;
        CHECK(count > 0);
        offset += count;
    }
    hints.ai_flags = AI_NUMERICHOST | AI_NUMERICSERV;
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    CHECK(getaddrinfo("127.0.0.1", "0", &hints, &addresses) == 0);
    CHECK(addresses && addresses->ai_family == AF_INET);
    freeaddrinfo(addresses);
    descriptor = socket(AF_INET, SOCK_STREAM, 0);
    CHECK(descriptor >= 0);
    CHECK(close(descriptor) == 0);
    file = tmpfile();
    CHECK(file != NULL);
    CHECK(fwrite(input, 1, sizeof(input), file) == sizeof(input));
    CHECK(fseek(file, 0, SEEK_SET) == 0);
    CHECK(fread(restored, 1, sizeof(input), file) == sizeof(input));
    CHECK(!memcmp(restored, input, sizeof(input)));
    CHECK(fclose(file) == 0);
    printf("NATIVE_PROBE {\"zlib\":\"%s\",\"crc32\":true,\"blake2b256\":true,\"getrandom\":true,\"numericAddress\":true,\"socketCreation\":true,\"stdio\":true}\n", zlibVersion());
    return 0;
}
