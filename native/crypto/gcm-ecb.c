/* GCM only needs encryption of an AES block. Keep its generic-cipher bridge
   restricted to that operation; all AES and GHASH arithmetic stays in the
   pinned Nightly sources. These names are localized in the SDK closure. */
#include <stdlib.h>
#include <string.h>
#include "third_party/mbedtls/aes.h"
#include "third_party/mbedtls/cipher.h"
static const mbedtls_cipher_info_t info[] = {
    {.type=MBEDTLS_CIPHER_AES_128_ECB,.mode=MBEDTLS_MODE_ECB,.key_bitlen=128,.block_size=16,.name="AES-128-ECB"},
    {.type=MBEDTLS_CIPHER_AES_192_ECB,.mode=MBEDTLS_MODE_ECB,.key_bitlen=192,.block_size=16,.name="AES-192-ECB"},
    {.type=MBEDTLS_CIPHER_AES_256_ECB,.mode=MBEDTLS_MODE_ECB,.key_bitlen=256,.block_size=16,.name="AES-256-ECB"},
};
const mbedtls_cipher_info_t *mbedtls_cipher_info_from_values(mbedtls_cipher_id_t id,int bits,mbedtls_cipher_mode_t mode){
    if(id!=MBEDTLS_CIPHER_ID_AES || mode!=MBEDTLS_MODE_ECB)return NULL;
    return bits==128?info:bits==192?info+1:bits==256?info+2:NULL;
}
void mbedtls_cipher_free(mbedtls_cipher_context_t *ctx){
    if(ctx->cipher_ctx){mbedtls_aes_free(ctx->cipher_ctx);free(ctx->cipher_ctx);}memset(ctx,0,sizeof(*ctx));
}
int mbedtls_cipher_setup(mbedtls_cipher_context_t *ctx,const mbedtls_cipher_info_t *type){
    if(!type || type->mode!=MBEDTLS_MODE_ECB)return MBEDTLS_ERR_CIPHER_BAD_INPUT_DATA;
    ctx->cipher_ctx=calloc(1,sizeof(mbedtls_aes_context));if(!ctx->cipher_ctx)return MBEDTLS_ERR_CIPHER_ALLOC_FAILED;
    ctx->cipher_info=type;mbedtls_aes_init(ctx->cipher_ctx);return 0;
}
int mbedtls_cipher_setkey(mbedtls_cipher_context_t *ctx,const unsigned char *key,int bits,mbedtls_operation_t operation){
    if(!ctx->cipher_ctx || operation!=MBEDTLS_ENCRYPT)return MBEDTLS_ERR_CIPHER_BAD_INPUT_DATA;
    ctx->key_bitlen=bits;ctx->operation=operation;return mbedtls_aes_setkey_enc(ctx->cipher_ctx,key,bits);
}
int mbedtls_cipher_update(mbedtls_cipher_context_t *ctx,const unsigned char *input,size_t length,unsigned char *output,size_t *written){
    *written=0;if(!ctx->cipher_ctx || length!=16)return MBEDTLS_ERR_CIPHER_BAD_INPUT_DATA;
    int result=mbedtls_aes_crypt_ecb(ctx->cipher_ctx,MBEDTLS_AES_ENCRYPT,input,output);if(!result)*written=16;return result;
}
