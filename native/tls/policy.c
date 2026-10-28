#include <arpa/inet.h>
#include <cosmo.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <sys/random.h>
#include "policy.h"
#include "third_party/mbedtls/entropy.h"
#include "third_party/mbedtls/ssl_ciphersuites.h"
/* Reuse the pinned, patched name verifier without exporting a second matcher. */
#include "third_party/mbedtls/x509_crt.c"
static int random_bytes(void *unused,unsigned char *data,size_t size){
    while(size){
        ssize_t count=getrandom(data,size,IsLinux()?GRND_RANDOM:0);
        if(count<0&&errno==EINTR)continue;
        if(count<=0)return MBEDTLS_ERR_ENTROPY_SOURCE_FAILED;
        data+=count;size-=count;
    }
    return 0;
}
static int verify_identity(void *opaque,mbedtls_x509_crt *cert,int depth,uint32_t *flags){
    QjsTlsPolicy *policy=opaque;
    if(!depth && !policy->ip_length)x509_crt_verify_name(cert,policy->identity,flags);
    if(!depth && policy->ip_length){
        *flags|=MBEDTLS_X509_BADCERT_CN_MISMATCH;
        for(const mbedtls_x509_sequence *san=&cert->subject_alt_names;san;san=san->next)
            if(san->buf.tag==(MBEDTLS_ASN1_CONTEXT_SPECIFIC|7) && san->buf.len==(size_t)policy->ip_length && !memcmp(san->buf.p,policy->ip,policy->ip_length)){
                *flags&=~MBEDTLS_X509_BADCERT_CN_MISMATCH;break;
            }
    }
    return 0;
}
void qjs_tls_policy_free(QjsTlsPolicy *policy){mbedtls_ssl_config_free(&policy->config);mbedtls_x509_crt_free(&policy->roots);free(policy->identity);memset(policy,0,sizeof(*policy));}
int qjs_tls_policy_init(QjsTlsPolicy *policy,const char *identity,const unsigned char *ca,size_t length){
    static const uint16_t suites[]={MBEDTLS_TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,MBEDTLS_TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
        MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,MBEDTLS_TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,0};
    static const uint8_t hashes[]={MBEDTLS_MD_SHA256,MBEDTLS_MD_SHA384,MBEDTLS_MD_SHA512,MBEDTLS_MD_NONE};
    static const mbedtls_ecp_group_id curves[]={MBEDTLS_ECP_DP_CURVE25519,MBEDTLS_ECP_DP_SECP256R1,MBEDTLS_ECP_DP_SECP384R1,MBEDTLS_ECP_DP_NONE};
    memset(policy,0,sizeof(*policy));mbedtls_ssl_config_init(&policy->config);mbedtls_x509_crt_init(&policy->roots);
    if(!identity||!*identity||strlen(identity)>253||!ca||!length||length>4*1024*1024||memchr(ca,0,length))return MBEDTLS_ERR_SSL_BAD_INPUT_DATA;
    policy->identity=calloc(1,strlen(identity)+1);if(!policy->identity)return MBEDTLS_ERR_SSL_ALLOC_FAILED;strcpy(policy->identity,identity);
    unsigned char *terminated=calloc(1,length+1);if(!terminated){qjs_tls_policy_free(policy);return MBEDTLS_ERR_SSL_ALLOC_FAILED;}memcpy(terminated,ca,length);
    int rc=mbedtls_x509_crt_parse(&policy->roots,terminated,length+1);free(terminated);
    if(rc||!policy->roots.raw.p){qjs_tls_policy_free(policy);return rc?rc:MBEDTLS_ERR_X509_BAD_INPUT_DATA;}
    if((rc=mbedtls_ssl_config_defaults(&policy->config,MBEDTLS_SSL_IS_CLIENT,MBEDTLS_SSL_TRANSPORT_STREAM,MBEDTLS_SSL_PRESET_DEFAULT))){qjs_tls_policy_free(policy);return rc;}
    policy->ip_length=inet_pton(AF_INET6,identity,policy->ip)==1?16:inet_pton(AF_INET,identity,policy->ip)==1?4:0;
    mbedtls_ssl_conf_min_version(&policy->config,MBEDTLS_SSL_MAJOR_VERSION_3,MBEDTLS_SSL_MINOR_VERSION_3);
    mbedtls_ssl_conf_max_version(&policy->config,MBEDTLS_SSL_MAJOR_VERSION_3,MBEDTLS_SSL_MINOR_VERSION_3);
    mbedtls_ssl_conf_authmode(&policy->config,MBEDTLS_SSL_VERIFY_REQUIRED);
    mbedtls_ssl_conf_ca_chain(&policy->config,&policy->roots,NULL);mbedtls_ssl_conf_verify(&policy->config,verify_identity,policy);
    mbedtls_ssl_conf_rng(&policy->config,random_bytes,NULL);mbedtls_ssl_conf_ciphersuites(&policy->config,suites);
    mbedtls_ssl_conf_sig_hashes(&policy->config,hashes);mbedtls_ssl_conf_cert_profile(&policy->config,&mbedtls_x509_crt_profile_next);
    mbedtls_ssl_conf_curves(&policy->config,curves);mbedtls_ssl_conf_session_tickets(&policy->config,MBEDTLS_SSL_SESSION_TICKETS_DISABLED);
#if defined(MBEDTLS_SSL_RENEGOTIATION)
    mbedtls_ssl_conf_renegotiation(&policy->config,MBEDTLS_SSL_RENEGOTIATION_DISABLED);
#endif
    policy->config.disable_compression=true;
    return 0;
}
int qjs_tls_policy_setup(QjsTlsPolicy *policy,mbedtls_ssl_context *ssl){
    if(!policy->identity||!*policy->identity)return MBEDTLS_ERR_SSL_BAD_INPUT_DATA;
    int rc=mbedtls_ssl_setup(ssl,&policy->config);if(rc)return rc;
    /* IP identities are checked unconditionally by verify_identity, and must
       not be sent as a DNS SNI extension. DNS uses the library's name checks. */
    return policy->ip_length?0:mbedtls_ssl_set_hostname(ssl,policy->identity);
}
int qjs_tls_policy_setup_sni(QjsTlsPolicy *policy,mbedtls_ssl_context *ssl,const char *servername){
    if(!policy->identity||!*policy->identity)return MBEDTLS_ERR_SSL_BAD_INPUT_DATA;
    int rc=mbedtls_ssl_setup(ssl,&policy->config);if(rc)return rc;
    /* Identity is always verified by the leaf callback, independently of SNI. */
    return servername&&*servername?mbedtls_ssl_set_hostname(ssl,servername):0;
}
