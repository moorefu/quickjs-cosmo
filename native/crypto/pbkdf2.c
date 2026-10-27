/* Add cooperative interruption at the pinned PBKDF2 HMAC-reset boundary.
   No iteration, digest, counter or XOR logic is replaced. */
#include "third_party/mbedtls/md.h"
#include "core.h"
static _Thread_local QCryptoCancellation cancellation;
QCryptoCancellation qcrypto_cancel_enter(QCryptoCancellation value){QCryptoCancellation old=cancellation;cancellation=value;return old;}
void qcrypto_cancel_leave(QCryptoCancellation value){cancellation=value;}
static int cancellable_reset(mbedtls_md_context_t *context) {
    if(cancellation.check && cancellation.check(cancellation.opaque))return MBEDTLS_ERR_MD_BAD_INPUT_DATA;
    return mbedtls_md_hmac_reset(context);
}
#define mbedtls_md_hmac_reset cancellable_reset
#include "third_party/mbedtls/pkcs5.c"
#undef mbedtls_md_hmac_reset
