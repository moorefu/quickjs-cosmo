#include <limits.h>
#include <stdio.h>
#include <string.h>
#include "libc/str/str.h"
#include "libc/nexgen32e/crc32.h"
#include "third_party/zlib/zlib.h"
#define ZSTD_STATIC_LINKING_ONLY
#include "third_party/zstd/zstd.h"
#include "third_party/zstd/zstd_errors.h"
#include "third_party/lz4cli/lz4.h"
#include "third_party/lz4cli/lz4frame.h"
#include "third_party/bzip2/bzlib.h"
#include "core.h"

static void *allocate(void *owner,size_t size) { return qc_allocate(owner,size); }
static void release(void *owner,void *data) { qc_free(data); }
static void *zallocate(void *owner,unsigned count,unsigned size) {
    if (count && size>SIZE_MAX/count) return NULL;
    void *data=qc_allocate(owner,(size_t)count*size);
    if (data) memset(data,0,(size_t)count*size);
    return data;
}
static void *bzallocate(void *owner,int count,int size) {
    return count<0 || size<0?NULL:zallocate(owner,count,size);
}
static int error(QCResult *result,int status,int backend,const char *message) {
    result->status=status; result->backend=backend;
    snprintf(result->message,sizeof(result->message),"%s",message?message:"Compression operation failed");
    return status;
}
static int reserve(QCResult *result,const QCOptions *options,QCAllocator *owner) {
    QCBuffer *out=&result->output;
    if (out->length<out->capacity) return 0;
    size_t limit=options->maximum+1;
    if (out->length>=limit) return error(result,QC_LIMIT,0,"Output exceeds maxOutputLength");
    size_t capacity=out->capacity?out->capacity*2:options->chunk;
    if (capacity>limit) capacity=limit;
    if (capacity<=out->capacity) capacity=limit;
    uint8_t *next=qc_allocate(owner,capacity);
    if (!next) return error(result,QC_MEMORY,0,"Compression allocation failed");
    if (out->length) memcpy(next,out->data,out->length);
    qc_free(out->data); out->data=next; out->capacity=capacity; return 0;
}
static size_t room(QCResult *result,const QCOptions *options) {
    size_t count=result->output.capacity-result->output.length;
    return count>options->chunk?options->chunk:count;
}
static int produced(QCResult *result,size_t length,const QCOptions *options) {
    result->output.length+=length;
    return result->output.length>options->maximum?error(result,QC_LIMIT,0,"Output exceeds maxOutputLength"):0;
}
static void zlib_run(int mode,const uint8_t *input,size_t length,const QCOptions *options,QCAllocator *owner,QCResult *result) {
    z_stream stream={0}; stream.zalloc=zallocate; stream.zfree=release; stream.opaque=owner;
    int compress=mode==QC_DEFLATE || mode==QC_GZIP || mode==QC_RAW;
    int bits=options->window;
    if (mode==QC_RAW && bits==8) bits=9;
    if (mode==QC_GZIP || mode==QC_GUNZIP) bits+=16;
    if (mode==QC_RAW || mode==QC_UNRAW) bits=-bits;
    if (mode==QC_UNZIP) bits+=32;
    int gzip=mode==QC_GUNZIP || (mode==QC_UNZIP && length>=2 && input[0]==0x1f && input[1]==0x8b);
    int code=compress?deflateInit2(&stream,options->level,Z_DEFLATED,bits,options->memory,options->strategy):inflateInit2(&stream,bits);
    if (code!=Z_OK) { error(result,code==Z_MEM_ERROR?QC_MEMORY:QC_DATA,code,"Zlib initialization failed"); return; }
    stream.next_in=(void *)input; stream.avail_in=length;
    if (options->dictionary_length && (mode==QC_DEFLATE || mode==QC_RAW || mode==QC_UNRAW)) {
        code=compress?deflateSetDictionary(&stream,options->dictionary,options->dictionary_length):
            inflateSetDictionary(&stream,options->dictionary,options->dictionary_length);
        if (code!=Z_OK) { error(result,QC_DATA,code,stream.msg); goto done; }
    }
    for (;;) {
        if (reserve(result,options,owner)) break;
        size_t available=room(result,options);
        stream.next_out=result->output.data+result->output.length; stream.avail_out=available;
        code=compress?deflate(&stream,options->finish):inflate(&stream,options->finish);
        if (code==Z_NEED_DICT && options->dictionary_length) {
            code=inflateSetDictionary(&stream,options->dictionary,options->dictionary_length);
            if (code==Z_OK) code=inflate(&stream,options->finish);
            else if (code==Z_DATA_ERROR) code=Z_NEED_DICT;
        }
        if (!compress && gzip && code==Z_STREAM_END && stream.avail_in && !options->reject && stream.next_in[0]) {
            /* Reset preserves next_in/out and avail counts for the next member. */
            code=inflateReset(&stream);
            if (code==Z_OK) code=inflate(&stream,options->finish);
            while (code==Z_STREAM_END && stream.avail_in && stream.next_in[0]) {
                code=inflateReset(&stream);
                if (code==Z_OK) code=inflate(&stream,options->finish);
            }
        }
        if (produced(result,available-stream.avail_out,options)) break;
        if (code!=Z_OK && code!=Z_STREAM_END && code!=Z_BUF_ERROR) {
            error(result,code==Z_MEM_ERROR?QC_MEMORY:QC_DATA,code,stream.msg); break;
        }
        if (stream.avail_out && options->finish==Z_FINISH && code!=Z_STREAM_END) {
            error(result,QC_DATA,Z_BUF_ERROR,"unexpected end of file"); break;
        }
        if (stream.avail_out || code==Z_STREAM_END) break;
    }
    result->consumed=length-stream.avail_in;
    if (!result->status && stream.avail_in && options->reject) error(result,QC_TRAILING,0,"Trailing junk after stream end");
done:
    if (compress) deflateEnd(&stream); else inflateEnd(&stream);
}
static int zstd_error(QCResult *result,size_t code,int parameter) {
    if (!ZSTD_isError(code)) return 0;
    return error(result,parameter?QC_PARAMETER:QC_DATA,ZSTD_getErrorCode(code),ZSTD_getErrorName(code));
}
static void zstd_run(int mode,const uint8_t *input,size_t length,const QCOptions *options,QCAllocator *owner,QCResult *result) {
    ZSTD_customMem memory={allocate,release,owner};
    int compress=mode==QC_ZSTD;
    ZSTD_CCtx *encoder=compress?ZSTD_createCCtx_advanced(memory):NULL;
    ZSTD_DCtx *decoder=compress?NULL:ZSTD_createDCtx_advanced(memory);
    if (!(compress?(void *)encoder:(void *)decoder)) { error(result,QC_MEMORY,64,"Zstd allocation failed"); return; }
    for (size_t i=0;i<options->parameter_count;i++) {
        int key=options->parameters[i][0],value=options->parameters[i][1];
        if (compress && key==ZSTD_c_nbWorkers && value!=0) { error(result,QC_PARAMETER,40,"Zstd worker threads are not enabled"); goto done; }
        size_t code=compress?ZSTD_CCtx_setParameter(encoder,key,value):ZSTD_DCtx_setParameter(decoder,key,value);
        if (zstd_error(result,code,1)) goto done;
    }
    if (options->dictionary_length) {
        size_t code=compress?ZSTD_CCtx_loadDictionary(encoder,options->dictionary,options->dictionary_length):
            ZSTD_DCtx_loadDictionary(decoder,options->dictionary,options->dictionary_length);
        if (zstd_error(result,code,1)) goto done;
    }
    if (compress && zstd_error(result,ZSTD_CCtx_setPledgedSrcSize(encoder,options->pledged),1)) goto done;
    ZSTD_inBuffer in={input,length,0};
    size_t code=1;
    for (;;) {
        if (reserve(result,options,owner)) break;
        ZSTD_outBuffer out={result->output.data+result->output.length,room(result,options),0};
        size_t before=in.pos;
        code=compress?ZSTD_compressStream2(encoder,&out,&in,options->finish):ZSTD_decompressStream(decoder,&out,&in);
        if (zstd_error(result,code,0) || produced(result,out.pos,options)) break;
        if (compress && !code && options->finish==ZSTD_e_end) break;
        if (!compress && !code && in.pos==in.size) break;
        if (out.pos<out.size) {
            if (!compress && code && in.pos==in.size && options->finish==ZSTD_e_end) error(result,QC_DATA,Z_BUF_ERROR,"unexpected end of file");
            break;
        }
        if (in.pos==before && !out.pos) { error(result,QC_DATA,Z_BUF_ERROR,"No compression progress"); break; }
    }
    result->consumed=in.pos;
    if (!result->status && in.pos<length && options->reject) error(result,QC_TRAILING,0,"Trailing junk after stream end");
    if (!result->status && compress && options->pledged!=ZSTD_CONTENTSIZE_UNKNOWN && in.pos!=options->pledged)
        error(result,QC_DATA,ZSTD_error_srcSize_wrong,"Source size differs from pledgedSrcSize");
done:
    ZSTD_freeCCtx(encoder); ZSTD_freeDCtx(decoder);
}
static void lz4_run(int mode,const uint8_t *input,size_t length,const QCOptions *options,QCAllocator *owner,QCResult *result) {
    if (mode==QC_LZ4) {
        LZ4F_preferences_t prefs={0}; prefs.compressionLevel=options->level;
        prefs.frameInfo.contentChecksumFlag=options->checksum;
        prefs.frameInfo.blockSizeID=options->block_size;
        prefs.frameInfo.contentSize=length;
        size_t bound=LZ4F_compressFrameBound(length,&prefs);
        if (LZ4F_isError(bound)) { error(result,QC_PARAMETER,0,LZ4F_getErrorName(bound)); return; }
        /* Use streaming output below for bounded compression, not a bound-sized allocation. */
        LZ4F_cctx *encoder=NULL;
        size_t code=LZ4F_createCompressionContext(&encoder,LZ4F_VERSION);
        if (LZ4F_isError(code)) { error(result,QC_MEMORY,0,LZ4F_getErrorName(code)); return; }
        size_t block=65536,capacity=LZ4F_compressBound(block,&prefs)+LZ4F_HEADER_SIZE_MAX;
        uint8_t *scratch=qc_allocate(owner,capacity);
        if (!scratch) { error(result,QC_MEMORY,0,"LZ4 allocation failed"); goto end_encode; }
        size_t offset=0;
        for (int stage=0;stage<3;) {
            size_t take=length-offset; if (take>block) take=block;
            if (stage==0) { code=LZ4F_compressBegin(encoder,scratch,capacity,&prefs); stage=length?1:2; }
            else if (stage==1) { code=LZ4F_compressUpdate(encoder,scratch,capacity,input+offset,take,NULL); offset+=take; if (offset==length) stage=2; }
            else { code=LZ4F_compressEnd(encoder,scratch,capacity,NULL); stage=3; }
            if (LZ4F_isError(code)) { error(result,QC_DATA,0,LZ4F_getErrorName(code)); break; }
            if (code>options->maximum-result->output.length) { error(result,QC_LIMIT,0,"Output exceeds maxOutputLength"); break; }
            for (size_t copied=0;copied<code;) {
                if (reserve(result,options,owner)) break;
                size_t count=result->output.capacity-result->output.length;
                if (count>code-copied) count=code-copied;
                memcpy(result->output.data+result->output.length,scratch+copied,count);
                result->output.length+=count; copied+=count;
            }
            if (result->status) break;
        }
        qc_free(scratch); result->consumed=offset;
end_encode: LZ4F_freeCompressionContext(encoder);
    } else {
        LZ4F_dctx *decoder=NULL;
        size_t code=LZ4F_createDecompressionContext(&decoder,LZ4F_VERSION);
        if (LZ4F_isError(code)) { error(result,QC_MEMORY,0,LZ4F_getErrorName(code)); return; }
        size_t offset=0;
        for (;;) {
            if (reserve(result,options,owner)) break;
            size_t consumed=length-offset,available=room(result,options),used=available;
            code=LZ4F_decompress(decoder,result->output.data+result->output.length,&used,input+offset,&consumed,NULL);
            offset+=consumed;
            if (LZ4F_isError(code)) { error(result,QC_DATA,0,LZ4F_getErrorName(code)); break; }
            if (produced(result,used,options)) break;
            if (!code && offset==length) break;
            if (!code && offset<length) { LZ4F_resetDecompressionContext(decoder); continue; }
            if ((!consumed && !used) || (offset==length && used<available)) { error(result,QC_DATA,0,"Truncated LZ4 frame"); break; }
        }
        result->consumed=offset; LZ4F_freeDecompressionContext(decoder);
    }
}
static void bzip_run(int mode,const uint8_t *input,size_t length,const QCOptions *options,QCAllocator *owner,QCResult *result) {
    int compress=mode==QC_BZIP2;
    bz_stream stream={0}; stream.bzalloc=bzallocate; stream.bzfree=release; stream.opaque=owner;
    int code=compress?BZ2_bzCompressInit(&stream,options->level,0,30):BZ2_bzDecompressInit(&stream,0,options->small);
    if (code!=BZ_OK) { error(result,code==BZ_MEM_ERROR?QC_MEMORY:QC_PARAMETER,code,"Bzip2 initialization failed"); return; }
    stream.next_in=(char *)input; stream.avail_in=length;
    for (;;) {
        if (reserve(result,options,owner)) break;
        size_t available=room(result,options);
        stream.next_out=(char *)result->output.data+result->output.length; stream.avail_out=available;
        unsigned before=stream.avail_in;
        code=compress?BZ2_bzCompress(&stream,BZ_FINISH):BZ2_bzDecompress(&stream);
        if (produced(result,available-stream.avail_out,options)) break;
        if (code==BZ_STREAM_END) {
            if (!compress && stream.avail_in) {
                char *next=stream.next_in; unsigned remaining=stream.avail_in;
                BZ2_bzDecompressEnd(&stream);
                memset(&stream,0,sizeof(stream)); stream.bzalloc=bzallocate; stream.bzfree=release; stream.opaque=owner;
                code=BZ2_bzDecompressInit(&stream,0,options->small);
                stream.next_in=next; stream.avail_in=remaining;
                if (code!=BZ_OK) { error(result,QC_MEMORY,code,"Bzip2 allocation failed"); break; }
                continue;
            }
            break;
        }
        if (compress?code!=BZ_FINISH_OK:code!=BZ_OK) { error(result,code==BZ_MEM_ERROR?QC_MEMORY:QC_DATA,code,"Invalid bzip2 stream"); break; }
        if (stream.avail_in==before && stream.avail_out==available) { error(result,QC_DATA,BZ_UNEXPECTED_EOF,"Truncated bzip2 stream"); break; }
    }
    result->consumed=length-stream.avail_in;
    if (compress) BZ2_bzCompressEnd(&stream); else BZ2_bzDecompressEnd(&stream);
}
QCResult qc_run(int mode,const uint8_t *input,size_t length,const QCOptions *options,QCAllocator *owner) {
    QCResult result={0}; QCAllocator *previous=qc_allocator_enter(owner);
    if (mode<=QC_UNZIP) zlib_run(mode,input,length,options,owner,&result);
    else if (mode<=QC_UNZSTD) zstd_run(mode,input,length,options,owner,&result);
    else if (mode<=QC_UNLZ4) lz4_run(mode,input,length,options,owner,&result);
    else bzip_run(mode,input,length,options,owner,&result);
    if (owner->failed) error(&result,QC_MEMORY,0,"Compression allocation failed");
    qc_allocator_leave(previous);
    if (result.status) { qc_free(result.output.data); memset(&result.output,0,sizeof(result.output)); }
    return result;
}
uint32_t qc_checksum(int kind,const uint8_t *input,size_t length,uint32_t initial) {
    if (kind==1) return crc32c(initial,input,length);
    if (kind==2) return adler32_z(initial,input,length);
    return crc32_z(initial,input,length);
}
const char *qc_version(int codec) {
    if (codec==0) return zlibVersion();
    if (codec==1) return ZSTD_versionString();
    if (codec==2) return LZ4_versionString();
    return BZ2_bzlibVersion();
}
