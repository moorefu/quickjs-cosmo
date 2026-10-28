/* 嵌入相同补丁源码，以便对私有 Finished 回调注入真实分配失败。 */
#include "third_party/mbedtls/ssl_tls.c"
#include "third_party/mbedtls/x509_crt.c"
#include "libc/dce.h"
#include <errno.h>
#include <sys/random.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../../native/crypto/aead.c"
int qcrypto_equal(const uint8_t *a,const uint8_t *b,size_t length){return (timingsafe_bcmp)(a,b,length)==0;}

static int checks;
static long fail_allocation = -1;
static int fail_random, random_calls;
ssize_t __real_getrandom(void *, size_t, unsigned);
ssize_t __wrap_getrandom(void *buffer, size_t size, unsigned flags)
{
    if(IsLinux() && !(flags & GRND_RANDOM)) {
        fprintf(stderr,"Linux 随机数回退未使用安全设备\n");
        abort();
    }
    random_calls++;
    if(fail_random) { errno=EIO; return -1; }
    return __real_getrandom(buffer,size,flags);
}
void *__real_calloc(size_t, size_t);
void *__wrap_calloc(size_t count, size_t size)
{
    if(fail_allocation >= 0 && fail_allocation-- == 0) return NULL;
    return __real_calloc(count,size);
}

#define CHECK(test) do { checks++; if(!(test)) { fprintf(stderr,"安全回归失败：%s，行 %d\n",#test,__LINE__); return 1; } } while(0)

static int rng(void *unused, unsigned char *bytes, size_t size)
{
    memset(bytes,0x5a,size);
    return 0;
}

static int unit_tests(void)
{
    mbedtls_ssl_context ssl;
    mbedtls_ssl_config config;
    unsigned char output[64];
    mbedtls_ssl_init(&ssl);
    mbedtls_ssl_config_init(&config);
    CHECK(!mbedtls_ssl_config_defaults(&config,MBEDTLS_SSL_IS_CLIENT,MBEDTLS_SSL_TRANSPORT_STREAM,MBEDTLS_SSL_PRESET_DEFAULT));
    CHECK(!mbedtls_ssl_setup(&ssl,&config));
    CHECK(!mbedtls_sha256_starts_ret(&ssl.handshake->fin_sha256,0));
    CHECK(!mbedtls_sha512_starts_ret(&ssl.handshake->fin_sha512,1));
    /* 两条 TLS1.2 路径的每个 PRF 分配点，都必须拒绝且保留握手状态。 */
    for(int algorithm=0; algorithm<2; algorithm++) {
        ssl.handshake->tls_prf=algorithm ? tls_prf_sha384 : tls_prf_sha256;
        ssl.handshake->calc_finished=algorithm ? ssl_calc_finished_tls_sha384 : ssl_calc_finished_tls_sha256;
        for(int operation=0; operation<3; operation++) {
            for(int allocation=0; allocation<3; allocation++) {
                int state=ssl.state, rc;
                fail_allocation=allocation;
                if(operation==0) rc=ssl.handshake->calc_finished(&ssl,output,0);
                else if(operation==1) rc=mbedtls_ssl_write_finished(&ssl);
                else rc=mbedtls_ssl_parse_finished(&ssl);
                fail_allocation=-1;
                CHECK(rc==MBEDTLS_ERR_SSL_ALLOC_FAILED || rc==MBEDTLS_ERR_MD_ALLOC_FAILED);
                CHECK(ssl.state==state);
            }
        }
        CHECK(!ssl.handshake->calc_finished(&ssl,output,0));
    }
    mbedtls_ssl_free(&ssl);
    mbedtls_ssl_config_free(&config);

    mbedtls_ssl_session src, dst;
    mbedtls_ssl_session_init(&src);
    mbedtls_ssl_session_init(&dst);
    src.peer_cert=calloc(1,sizeof(*src.peer_cert));
    src.ticket=calloc(1,16); src.ticket_len=16;
    CHECK(src.peer_cert && src.ticket);
    fail_allocation=0;
    CHECK(mbedtls_ssl_session_copy(&dst,&src)==MBEDTLS_ERR_SSL_ALLOC_FAILED);
    fail_allocation=-1;
    CHECK(dst.ticket==NULL && dst.peer_cert==NULL);
    mbedtls_ssl_session_free(&dst);
    mbedtls_ssl_session_free(&src);

    mbedtls_ecdh_context dh;
    mbedtls_ecp_keypair local, peer;
    mbedtls_ecdh_init(&dh); mbedtls_ecp_keypair_init(&local); mbedtls_ecp_keypair_init(&peer);
    CHECK(!mbedtls_ecp_group_load(&local.grp,MBEDTLS_ECP_DP_SECP256R1));
    CHECK(!mbedtls_ecp_group_load(&peer.grp,MBEDTLS_ECP_DP_SECP256R1));
    CHECK(!mbedtls_mpi_lset(&local.d,1));
    CHECK(!mbedtls_mpi_read_string(&peer.Q.X,16,"005543894AF3D00ED7D740ABDBD75C96B06877B787DB5F70EEA78B90A8D7C00A"));
    CHECK(!mbedtls_mpi_read_string(&peer.Q.Y,16,"BB4C85A3D8EA29EFAAFA24406912DD84D5B14DC32BF656EF6C6BD58A5D943F92"));
    CHECK(!mbedtls_mpi_lset(&peer.Q.Z,1));
    CHECK(!mbedtls_ecdh_get_params(&dh,&local,MBEDTLS_ECDH_OURS));
    CHECK(!mbedtls_ecdh_get_params(&dh,&peer,MBEDTLS_ECDH_THEIRS));
    memset(output,0xa5,sizeof(output));
    size_t length=0;
    CHECK(mbedtls_ecdh_calc_secret(&dh,&length,output,31,rng,NULL)!=0);
    CHECK(output[31]==0xa5);
    CHECK(!mbedtls_ecdh_calc_secret(&dh,&length,output,32,rng,NULL));
    CHECK(length==32 && output[0]==0);
    mbedtls_ecdh_free(&dh); mbedtls_ecp_keypair_free(&local); mbedtls_ecp_keypair_free(&peer);
    printf("TLS_SECURITY_UNIT %d\n",checks);
    return 0;
}

