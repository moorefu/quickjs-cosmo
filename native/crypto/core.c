#include <errno.h>
#include <limits.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/random.h>
#include "libc/str/str.h"
#include "third_party/mbedtls/md.h"
#include "third_party/mbedtls/hkdf.h"
#include "third_party/mbedtls/pkcs5.h"
#include "third_party/haclstar/haclstar.h"
#include "core.h"

static _Thread_local QCryptoAllocator allocator;
static _Thread_local void *ed_workspace;
typedef union {
    max_align_t alignment;
    struct { QCryptoAllocator owner; void *raw; size_t total; } value;
} Allocation;

QCryptoAllocator qcrypto_allocator_enter(QCryptoAllocator next) {
    QCryptoAllocator previous=allocator; allocator=next; return previous;
}
void qcrypto_allocator_leave(QCryptoAllocator previous) { allocator=previous; }

/* These three names are localized inside the partial-linked crypto object.
   Link wrapping applies only to the selected backend/binding objects. */
void *__wrap_malloc(size_t size) {
    if(ed_workspace && size==640*sizeof(uint64_t)){void *data=ed_workspace;ed_workspace=NULL;return data;}
    /* QuickJS's small-block allocator promises only eight-byte alignment.
       Align both our header and backend data independently of that allocator. */
    const size_t alignment=_Alignof(Allocation), overhead=sizeof(Allocation)+alignment-1;
    if (!allocator.allocate || size>SIZE_MAX-overhead) return NULL;
    void *raw=allocator.allocate(allocator.opaque,overhead+size);
    if (!raw) return NULL;
    Allocation *block=(void *)(((uintptr_t)raw+alignment-1)&~(uintptr_t)(alignment-1));
    block->value.owner=allocator; block->value.raw=raw; block->value.total=overhead+size;
    return block+1;
}
void *__wrap_calloc(size_t count,size_t size) {
    /* Fixed ed25519.c's verifier has one unchecked calloc(640,8). Its caller
       prepays this exact workspace, or reports OOM before entering HACL*. */
    if(ed_workspace && (!count || size<=SIZE_MAX/count) && count*size==640*sizeof(uint64_t)){
        void *data=ed_workspace;ed_workspace=NULL;return data;
    }
    if (count && size>SIZE_MAX/count) return NULL;
    size_t length=count*size; void *data=__wrap_malloc(length);
    if (data) memset(data,0,length);
    return data;
}
void __wrap_free(void *data) {
    if (!data) return;
    Allocation *block=(Allocation *)data-1;
    QCryptoAllocator owner=block->value.owner;
    void *raw=block->value.raw; size_t total=block->value.total;
    explicit_bzero(raw,total);
    owner.release(owner.opaque,raw);
}
void *qcrypto_ed_workspace_enter(void *next){void *previous=ed_workspace;ed_workspace=next;return previous;}
void qcrypto_ed_workspace_leave(void *previous){if(ed_workspace)__wrap_free(ed_workspace);ed_workspace=previous;}

