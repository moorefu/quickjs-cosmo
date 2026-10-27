#include <stdlib.h>
#include <string.h>
#include "third_party/haclstar/haclstar.h"
#include "keys.h"
struct QCryptoKey {int algorithm,kind;size_t length;uint8_t material[];};
QCryptoKey *qcrypto_key_create(int algorithm,int kind,const uint8_t *data,size_t length){
    if(algorithm<QKEY_SECRET || algorithm>QKEY_X25519 || kind<QKEY_SYMMETRIC || kind>QKEY_PRIVATE ||
       (algorithm==QKEY_SECRET?kind!=QKEY_SYMMETRIC:kind==QKEY_SYMMETRIC || length!=32) || length>SIZE_MAX-sizeof(QCryptoKey))return NULL;
    QCryptoKey *key=calloc(1,sizeof(*key)+length);if(!key)return NULL;
    key->algorithm=algorithm;key->kind=kind;key->length=length;if(length)memcpy(key->material,data,length);return key;
}
void qcrypto_key_free(QCryptoKey *key){free(key);}
const uint8_t *qcrypto_key_bytes(const QCryptoKey *key){return key->material;}
size_t qcrypto_key_length(const QCryptoKey *key){return key->length;}
int qcrypto_key_algorithm(const QCryptoKey *key){return key->algorithm;}
int qcrypto_key_kind(const QCryptoKey *key){return key->kind;}
QCryptoKey *qcrypto_key_public(const QCryptoKey *key){
    if(key->algorithm==QKEY_SECRET)return NULL;
    QCryptoKey *result=qcrypto_key_create(key->algorithm,QKEY_PUBLIC,key->material,32);if(!result)return NULL;
    if(key->kind==QKEY_PRIVATE){
        if(key->algorithm==QKEY_ED25519)Hacl_Ed25519_secret_to_public(result->material,key->material);
        else Hacl_Curve25519_secret_to_public(result->material,key->material);
    }
    return result;
}
int qcrypto_key_sign(const QCryptoKey *key,const uint8_t *data,size_t length,uint8_t signature[64]){
    if(key->algorithm!=QKEY_ED25519 || key->kind!=QKEY_PRIVATE || length>UINT32_MAX)return QCR_ARGUMENT;
    Hacl_Slice slice={.size=length,.data=data};Hacl_Ed25519_sign(signature,key->material,1,&slice);return 0;
}
int qcrypto_key_verify(const QCryptoKey *key,const uint8_t *data,size_t length,const uint8_t signature[64]){
    if(key->algorithm!=QKEY_ED25519 || key->kind!=QKEY_PUBLIC || length>UINT32_MAX)return 0;
    void *workspace=calloc(640,sizeof(uint64_t));if(!workspace)return QCR_ALLOCATION;
    void *previous=qcrypto_ed_workspace_enter(workspace);
    Hacl_Slice slice={.size=length,.data=data};int valid=Hacl_Ed25519_verify(key->material,1,&slice,signature);
    qcrypto_ed_workspace_leave(previous);return valid;
}
int qcrypto_key_derive(const QCryptoKey *private_key,const QCryptoKey *public_key,uint8_t output[32]){
    if(private_key->algorithm!=QKEY_X25519 || public_key->algorithm!=QKEY_X25519 || private_key->kind!=QKEY_PRIVATE || public_key->kind!=QKEY_PUBLIC)return QCR_ARGUMENT;
    return Hacl_Curve25519_ecdh(output,private_key->material,public_key->material)?QCR_OK:QCR_BACKEND;
}
