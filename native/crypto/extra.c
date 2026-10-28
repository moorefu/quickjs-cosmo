#include <stdlib.h>
#include <string.h>
#include "libc/str/str.h"
#include "extra.h"
#include "Hacl_SHA3.h"
#include "Hacl_Blake2s_32.h"

/* Only this private cohort calls the old generator's out-of-line wipe hook. */
void Lib_Memzero0_memzero(void *data,uint64_t length){explicit_bzero(data,length);}
struct QCryptoExtra {
    int algorithm;size_t output_length,rate,used;uint64_t processed;
    uint64_t sponge[25];uint32_t blake[16],work[16];uint8_t pending[168];
};
static int length_valid(int algorithm,size_t length){
    return algorithm>=QCR_SHA3_224 && algorithm<QCR_ALGORITHMS &&
        (algorithm==QCR_SHAKE128 || algorithm==QCR_SHAKE256?length<=UINT32_MAX:length==qcrypto_digest_size(algorithm));
}
QCryptoExtra *qcrypto_extra_create(int algorithm,size_t length){
    if(!length_valid(algorithm,length))return NULL;
    QCryptoExtra *s=calloc(1,sizeof(*s));if(!s)return NULL;
    static const size_t rates[]={144,136,104,72,168,136,64};
    s->algorithm=algorithm;s->output_length=length;s->rate=rates[algorithm-QCR_SHA3_224];
    if(algorithm==QCR_BLAKE2S256)Hacl_Blake2s_32_blake2s_init(s->work,s->blake,0,s->pending,32);
    return s;
}
QCryptoExtra *qcrypto_extra_copy(const QCryptoExtra *s,size_t length){
    if(!length_valid(s->algorithm,length))return NULL;
    QCryptoExtra *copy=calloc(1,sizeof(*copy));if(copy){*copy=*s;copy->output_length=length;}return copy;
}
void qcrypto_extra_free(QCryptoExtra *s){free(s);}
int qcrypto_extra_update(QCryptoExtra *s,const uint8_t *data,size_t length){
    if(length>UINT64_MAX-s->processed-s->used)return QCR_ARGUMENT;
    while(length){
        /* Keep the last full block: BLAKE2s marks it as final at digest. */
        if(s->used==s->rate){
            if(s->algorithm==QCR_BLAKE2S256)Hacl_Blake2s_32_blake2s_update_multi(64,s->work,s->blake,s->processed,s->pending,1);
            else {Hacl_Impl_SHA3_loadState(s->rate,s->pending,s->sponge);Hacl_Impl_SHA3_state_permute(s->sponge);}
            s->processed+=s->rate;s->used=0;explicit_bzero(s->pending,sizeof(s->pending));
        }
        size_t take=s->rate-s->used;if(take>length)take=length;
        memcpy(s->pending+s->used,data,take);s->used+=take;data+=take;length-=take;
    }
    return 0;
}
int qcrypto_extra_finish(QCryptoExtra *s,uint8_t *output){
    if(s->algorithm==QCR_BLAKE2S256){
        Hacl_Blake2s_32_blake2s_update_last(s->used,s->work,s->blake,s->processed,s->used,s->pending);
        Hacl_Blake2s_32_blake2s_finish(32,output,s->blake);
    }else{
        Hacl_Impl_SHA3_absorb(s->sponge,s->rate,s->used,s->pending,
            s->algorithm==QCR_SHAKE128 || s->algorithm==QCR_SHAKE256?0x1f:0x06);
        Hacl_Impl_SHA3_squeeze(s->sponge,s->rate,s->output_length,output);
    }
    return 0;
}
