#ifndef QUICKJS_COSMO_COMPRESSION_CORE_H
#define QUICKJS_COSMO_COMPRESSION_CORE_H
#include <stddef.h>
#include <stdint.h>
enum { QC_DEFLATE, QC_INFLATE, QC_GZIP, QC_GUNZIP, QC_RAW, QC_UNRAW, QC_UNZIP,
       QC_ZSTD, QC_UNZSTD, QC_LZ4, QC_UNLZ4, QC_BZIP2, QC_UNBZIP2 };
enum { QC_OK, QC_MEMORY=-1, QC_LIMIT=-2, QC_DATA=-3, QC_PARAMETER=-4, QC_TRAILING=-5 };
typedef struct { void *opaque; void *(*allocate)(void *,size_t); void (*release)(void *,void *); int failed; } QCAllocator;
typedef struct { uint8_t *data; size_t length,capacity; } QCBuffer;
typedef struct {
    size_t maximum,chunk;
    int window,level,memory,strategy,finish,reject;
    const uint8_t *dictionary; size_t dictionary_length;
    int parameters[64][2]; size_t parameter_count;
    uint64_t pledged;
    int checksum,block_size,small;
} QCOptions;
typedef struct { QCBuffer output; size_t consumed; int status,backend; char message[160]; } QCResult;
QCAllocator *qc_allocator_enter(QCAllocator *);
void qc_allocator_leave(QCAllocator *);
void *qc_allocate(QCAllocator *,size_t);
void qc_free(void *);
QCResult qc_run(int,const uint8_t *,size_t,const QCOptions *,QCAllocator *);
uint32_t qc_checksum(int,const uint8_t *,size_t,uint32_t);
const char *qc_version(int);
#endif
