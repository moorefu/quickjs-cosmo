#ifndef QUICKJS_COSMO_CRYPTO_CORE_H
#define QUICKJS_COSMO_CRYPTO_CORE_H
#include <stddef.h>
#include <stdint.h>

enum { QCR_MD5, QCR_SHA1, QCR_SHA224, QCR_SHA256, QCR_SHA384, QCR_SHA512, QCR_BLAKE512,
       QCR_SHA3_224,QCR_SHA3_256,QCR_SHA3_384,QCR_SHA3_512,QCR_SHAKE128,QCR_SHAKE256,QCR_BLAKE2S256,QCR_ALGORITHMS };
enum { QCR_OK, QCR_ALLOCATION=-1, QCR_ARGUMENT=-2, QCR_BACKEND=-3, QCR_STATE=-4, QCR_AUTH=-5 };
typedef struct QCryptoHash QCryptoHash;
typedef struct {int (*check)(void *);void *opaque;} QCryptoCancellation;
QCryptoCancellation qcrypto_cancel_enter(QCryptoCancellation);
void qcrypto_cancel_leave(QCryptoCancellation);
typedef struct {
    void *opaque;
    void *(*allocate)(void *,size_t);
    void (*release)(void *,void *);
} QCryptoAllocator;

/* Allocator scopes are thread-local. Every allocation retains its own owner,
   so GC can release a state after the creation scope has ended. */
QCryptoAllocator qcrypto_allocator_enter(QCryptoAllocator);
void qcrypto_allocator_leave(QCryptoAllocator);
void *qcrypto_ed_workspace_enter(void *);
void qcrypto_ed_workspace_leave(void *);
size_t qcrypto_digest_size(int);
size_t qcrypto_hash_size(const QCryptoHash *);
int qcrypto_hash_hmac(const QCryptoHash *);
QCryptoHash *qcrypto_hash_create(int,int,const uint8_t *,size_t,size_t);
QCryptoHash *qcrypto_hash_copy(const QCryptoHash *,size_t);
int qcrypto_hash_update(QCryptoHash *,const uint8_t *,size_t);
int qcrypto_hash_finish(QCryptoHash *,uint8_t *);
void qcrypto_hash_free(QCryptoHash *);
int qcrypto_hkdf(int,const uint8_t *,size_t,const uint8_t *,size_t,const uint8_t *,size_t,uint8_t *,size_t);
int qcrypto_pbkdf2(int,const uint8_t *,size_t,const uint8_t *,size_t,uint32_t,uint8_t *,size_t);
int qcrypto_random(uint8_t *,size_t);
int qcrypto_equal(const uint8_t *,const uint8_t *,size_t);
int qcrypto_blake256(const uint8_t *,size_t,uint8_t *);
#endif
