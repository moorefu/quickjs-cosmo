#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include "libc/str/str.h"
#include "backend.h"
#include "policy.h"
#include "../resources.h"
#include "third_party/mbedtls/net_sockets.h"
typedef union Block Block;
union Block {max_align_t alignment;struct {size_t size;Block *next;int used;} v;};
struct QjsTls {QjsTlsPolicy policy;mbedtls_ssl_context ssl;Block *blocks;int fd,rc;const char *resource_error;uint32_t flags;};
static _Thread_local QjsTls *current;
/* All backend allocations come from owner-prepaid storage. No JS allocator is
   entered by the pump thread. First-fit blocks coalesce and wipe on release. */
void *__wrap_malloc(size_t size){
    if(!current||size>SIZE_MAX-sizeof(Block))return NULL;
    size=(size+sizeof(Block)-1)/sizeof(Block)*sizeof(Block);if(!size)size=sizeof(Block);
    for(Block *b=current->blocks;b;b=b->v.next)if(!b->v.used&&b->v.size>=size){
        if(b->v.size>=size+2*sizeof(Block)){Block *next=(void *)((unsigned char *)(b+1)+size);next->v=(typeof(next->v)){b->v.size-size-sizeof(Block),b->v.next,0};b->v.next=next;b->v.size=size;}
        b->v.used=1;return b+1;
    }return NULL;
}
void *__wrap_calloc(size_t count,size_t size){if(count&&size>SIZE_MAX/count)return NULL;void *p=__wrap_malloc(count*size);if(p)memset(p,0,count*size);return p;}
/* Nightly MPI opportunistically uses the host allocator's in-place extension.
   Our blocks have their own metadata; failed growth uses its calloc fallback. */
