#ifndef QUICKJS_COSMO_CRYPTO_AEAD_H
#define QUICKJS_COSMO_CRYPTO_AEAD_H
#include "core.h"
typedef struct QCryptoAead QCryptoAead;
/* 0/1/2: AES-128/192/256-GCM; 3: ChaCha20-Poly1305. */
QCryptoAead *qcrypto_aead_create(int,int,const uint8_t *,size_t,const uint8_t *,size_t,int *);
int qcrypto_aead_aad(QCryptoAead *,const uint8_t *,size_t);
int qcrypto_aead_update(QCryptoAead *,const uint8_t *,size_t,uint8_t *);
int qcrypto_aead_finish(QCryptoAead *,const uint8_t *,size_t,uint8_t[16]);
void qcrypto_aead_free(QCryptoAead *);
#endif
