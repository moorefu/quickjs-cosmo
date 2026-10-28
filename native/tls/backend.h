#ifndef QJS_TLS_BACKEND_H
#define QJS_TLS_BACKEND_H
#include <stddef.h>
#include <stdint.h>
enum {QJS_TLS_ARENA=8*1024*1024,QJS_TLS_AGAIN=-1,QJS_TLS_FAILURE=-2};
typedef struct QjsTls QjsTls;
typedef struct {
    QjsTls *(*create)(void *,size_t,int,const char *,const char *,const unsigned char *,size_t);
    int (*handshake)(QjsTls *);
    int (*read)(QjsTls *,unsigned char *,size_t);
    int (*write)(QjsTls *,const unsigned char *,size_t);
    int (*end)(QjsTls *);
    int (*pending)(QjsTls *);
    int (*want_write)(QjsTls *);
    const char *(*error)(QjsTls *);
    const char *(*cipher)(QjsTls *);
    void (*free)(QjsTls *);
    const char *(*default_ca)(void);
    int (*validate_ca)(void *,size_t,const unsigned char *,size_t);
} QjsTlsBackend;
const QjsTlsBackend *qjs_tls_backend_api(void);
#endif