void *__wrap_realloc_in_place(void *p,size_t size){return p&&((Block *)p-1)->v.size>=size?p:NULL;}
void __wrap_free(void *p){
    if(!p)return;Block *b=(Block *)p-1;explicit_bzero(p,b->v.size);b->v.used=0;
    if(!current)return;
    for(Block *v=current->blocks;v&&v->v.next;)if(!v->v.used&&!v->v.next->v.used){v->v.size+=sizeof(Block)+v->v.next->v.size;v->v.next=v->v.next->v.next;}else v=v->v.next;
}
static int send_bytes(void *opaque,const unsigned char *data,size_t size){
    QjsTls *tls=opaque;ssize_t n=send(tls->fd,data,size,MSG_NOSIGNAL);
    return n>=0?n:errno==EAGAIN||errno==EWOULDBLOCK||errno==EINTR?MBEDTLS_ERR_SSL_WANT_WRITE:MBEDTLS_ERR_NET_SEND_FAILED;
}
static int recv_bytes(void *opaque,unsigned char *data,size_t size){
    QjsTls *tls=opaque;ssize_t n=recv(tls->fd,data,size,0);
    return n>=0?n:errno==EAGAIN||errno==EWOULDBLOCK||errno==EINTR?MBEDTLS_ERR_SSL_WANT_READ:MBEDTLS_ERR_NET_RECV_FAILED;
}
static QjsTls *create(void *memory,size_t size,int fd,const char *identity,const char *sni,const unsigned char *ca,size_t length){
    uintptr_t start=((uintptr_t)memory+_Alignof(QjsTls)-1)&~(uintptr_t)(_Alignof(QjsTls)-1);
    QjsTls *tls=(void *)start;memset(tls,0,sizeof(*tls));tls->fd=fd;
    uintptr_t first=(start+sizeof(*tls)+sizeof(Block)-1)/sizeof(Block)*sizeof(Block);
    tls->blocks=(void *)first;tls->blocks->v=(typeof(tls->blocks->v)){(uintptr_t)memory+size-first-sizeof(Block),NULL,0};current=tls;
    mbedtls_ssl_init(&tls->ssl);
    if(!ca){CosmoResourceView view;int rc=js_cosmo_resource_open(COSMO_RESOURCE_CA,&view);if(rc)tls->resource_error=js_cosmo_resource_error(rc);else{ca=view.data;length=view.size;js_cosmo_resource_close(&view);}}
    if(!ca){tls->rc=MBEDTLS_ERR_X509_FILE_IO_ERROR;current=NULL;return tls;}
    tls->rc=qjs_tls_policy_init(&tls->policy,identity,ca,length);
    if(!tls->rc)tls->rc=qjs_tls_policy_setup_sni(&tls->policy,&tls->ssl,sni);
    if(!tls->rc)mbedtls_ssl_set_bio(&tls->ssl,tls,send_bytes,recv_bytes,NULL);
    current=NULL;return tls;
}
static int result(QjsTls *tls,int rc){tls->rc=rc;tls->flags=mbedtls_ssl_get_verify_result(&tls->ssl);return rc==MBEDTLS_ERR_SSL_WANT_READ||rc==MBEDTLS_ERR_SSL_WANT_WRITE?QJS_TLS_AGAIN:rc<0?QJS_TLS_FAILURE:rc;}
static int handshake(QjsTls *tls){if(tls->rc&&tls->rc!=MBEDTLS_ERR_SSL_WANT_READ&&tls->rc!=MBEDTLS_ERR_SSL_WANT_WRITE)return QJS_TLS_FAILURE;current=tls;int rc=mbedtls_ssl_handshake(&tls->ssl);current=NULL;return result(tls,rc);}
static int read_bytes(QjsTls *tls,unsigned char *data,size_t length){current=tls;int rc=mbedtls_ssl_read(&tls->ssl,data,length);current=NULL;if(rc==MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY)return 0;/* A bare TCP EOF is a truncated TLS stream. */if(!rc)rc=MBEDTLS_ERR_SSL_CONN_EOF;return result(tls,rc);}
static int write_bytes(QjsTls *tls,const unsigned char *data,size_t length){current=tls;int rc=mbedtls_ssl_write(&tls->ssl,data,length>16384?16384:length);current=NULL;return result(tls,rc);}
static int end(QjsTls *tls){current=tls;int rc=mbedtls_ssl_close_notify(&tls->ssl);current=NULL;return result(tls,rc);}
static int pending(QjsTls *tls){return mbedtls_ssl_check_pending(&tls->ssl);}
static int want_write(QjsTls *tls){return tls->rc==MBEDTLS_ERR_SSL_WANT_WRITE;}
static const char *error(QjsTls *tls){uint32_t f=tls->flags;
    if(tls->resource_error)return tls->resource_error;
    if(f&MBEDTLS_X509_BADCERT_CN_MISMATCH)return "ERR_TLS_CERT_ALTNAME_INVALID";
    if(f&MBEDTLS_X509_BADCERT_EXPIRED)return "CERT_HAS_EXPIRED";
    if(f&MBEDTLS_X509_BADCERT_FUTURE)return "CERT_NOT_YET_VALID";
    if(f&MBEDTLS_X509_BADCERT_NOT_TRUSTED)return "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
    if(tls->rc==MBEDTLS_ERR_SSL_ALLOC_FAILED||tls->rc==MBEDTLS_ERR_X509_ALLOC_FAILED)return "ERR_TLS_OUT_OF_MEMORY";
    return "ERR_SSL_TLS_FAILURE";
}
static const char *cipher(QjsTls *tls){return mbedtls_ssl_get_ciphersuite(&tls->ssl);}
static void release(QjsTls *tls){current=tls;mbedtls_ssl_free(&tls->ssl);qjs_tls_policy_free(&tls->policy);current=NULL;}
static const char *default_ca(void){return js_cosmo_default_ca();}
static int validate_ca(void *memory,size_t size,const unsigned char *ca,size_t length){QjsTls *tls=create(memory,size,-1,"localhost",NULL,ca,length);if(!tls)return 0;int valid=!tls->rc;release(tls);return valid;}
const QjsTlsBackend *qjs_tls_backend_api(void){static const QjsTlsBackend api={create,handshake,read_bytes,write_bytes,end,pending,want_write,error,cipher,release,default_ca,validate_ca};return &api;}
