#include <stdlib.h>
#include <string.h>
#include "libc/str/str.h"
#include "third_party/mbedtls/gcm.h"
#include "third_party/mbedtls/chachapoly.h"
#include "aead.h"
struct QCryptoAead {
    int algorithm,decrypt,started,finished;
    uint64_t length;
    mbedtls_gcm_context gcm;
    mbedtls_chachapoly_context chacha;
    uint8_t *iv,*aad;size_t iv_length,aad_length,aad_capacity;
    uint8_t pending[16];size_t pending_length;
};
static int result(int code){return !code?QCR_OK:code==MBEDTLS_ERR_CIPHER_ALLOC_FAILED?QCR_ALLOCATION:QCR_BACKEND;}
void qcrypto_aead_free(QCryptoAead *s){
    if(!s)return;
    if(s->algorithm==3)mbedtls_chachapoly_free(&s->chacha);else mbedtls_gcm_free(&s->gcm);
    free(s->aad);free(s->iv);free(s);
}
QCryptoAead *qcrypto_aead_create(int algorithm,int decrypt,const uint8_t *key,size_t key_length,const uint8_t *iv,size_t iv_length,int *error){
    *error=QCR_ARGUMENT;
    if(algorithm<0 || algorithm>3 || key_length!=(algorithm==3?32:16+8*algorithm) || !iv_length || (algorithm==3 && iv_length!=12))return NULL;
    QCryptoAead *s=calloc(1,sizeof(*s));if(!s){*error=QCR_ALLOCATION;return NULL;}
    s->algorithm=algorithm;s->decrypt=decrypt;s->iv_length=iv_length;
    int code;
    if(algorithm==3){
        mbedtls_chachapoly_init(&s->chacha);code=mbedtls_chachapoly_setkey(&s->chacha,key);
        if(!code)code=mbedtls_chachapoly_starts(&s->chacha,iv,decrypt?MBEDTLS_CHACHAPOLY_DECRYPT:MBEDTLS_CHACHAPOLY_ENCRYPT);
    }else{
        s->iv=calloc(1,iv_length);if(!s->iv){*error=QCR_ALLOCATION;goto fail;}
        memcpy(s->iv,iv,iv_length);mbedtls_gcm_init(&s->gcm);
        code=mbedtls_gcm_setkey(&s->gcm,MBEDTLS_CIPHER_ID_AES,key,8*key_length);
    }
    *error=result(code);if(*error)goto fail;return s;
fail:qcrypto_aead_free(s);return NULL;
}
int qcrypto_aead_aad(QCryptoAead *s,const uint8_t *data,size_t length){
    if(s->started || s->finished)return QCR_STATE;
    if(s->algorithm==3)return result(mbedtls_chachapoly_update_aad(&s->chacha,data,length));
    if(length>SIZE_MAX-s->aad_length)return QCR_ARGUMENT;
    size_t wanted=s->aad_length+length;
    if(wanted>s->aad_capacity){
        size_t capacity=s->aad_capacity?s->aad_capacity:64;
        while(capacity<wanted){if(capacity>SIZE_MAX/2){capacity=wanted;break;}capacity*=2;}
        uint8_t *next=calloc(1,capacity);if(!next)return QCR_ALLOCATION;
        if(s->aad_length)memcpy(next,s->aad,s->aad_length);
        free(s->aad);s->aad=next;s->aad_capacity=capacity;
    }
    if(length)memcpy(s->aad+s->aad_length,data,length);
    s->aad_length=wanted;return 0;
}
static int begin(QCryptoAead *s){
    if(s->started)return 0;
    int code=s->algorithm==3?0:mbedtls_gcm_starts(&s->gcm,s->decrypt?MBEDTLS_GCM_DECRYPT:MBEDTLS_GCM_ENCRYPT,s->iv,s->iv_length,s->aad,s->aad_length);
    if(code)return result(code);
    s->started=1;free(s->aad);s->aad=NULL;s->aad_length=s->aad_capacity=0;free(s->iv);s->iv=NULL;return 0;
}
int qcrypto_aead_update(QCryptoAead *s,const uint8_t *data,size_t length,uint8_t *output){
    if(s->finished)return QCR_STATE;
    if(!length)return 0;
    uint64_t maximum=s->algorithm==3?UINT64_C(0xffffffff)*64:UINT64_C(0xfffffffe0);
    if(length>maximum-s->length)return QCR_ARGUMENT;
    int code=begin(s);if(code)return code;
    s->length+=length;
    if(s->algorithm==3)return result(mbedtls_chachapoly_update(&s->chacha,length,data,output));
    /* The pinned GCM core permits a partial block only on its last call.
       Keep the committed context at a block boundary. A shallow snapshot
       previews <=15 pending bytes; our ECB bridge is read-only on its AES
       schedule. Each complete block is committed once, without replaying
       message history or changing AES/GHASH arithmetic. */
    uint8_t temporary[16];mbedtls_gcm_context preview;
    if(s->pending_length){
        size_t old=s->pending_length,take=16-old;if(take>length)take=length;
        memcpy(s->pending+old,data,take);s->pending_length+=take;
        if(s->pending_length==16){code=mbedtls_gcm_update(&s->gcm,16,s->pending,temporary);s->pending_length=0;}
        else {preview=s->gcm;code=mbedtls_gcm_update(&preview,s->pending_length,s->pending,temporary);}
        if(code)goto done;
        memcpy(output,temporary+old,take);data+=take;output+=take;length-=take;
        if(!s->pending_length)explicit_bzero(s->pending,sizeof(s->pending));
    }
    size_t blocks=length&~(size_t)15;
    if(blocks){code=mbedtls_gcm_update(&s->gcm,blocks,data,output);if(code)goto done;data+=blocks;output+=blocks;length-=blocks;}
    if(length){
        memcpy(s->pending,data,length);s->pending_length=length;preview=s->gcm;
        code=mbedtls_gcm_update(&preview,length,data,temporary);if(!code)memcpy(output,temporary,length);
    }
done:explicit_bzero(temporary,sizeof(temporary));explicit_bzero(&preview,sizeof(preview));return result(code);
}
int qcrypto_aead_finish(QCryptoAead *s,const uint8_t *expected,size_t expected_length,uint8_t tag[16]){
    if(s->finished)return QCR_STATE;
    if(s->decrypt && (!expected || expected_length<(s->algorithm==3?1:4) || expected_length>16))return QCR_ARGUMENT;
    int code=begin(s);if(code)return code;s->finished=1;
    if(s->algorithm==3)code=mbedtls_chachapoly_finish(&s->chacha,tag);
    else {
        uint8_t discarded[16];
        if(s->pending_length)code=mbedtls_gcm_update(&s->gcm,s->pending_length,s->pending,discarded);
        if(!code)code=mbedtls_gcm_finish(&s->gcm,tag,16);
        explicit_bzero(discarded,sizeof(discarded));
    }
    if(code)return result(code);
    return s->decrypt && !qcrypto_equal(tag,expected,expected_length)?QCR_AUTH:QCR_OK;
}
