#include <string.h>
#include <stdio.h>
#include "third_party/zlib/zlib.h"
#include "stream.h"
#if QJS_COMPRESSION_FULL
#define ZSTD_STATIC_LINKING_ONLY
#include "third_party/zstd/zstd.h"
#include "third_party/zstd/zstd_errors.h"
#endif

struct QCStream {
    QCAllocator *owner;
    QCOptions options;
    int mode,compress,ended;
    z_stream z;
    gz_header header;
#if QJS_COMPRESSION_FULL
    ZSTD_CCtx *encoder;
    ZSTD_DCtx *decoder;
#endif
};
static void *alloc(void *owner,size_t size){return qc_allocate(owner,size);}
static void release(void *owner,void *data){qc_free(data);}
static void *zalloc(void *owner,unsigned count,unsigned size){
    if(count && size>SIZE_MAX/count)return NULL;
    void *data=qc_allocate(owner,(size_t)count*size);if(data)memset(data,0,(size_t)count*size);return data;
}
static void fail(QCResult *result,int status,int code,const char *message){
    result->status=status;result->backend=code;snprintf(result->message,sizeof(result->message),"%s",message?message:"Compression stream failed");
}
void qc_stream_free(QCStream *s){
    if(!s)return;
    if(s->mode<=QC_UNZIP){if(s->compress)deflateEnd(&s->z);else inflateEnd(&s->z);}
#if QJS_COMPRESSION_FULL
    ZSTD_freeCCtx(s->encoder);ZSTD_freeDCtx(s->decoder);
#endif
    qc_free((void *)s->options.dictionary);qc_free(s);
}
QCStream *qc_stream_create(int mode,const QCOptions *options,QCAllocator *owner,QCResult *result){
    if(mode<0 || mode>(QJS_COMPRESSION_FULL?QC_UNZSTD:QC_UNZIP)){fail(result,QC_PARAMETER,0,"Invalid compression stream mode");return NULL;}
    QCStream *s=qc_allocate(owner,sizeof(*s));
    if(!s){fail(result,QC_MEMORY,0,"Compression state allocation failed");return NULL;}
    memset(s,0,sizeof(*s));s->owner=owner;s->options=*options;s->options.dictionary=NULL;s->mode=mode;
    s->compress=mode==QC_DEFLATE || mode==QC_GZIP || mode==QC_RAW || mode==QC_ZSTD;
    if(options->dictionary_length){
        void *dictionary=qc_allocate(owner,options->dictionary_length);
        if(!dictionary){fail(result,QC_MEMORY,0,"Dictionary allocation failed");goto failed;}
        memcpy(dictionary,options->dictionary,options->dictionary_length);s->options.dictionary=dictionary;
    }
    if(mode<=QC_UNZIP){
        int bits=options->window;if(mode==QC_RAW && bits==8)bits=9;
        if(mode==QC_GZIP || mode==QC_GUNZIP)bits+=16;
        if(mode==QC_RAW || mode==QC_UNRAW)bits=-bits;
        if(mode==QC_UNZIP)bits+=32;
        s->z.zalloc=zalloc;s->z.zfree=release;s->z.opaque=owner;
        int code=s->compress?deflateInit2(&s->z,options->level,Z_DEFLATED,bits,options->memory,options->strategy):inflateInit2(&s->z,bits);
        if(code!=Z_OK){fail(result,code==Z_MEM_ERROR?QC_MEMORY:QC_PARAMETER,code,"Zlib initialization failed");goto failed;}
        if(!s->compress && (mode==QC_GUNZIP || mode==QC_UNZIP))inflateGetHeader(&s->z,&s->header);
        if(options->dictionary_length && (mode==QC_DEFLATE || mode==QC_RAW || mode==QC_UNRAW)){
            code=s->compress?deflateSetDictionary(&s->z,s->options.dictionary,options->dictionary_length):inflateSetDictionary(&s->z,s->options.dictionary,options->dictionary_length);
            if(code!=Z_OK){fail(result,QC_DATA,code,"Invalid dictionary");goto failed;}
        }
    }
#if QJS_COMPRESSION_FULL
    else{
        ZSTD_customMem memory={alloc,release,owner};
        if(s->compress)s->encoder=ZSTD_createCCtx_advanced(memory);else s->decoder=ZSTD_createDCtx_advanced(memory);
        if(!(s->encoder || s->decoder)){fail(result,QC_MEMORY,64,"Zstd initialization failed");goto failed;}
        for(size_t i=0;i<options->parameter_count;i++){
            int key=options->parameters[i][0],value=options->parameters[i][1];
            size_t code=s->compress?ZSTD_CCtx_setParameter(s->encoder,key,value):ZSTD_DCtx_setParameter(s->decoder,key,value);
            if(ZSTD_isError(code)){fail(result,QC_PARAMETER,ZSTD_getErrorCode(code),ZSTD_getErrorName(code));goto failed;}
        }
        size_t code=s->compress?ZSTD_CCtx_loadDictionary(s->encoder,s->options.dictionary,options->dictionary_length):ZSTD_DCtx_loadDictionary(s->decoder,s->options.dictionary,options->dictionary_length);
        if(!ZSTD_isError(code) && s->compress)code=ZSTD_CCtx_setPledgedSrcSize(s->encoder,options->pledged);
        if(ZSTD_isError(code)){fail(result,QC_PARAMETER,ZSTD_getErrorCode(code),ZSTD_getErrorName(code));goto failed;}
    }
#endif
    return s;
failed:qc_stream_free(s);return NULL;
}
QCResult qc_stream_step(QCStream *s,const uint8_t *input,size_t length,uint8_t *output,size_t capacity,int flush,int level,int strategy){
    QCResult r={0};r.output.data=output;r.output.capacity=capacity;
    if(s->ended && !length){r.backend=1;return r;}
    if(s->mode<=QC_UNZIP){
        int gzip=s->mode==QC_GUNZIP || (s->mode==QC_UNZIP && s->header.done==1);
        if(s->ended && !s->compress){
            if(!length)return r;
            if(s->options.reject){fail(&r,QC_TRAILING,0,"Trailing junk after stream end");return r;}
            if(!gzip || !input[0])return r;
            inflateReset(&s->z);s->ended=0;
        }
        s->z.next_in=(void *)input;s->z.avail_in=length;s->z.next_out=output;s->z.avail_out=capacity;
        int code=Z_OK;
        if(level!=-100){
            code=deflateParams(&s->z,level,strategy);
            if(code!=Z_OK && code!=Z_BUF_ERROR)goto zdone;
        }
        code=s->compress?deflate(&s->z,flush):inflate(&s->z,flush);
        if(code==Z_NEED_DICT && s->options.dictionary_length){
            code=inflateSetDictionary(&s->z,s->options.dictionary,s->options.dictionary_length);
            if(code==Z_OK)code=inflate(&s->z,flush);else if(code==Z_DATA_ERROR)code=Z_NEED_DICT;
        }
zdone:
        r.consumed=length-s->z.avail_in;r.output.length=capacity-s->z.avail_out;
        if(code==Z_STREAM_END)s->ended=1;
        else if(code!=Z_OK && code!=Z_BUF_ERROR)fail(&r,code==Z_MEM_ERROR?QC_MEMORY:QC_DATA,code,s->z.msg);
        else if(flush==Z_FINISH && s->z.avail_out && !s->ended)fail(&r,QC_DATA,Z_BUF_ERROR,"unexpected end of file");
        s->z.next_in=NULL;s->z.next_out=NULL;s->z.avail_in=s->z.avail_out=0;
    }
#if QJS_COMPRESSION_FULL
    else{
        ZSTD_inBuffer in={input,length,0};ZSTD_outBuffer out={output,capacity,0};
        size_t code=s->compress?ZSTD_compressStream2(s->encoder,&out,&in,flush):ZSTD_decompressStream(s->decoder,&out,&in);
        r.consumed=in.pos;r.output.length=out.pos;
        if(ZSTD_isError(code))fail(&r,QC_DATA,ZSTD_getErrorCode(code),ZSTD_getErrorName(code));
        else{
            s->ended=code==0 && (!s->compress || flush==ZSTD_e_end);
            if(!s->compress && flush==ZSTD_e_end && in.pos==in.size && out.pos<out.size && code)fail(&r,QC_DATA,Z_BUF_ERROR,"unexpected end of file");
        }
    }
#endif
    if(!r.status)r.backend=s->ended;
    return r;
}
int qc_stream_reset(QCStream *s){
    s->ended=0;
    if(s->mode<=QC_UNZIP){
        int code=s->compress?deflateReset(&s->z):inflateReset(&s->z);
        if(code==Z_OK && s->options.dictionary_length && (s->mode==QC_DEFLATE || s->mode==QC_RAW || s->mode==QC_UNRAW))
            code=s->compress?deflateSetDictionary(&s->z,s->options.dictionary,s->options.dictionary_length):inflateSetDictionary(&s->z,s->options.dictionary,s->options.dictionary_length);
        return code;
    }
#if QJS_COMPRESSION_FULL
    return s->compress?ZSTD_CCtx_reset(s->encoder,ZSTD_reset_session_only):ZSTD_DCtx_reset(s->decoder,ZSTD_reset_session_only);
#else
    return Z_STREAM_ERROR;
#endif
}