struct QCryptoHash {
    int algorithm,hmac,finished;
    mbedtls_md_context_t md;
    Hacl_Hash_Blake2b_state_t *blake;
};
size_t qcrypto_digest_size(int algorithm) {
    static const size_t sizes[]={16,20,28,32,48,64,64};
    return algorithm>=0 && algorithm<QCR_ALGORITHMS?sizes[algorithm]:0;
}
static const mbedtls_md_info_t *digest_info(int algorithm) {
    const mbedtls_md_type_t kinds[]={MBEDTLS_MD_MD5,MBEDTLS_MD_SHA1,MBEDTLS_MD_SHA224,
        MBEDTLS_MD_SHA256,MBEDTLS_MD_SHA384,MBEDTLS_MD_SHA512};
    return algorithm>=0 && algorithm<QCR_BLAKE512?mbedtls_md_info_from_type(kinds[algorithm]):NULL;
}
size_t qcrypto_hash_size(const QCryptoHash *state) { return state?qcrypto_digest_size(state->algorithm):0; }
int qcrypto_hash_hmac(const QCryptoHash *state) { return state && state->hmac; }
QCryptoHash *qcrypto_hash_create(int algorithm,int hmac,const uint8_t *key,size_t keylen) {
    if (!qcrypto_digest_size(algorithm) || (hmac && algorithm==QCR_BLAKE512)) return NULL;
    QCryptoHash *state=calloc(1,sizeof(*state)); if (!state) return NULL;
    state->algorithm=algorithm; state->hmac=hmac;
    if (algorithm==QCR_BLAKE512) {
        state->blake=Hacl_Hash_Blake2b_malloc();
        if (!state->blake) goto fail;
    } else {
        mbedtls_md_init(&state->md);
        if (mbedtls_md_setup(&state->md,digest_info(algorithm),hmac)) goto fail;
        if (hmac?mbedtls_md_hmac_starts(&state->md,key,keylen):mbedtls_md_starts(&state->md)) goto fail;
    }
    return state;
fail: qcrypto_hash_free(state); return NULL;
}
void qcrypto_hash_free(QCryptoHash *state) {
    if (!state) return;
    if (state->blake) Hacl_Hash_Blake2b_free(state->blake);
    mbedtls_md_free(&state->md); free(state);
}
QCryptoHash *qcrypto_hash_copy(const QCryptoHash *state) {
    if (!state || state->finished || state->hmac) return NULL;
    QCryptoHash *copy=calloc(1,sizeof(*copy)); if (!copy) return NULL;
    copy->algorithm=state->algorithm;
    if (state->blake) {
        copy->blake=Hacl_Hash_Blake2b_copy(state->blake);
        if (!copy->blake) goto fail;
    } else {
        mbedtls_md_init(&copy->md);
        if (mbedtls_md_setup(&copy->md,digest_info(state->algorithm),0) || mbedtls_md_clone(&copy->md,&state->md)) goto fail;
    }
    return copy;
fail: qcrypto_hash_free(copy); return NULL;
}
int qcrypto_hash_update(QCryptoHash *state,const uint8_t *data,size_t length) {
    if (!state || state->finished) return QCR_STATE;
    if (state->blake) {
        while (length) {
            uint32_t chunk=length>UINT32_MAX?UINT32_MAX:(uint32_t)length;
            if (Hacl_Hash_Blake2b_update(state->blake,data,chunk)!=Hacl_Streaming_Types_Success) return QCR_BACKEND;
            data+=chunk; length-=chunk;
        }
        return QCR_OK;
    }
    int result=state->hmac?mbedtls_md_hmac_update(&state->md,data,length):mbedtls_md_update(&state->md,data,length);
    return result?QCR_BACKEND:QCR_OK;
}
int qcrypto_hash_finish(QCryptoHash *state,uint8_t *output) {
    if (!state || state->finished) return QCR_STATE;
    int result;
    if (state->blake) result=Hacl_Hash_Blake2b_digest(state->blake,output)==64?0:-1;
    else result=state->hmac?mbedtls_md_hmac_finish(&state->md,output):mbedtls_md_finish(&state->md,output);
    state->finished=1; return result?QCR_BACKEND:QCR_OK;
}
int qcrypto_hkdf(int algorithm,const uint8_t *key,size_t keylen,const uint8_t *salt,size_t saltlen,
                 const uint8_t *info,size_t infolen,uint8_t *output,size_t length) {
    const mbedtls_md_info_t *md=digest_info(algorithm); if (!md) return QCR_ARGUMENT;
    int result=mbedtls_hkdf(md,salt,saltlen,key,keylen,info,infolen,output,length);
    return result==MBEDTLS_ERR_MD_ALLOC_FAILED?QCR_ALLOCATION:result?QCR_BACKEND:QCR_OK;
}
int qcrypto_pbkdf2(int algorithm,const uint8_t *key,size_t keylen,const uint8_t *salt,size_t saltlen,
                   uint32_t iterations,uint8_t *output,size_t length) {
    const mbedtls_md_info_t *md=digest_info(algorithm); if (!md || !iterations || length>UINT32_MAX) return QCR_ARGUMENT;
    mbedtls_md_context_t state; mbedtls_md_init(&state);
    int result=mbedtls_md_setup(&state,md,1);
    if (!result) result=mbedtls_pkcs5_pbkdf2_hmac(&state,key,keylen,salt,saltlen,iterations,length,output);
    mbedtls_md_free(&state);
    return result==MBEDTLS_ERR_MD_ALLOC_FAILED?QCR_ALLOCATION:result?QCR_BACKEND:QCR_OK;
}
int qcrypto_random(uint8_t *data,size_t length) {
    while (length) {
        size_t chunk=length>1048576?1048576:length;
        ssize_t count=getrandom(data,chunk,0);
        if (count<0 && errno==EINTR) continue;
        if (count<=0 || (size_t)count>chunk) { if (count>=0) errno=EIO; return QCR_BACKEND; }
        data+=count; length-=count;
    }
    return QCR_OK;
}
int qcrypto_equal(const uint8_t *a,const uint8_t *b,size_t length) {
    return (timingsafe_bcmp)(a,b,length)==0;
}
int qcrypto_blake256(const uint8_t *data,size_t length,uint8_t *output) {
    Hacl_Hash_Blake2b_state_t *state=Hacl_Hash_Blake2b_malloc_256();
    if (!state) return QCR_ALLOCATION;
    int result=QCR_OK;
    while (length) {
        uint32_t chunk=length>UINT32_MAX?UINT32_MAX:(uint32_t)length;
        if (Hacl_Hash_Blake2b_update(state,data,chunk)!=Hacl_Streaming_Types_Success) { result=QCR_BACKEND; break; }
        data+=chunk; length-=chunk;
    }
    if (!result && Hacl_Hash_Blake2b_digest(state,output)!=32) result=QCR_BACKEND;
    Hacl_Hash_Blake2b_free(state); return result;
}
