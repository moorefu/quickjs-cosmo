#ifndef QUICKJS_COSMO_TLS_POLICY_H
#define QUICKJS_COSMO_TLS_POLICY_H
#include "third_party/mbedtls/ssl.h"
#include "third_party/mbedtls/x509_crt.h"
/* Private implementation type; never install these backend headers in the SDK. */
typedef struct {
    mbedtls_ssl_config config;
    mbedtls_x509_crt roots;
    unsigned char ip[16];
    int ip_length;
    char *identity;
} QjsTlsPolicy;
int qjs_tls_policy_init(QjsTlsPolicy *,const char *,const unsigned char *,size_t);
int qjs_tls_policy_setup(QjsTlsPolicy *,mbedtls_ssl_context *);
void qjs_tls_policy_free(QjsTlsPolicy *);
#endif
