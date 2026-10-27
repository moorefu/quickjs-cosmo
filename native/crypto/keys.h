#ifndef QUICKJS_COSMO_CRYPTO_KEYS_H
#define QUICKJS_COSMO_CRYPTO_KEYS_H
#include "core.h"
enum {QKEY_SECRET,QKEY_ED25519,QKEY_X25519};
enum {QKEY_SYMMETRIC,QKEY_PUBLIC,QKEY_PRIVATE};
typedef struct QCryptoKey QCryptoKey;
QCryptoKey *qcrypto_key_create(int,int,const uint8_t *,size_t);
QCryptoKey *qcrypto_key_public(const QCryptoKey *);
void qcrypto_key_free(QCryptoKey *);
const uint8_t *qcrypto_key_bytes(const QCryptoKey *);
size_t qcrypto_key_length(const QCryptoKey *);
int qcrypto_key_algorithm(const QCryptoKey *);
int qcrypto_key_kind(const QCryptoKey *);
int qcrypto_key_sign(const QCryptoKey *,const uint8_t *,size_t,uint8_t[64]);
int qcrypto_key_verify(const QCryptoKey *,const uint8_t *,size_t,const uint8_t[64]);
int qcrypto_key_derive(const QCryptoKey *,const QCryptoKey *,uint8_t[32]);
#endif