int main(void){
    if(unit_tests())return 1;
    /* The JS AEAD binding uses the Nightly ChaCha backend, unlike the old
       branch. Its total-length guard must stop counter reuse before output. */
    for(int algorithm=0;algorithm<=3;algorithm+=3){
        unsigned char key[32]={0},nonce[12]={0},input[2]={0},output[2]={0xa5,0xa5};int error;
        QCryptoAead *state=qcrypto_aead_create(algorithm,0,key,algorithm==3?32:16,nonce,sizeof(nonce),&error);CHECK(state!=NULL);
        uint64_t maximum=algorithm==3?UINT64_C(0xffffffff)*64:UINT64_C(0xfffffffe0);state->length=maximum-1;
        CHECK(qcrypto_aead_update(state,input,2,output)==QCR_ARGUMENT);CHECK(state->length==maximum-1&&!state->started&&output[0]==0xa5&&output[1]==0xa5);
        state->length=maximum;CHECK(qcrypto_aead_update(state,input,1,output)==QCR_ARGUMENT);qcrypto_aead_free(state);
    }
    const unsigned char values[][8]={{0x30,0},{0x30,3,1,1,0xff},{0x30,3,1,1,0},{0x30,3,2,1,1},{0x30,2,1,1,0},{0x30,0,1,1,0},{0x30,4,1,1,0xff},{0x30,3,2,1,0xff}};
    const size_t lengths[]={2,5,5,5,5,5,5,5};const int expected[]={0,1,0,0,-1,-1,-1,-1};
    for(int i=0;i<8;i++){unsigned char *p=(unsigned char *)values[i];int ca=0,path=0;int rc=x509_get_basic_constraints(&p,p+lengths[i],&ca,&path);CHECK(expected[i]<0?rc!=0:!rc&&ca==expected[i]);}
    printf("PASS tls-security-unit %d\n",checks);return 0;
}
