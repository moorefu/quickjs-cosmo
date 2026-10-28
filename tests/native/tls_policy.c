#include <arpa/inet.h>
#include <errno.h>
#include <netdb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>
#include "tls/policy.h"
#include "third_party/mbedtls/ssl_ciphersuites.h"
#include "third_party/mbedtls/entropy.h"
static int fail_rng,random_calls;
ssize_t __real_getrandom(void *,size_t,unsigned);
ssize_t __wrap_getrandom(void *data,size_t size,unsigned flags){
    random_calls++;if(fail_rng){errno=EIO;return -1;}return __real_getrandom(data,size,flags);
}
static int transmit(void *opaque,const unsigned char *data,size_t length){ssize_t n=send(*(int *)opaque,data,length,MSG_NOSIGNAL);return n<0?MBEDTLS_ERR_SSL_INTERNAL_ERROR:(int)n;}
static int receive(void *opaque,unsigned char *data,size_t length){ssize_t n=recv(*(int *)opaque,data,length,0);return n<0?MBEDTLS_ERR_SSL_INTERNAL_ERROR:(int)n;}
int main(int argc,char **argv){
    if(argc==4 && !strcmp(argv[1],"--cert")){
        mbedtls_x509_crt cert;mbedtls_x509_crt_init(&cert);int rc=mbedtls_x509_crt_parse_file(&cert,argv[2]),expected=atoi(argv[3]);
        int pass=expected<0?rc!=0:!rc&&cert.ca_istrue==expected;if(!pass)fprintf(stderr,"certificate parse rc=%d CA=%d\n",rc,cert.ca_istrue);mbedtls_x509_crt_free(&cert);if(!pass)return 3;puts("PASS tls-policy-cert");return 0;
    }
    if(argc!=6)return 3;
    const char *host=argv[1],*port=argv[2],*identity=argv[3];fail_rng=atoi(argv[5]);
    FILE *file=fopen(argv[4],"rb");if(!file)return 3;fseek(file,0,SEEK_END);long length=ftell(file);rewind(file);
    unsigned char *ca=malloc(length);if(!ca){fclose(file);return 3;}if(fread(ca,1,length,file)!=(size_t)length){free(ca);fclose(file);return 3;}fclose(file);
    QjsTlsPolicy policy;int rc=qjs_tls_policy_init(&policy,identity,ca,length);free(ca);if(rc){qjs_tls_policy_free(&policy);printf("REJECT init %d\n",rc);return 2;}
    mbedtls_ssl_context ssl;mbedtls_ssl_init(&ssl);rc=qjs_tls_policy_setup(&policy,&ssl);
    if(rc)goto done;
    if(policy.config.min_minor_ver!=3||policy.config.max_minor_ver!=3||policy.config.authmode!=MBEDTLS_SSL_VERIFY_REQUIRED||!policy.config.disable_compression||policy.config.session_tickets){rc=-1;goto done;}
    struct addrinfo hints={.ai_socktype=SOCK_STREAM},*addresses=NULL;
    if(getaddrinfo(host,port,&hints,&addresses)){rc=-1;goto done;}
    int fd=-1;for(struct addrinfo *p=addresses;p;p=p->ai_next){fd=socket(p->ai_family,p->ai_socktype,p->ai_protocol);if(fd>=0 && !connect(fd,p->ai_addr,p->ai_addrlen))break;if(fd>=0)close(fd);fd=-1;}freeaddrinfo(addresses);
    if(fd<0){rc=-1;goto done;}
    struct timeval timeout={5,0};setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout));setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
    mbedtls_ssl_set_bio(&ssl,&fd,transmit,receive,NULL);rc=mbedtls_ssl_handshake(&ssl);
    if(!rc && mbedtls_ssl_get_verify_result(&ssl))rc=MBEDTLS_ERR_X509_CERT_VERIFY_FAILED;
    if(!rc){if(strcmp(mbedtls_ssl_get_version(&ssl),"TLSv1.2"))rc=-1;else printf("ACCEPT %s %s\n",mbedtls_ssl_get_version(&ssl),mbedtls_ssl_get_ciphersuite(&ssl));}
    close(fd);
done:
    if(rc)printf("REJECT handshake %d flags=%u rng=%d\n",rc,(unsigned)mbedtls_ssl_get_verify_result(&ssl),random_calls);
    if(fail_rng&&!random_calls)rc=-1;
    mbedtls_ssl_free(&ssl);qjs_tls_policy_free(&policy);return rc?2:0;
}
