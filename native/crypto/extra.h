#ifndef QUICKJS_COSMO_CRYPTO_EXTRA_H
#define QUICKJS_COSMO_CRYPTO_EXTRA_H
#include "core.h"
typedef struct QCryptoExtra QCryptoExtra;
QCryptoExtra *qcrypto_extra_create(int,size_t);
QCryptoExtra *qcrypto_extra_copy(const QCryptoExtra *,size_t);
void qcrypto_extra_free(QCryptoExtra *);
int qcrypto_extra_update(QCryptoExtra *,const uint8_t *,size_t);
int qcrypto_extra_finish(QCryptoExtra *,uint8_t *);
#endif
