#ifndef QUICKJS_COSMO_COMPRESSION_STREAM_H
#define QUICKJS_COSMO_COMPRESSION_STREAM_H
#include "core.h"
typedef struct QCStream QCStream;
QCStream *qc_stream_create(int,const QCOptions *,QCAllocator *,QCResult *);
QCResult qc_stream_step(QCStream *,const uint8_t *,size_t,uint8_t *,size_t,int,int,int);
void qc_stream_free(QCStream *);
int qc_stream_reset(QCStream *);
#endif
