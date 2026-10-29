#include <math.h>
#include <errno.h>
#include <string.h>
#include "../tasks.h"
#include <stdint.h>
#include "third_party/zlib/zlib.h"
#include "third_party/zstd/zstd.h"
#include "third_party/zstd/zstd_errors.h"
#include "core.h"
#include "binding.h"

static uint8_t empty;
static int put(JSContext *ctx,JSValueConst object,const char *name,JSValue value) {
    if (JS_IsException(value)) return -1;
    return JS_SetPropertyStr(ctx,object,name,value);
}
static void *allocate(void *rt,size_t size) { return js_malloc_rt(rt,size); }
static void release(void *rt,void *data) { js_free_rt(rt,data); }
static void output_free(JSRuntime *rt,void *opaque,void *data) { qc_free(data); }
static int number(JSContext *ctx,JSValueConst value,int64_t min,int64_t max,int64_t *out) {
    double n;
    if (!JS_IsNumber(value)) { JS_ThrowTypeError(ctx,"Expected a native compression number"); return -1; }
    if (JS_ToFloat64(ctx,&n,value)<0) return -1;
    if (!isfinite(n) || n<min || n>max || floor(n)!=n) { JS_ThrowRangeError(ctx,"Native compression number out of range"); return -1; }
    *out=n; return 0;
}
static int element(JSContext *ctx,JSValueConst array,unsigned index,int64_t *out) {
    JSValue value=JS_GetPropertyUint32(ctx,array,index); if (JS_IsException(value)) return -1;
    int result=number(ctx,value,INT32_MIN,INT32_MAX,out); JS_FreeValue(ctx,value); return result;
}
static int span(JSContext *ctx,const JSValueConst *args,uint8_t **data,size_t *length) {
    int64_t offset,count;
    if (number(ctx,args[1],0,INT32_MAX,&offset)<0 || number(ctx,args[2],0,INT32_MAX,&count)<0) return -1;
    *length=count;
    if (!count) { *data=&empty; return 0; }
    size_t total; uint8_t *raw=JS_GetArrayBuffer(ctx,&total,args[0]);
    if (JS_HasException(ctx)) return -1;
    if (!raw || (size_t)offset>total || (size_t)count>total-offset) { JS_ThrowRangeError(ctx,"Compression span exceeds backing store"); return -1; }
    *data=raw+offset; return 0;
}
static const char *zstd_code(int number) {
#define E(name) case name: return #name
    switch (number) {
        E(ZSTD_error_GENERIC); E(ZSTD_error_prefix_unknown); E(ZSTD_error_version_unsupported);
        E(ZSTD_error_frameParameter_unsupported); E(ZSTD_error_frameParameter_windowTooLarge);
        E(ZSTD_error_corruption_detected); E(ZSTD_error_checksum_wrong); E(ZSTD_error_literals_headerWrong);
        E(ZSTD_error_dictionary_corrupted); E(ZSTD_error_dictionary_wrong); E(ZSTD_error_dictionaryCreation_failed);
        E(ZSTD_error_parameter_unsupported); E(ZSTD_error_parameter_combination_unsupported); E(ZSTD_error_parameter_outOfBound);
        E(ZSTD_error_tableLog_tooLarge); E(ZSTD_error_maxSymbolValue_tooLarge); E(ZSTD_error_maxSymbolValue_tooSmall);
        E(ZSTD_error_stabilityCondition_notRespected); E(ZSTD_error_stage_wrong); E(ZSTD_error_init_missing);
        E(ZSTD_error_memory_allocation); E(ZSTD_error_workSpace_tooSmall); E(ZSTD_error_dstSize_tooSmall);
        E(ZSTD_error_srcSize_wrong); E(ZSTD_error_dstBuffer_null); E(ZSTD_error_noForwardProgress_destFull);
        E(ZSTD_error_noForwardProgress_inputEmpty);
        default: return "ZSTD_error_GENERIC";
    }
#undef E
}
static const char *zlib_code(int number) {
    switch(number) { case Z_NEED_DICT:return "Z_NEED_DICT"; case Z_STREAM_ERROR:return "Z_STREAM_ERROR";
        case Z_DATA_ERROR:return "Z_DATA_ERROR"; case Z_MEM_ERROR:return "Z_MEM_ERROR";
        case Z_VERSION_ERROR:return "Z_VERSION_ERROR"; default:return "Z_BUF_ERROR"; }
}
static JSValue failure(JSContext *ctx,int mode,const QCResult *result) {
    if (result->status==QC_MEMORY) return JS_ThrowOutOfMemory(ctx);
    if (result->status==QC_LIMIT) JS_ThrowRangeError(ctx,"Output exceeds maxOutputLength");
    else if (result->status==QC_TRAILING) JS_ThrowTypeError(ctx,"Trailing junk after stream end");
    JSValue error=(result->status==QC_LIMIT || result->status==QC_TRAILING)?JS_GetException(ctx):JS_NewError(ctx);
    if (JS_IsException(error)) return error;
    if (result->status!=QC_LIMIT && result->status!=QC_TRAILING &&
        put(ctx,error,"message",JS_NewString(ctx,result->message))<0) goto fail;
    const char *code=result->status==QC_LIMIT?"ERR_BUFFER_TOO_LARGE":result->status==QC_TRAILING?"ERR_TRAILING_JUNK_AFTER_STREAM_END":
        mode<=QC_UNZIP?zlib_code(result->backend):mode<=QC_UNZSTD?
        result->status==QC_PARAMETER?"ERR_ZLIB_INITIALIZATION_FAILED":result->backend==Z_BUF_ERROR?"Z_BUF_ERROR":zstd_code(result->backend):"ERR_COMPRESSION_DATA";
    if (put(ctx,error,"code",JS_NewString(ctx,code))<0) goto fail;
    if (result->status!=QC_LIMIT && result->status!=QC_TRAILING && result->status!=QC_PARAMETER && mode<=QC_UNZSTD &&
        put(ctx,error,"errno",JS_NewInt32(ctx,result->status==QC_PARAMETER?-1:result->backend))<0) goto fail;
    return JS_Throw(ctx,error);
fail: JS_FreeValue(ctx,error); return JS_EXCEPTION;
}
typedef struct {int mode;const uint8_t *input;size_t length;QCOptions options;} Parsed;
static JSValue parse_run(JSContext *ctx,int argc,JSValueConst *args,Parsed *out) {
    if (argc<10) return JS_ThrowTypeError(ctx,"Invalid native compression argument count");
    int64_t mode,values[11],parameter_count,pledged;
    if (number(ctx,args[0],0,QJS_COMPRESSION_FULL?QC_UNBZIP2:QC_UNZIP,&mode)<0) return JS_EXCEPTION;
    for (int i=0;i<11;i++) if (element(ctx,args[4],i,&values[i])<0) return JS_EXCEPTION;
    QCOptions options={.maximum=values[0],.chunk=values[1],.window=values[2],.level=values[3],
        .memory=values[4],.strategy=values[5],.finish=values[6],.reject=values[7],.checksum=values[8],.block_size=values[9],.small=values[10],.pledged=UINT64_MAX};
    if (options.maximum<1 || options.maximum>INT32_MAX || options.chunk<1 || options.chunk>INT32_MAX)
        return JS_ThrowRangeError(ctx,"Invalid native compression limit");
    JSValue length=JS_GetPropertyStr(ctx,args[8],"length");
    if (JS_IsException(length)) return length;
    int valid=number(ctx,length,0,128,&parameter_count); JS_FreeValue(ctx,length);
    if (valid<0) return JS_EXCEPTION;
    if (parameter_count%2) return JS_ThrowTypeError(ctx,"Invalid compression parameter pairs");
    options.parameter_count=parameter_count/2;
    for (int i=0;i<parameter_count;i++) { int64_t value; if (element(ctx,args[8],i,&value)<0) return JS_EXCEPTION; options.parameters[i/2][i%2]=value; }
    if (!JS_IsUndefined(args[9])) {
        if (number(ctx,args[9],0,9007199254740991LL,&pledged)<0) return JS_EXCEPTION;
        options.pledged=pledged;
    }
    uint8_t *input,*dictionary; size_t count,dict_count;
    if (span(ctx,args+1,&input,&count)<0 || span(ctx,args+5,&dictionary,&dict_count)<0) return JS_EXCEPTION;
    options.dictionary=dictionary; options.dictionary_length=dict_count;
    *out=(Parsed){mode,input,count,options};return JS_UNDEFINED;
}
static JSValue run(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args) {
    Parsed p;if(JS_IsException(parse_run(ctx,argc,args,&p)))return JS_EXCEPTION;
    QCAllocator allocator={.opaque=JS_GetRuntime(ctx),.allocate=allocate,.release=release};
    QCResult result=qc_run(p.mode,p.input,p.length,&p.options,&allocator);
    if(result.status)return failure(ctx,p.mode,&result);
    JSValue output=JS_NewArrayBuffer(ctx,result.output.data,result.output.length,output_free,NULL,0);
    if(JS_IsException(output))qc_free(result.output.data);
    return output;
}
typedef struct {Parsed config;QCAllocator memory;QCResult result;} CompressionTask;
static void *task_allocate(void *task,size_t size){return js_cosmo_task_alloc(task,size);}
static void task_release(void *task,void *data){js_cosmo_task_free(task,data);}
static int task_cancelled(void *task){return js_cosmo_task_cancelled(task);}
static void task_cleanup(QJSCosmoTask *task){CompressionTask *r=js_cosmo_task_data(task);qc_free(r->result.output.data);}
static int task_work(QJSCosmoTask *task) {
    CompressionTask *r=js_cosmo_task_data(task);
    r->memory=(QCAllocator){.opaque=task,.allocate=task_allocate,.release=task_release};
    r->config.options.cancelled=task_cancelled;r->config.options.cancel_opaque=task;
    r->result=qc_run(r->config.mode,r->config.input,r->config.length,&r->config.options,&r->memory);return 0;
}
static JSValue task_finish(JSContext *ctx,QJSCosmoTask *task,int error) {
    CompressionTask *r=js_cosmo_task_data(task);
    if(error==ECANCELED) {
        JSValue value=JS_NewError(ctx);if(JS_IsException(value))return value;
        if(put(ctx,value,"name",JS_NewString(ctx,"AbortError"))<0 || put(ctx,value,"code",JS_NewString(ctx,"ABORT_ERR"))<0){JS_FreeValue(ctx,value);return JS_EXCEPTION;}
        return JS_Throw(ctx,value);
    }
    if(r->result.status)return failure(ctx,r->config.mode,&r->result);
    return JS_NewArrayBufferCopy(ctx,r->result.output.data,r->result.output.length);
}
static JSValue run_async(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args) {
    Parsed config;if(JS_IsException(parse_run(ctx,argc,args,&config)))return JS_EXCEPTION;
    int compress=config.mode==QC_DEFLATE || config.mode==QC_GZIP || config.mode==QC_RAW || config.mode==QC_ZSTD || config.mode==QC_LZ4 || config.mode==QC_BZIP2;
    size_t output=compress?config.length+config.length/8+65536:config.length>131072?config.length*32:4*1024*1024;
    if(output>config.options.maximum)output=config.options.maximum;
    size_t workspace=config.mode<=QC_UNZIP?1024*1024:config.mode<=QC_UNZSTD?16*1024*1024:config.mode<=QC_UNLZ4?1024*1024:12*1024*1024;
    size_t budget=65536+config.length+config.options.dictionary_length+workspace+3*output;
    if(budget>64*1024*1024)budget=64*1024*1024;
    QJSCosmoTask *task=js_cosmo_task_create(ctx,budget,sizeof(CompressionTask),task_work,task_finish);if(!task)return JS_EXCEPTION;
    CompressionTask *r=js_cosmo_task_data(task);r->config=config;js_cosmo_task_set_cleanup(task,task_cleanup);
    uint8_t *input=js_cosmo_task_alloc(task,config.length?config.length:1);if(!input)goto memory;
    if(config.length)memcpy(input,config.input,config.length);
    r->config.input=input;
    if(config.options.dictionary_length) {
        uint8_t *dictionary=js_cosmo_task_alloc(task,config.options.dictionary_length);if(!dictionary)goto memory;
        memcpy(dictionary,config.options.dictionary,config.options.dictionary_length);r->config.options.dictionary=dictionary;
    }
    uint64_t id;JSValue promise=js_cosmo_task_submit(ctx,task,&id);if(JS_IsException(promise))return promise;
    JSValue value=JS_NewObject(ctx);if(JS_IsException(value)){JS_FreeValue(ctx,promise);js_cosmo_task_cancel(ctx,id);return value;}
    if(put(ctx,value,"promise",promise)<0 || put(ctx,value,"id",JS_NewInt64(ctx,id))<0){JS_FreeValue(ctx,value);js_cosmo_task_cancel(ctx,id);return JS_EXCEPTION;}
    return value;
memory:js_cosmo_task_discard(task);return JS_ThrowOutOfMemory(ctx);
}
static JSValue cancel(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args) {
    int64_t id;if(argc<1 || JS_ToInt64(ctx,&id,args[0])<0)return JS_EXCEPTION;return JS_NewBool(ctx,js_cosmo_task_cancel(ctx,id));
}
static JSValue checksum(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args) {
    if (argc<5) return JS_ThrowTypeError(ctx,"Invalid checksum arguments");
    int64_t kind,initial;
    if (number(ctx,args[0],0,2,&kind)<0 || number(ctx,args[4],0,UINT32_MAX,&initial)<0) return JS_EXCEPTION;
    uint8_t *data; size_t length; if (span(ctx,args+1,&data,&length)<0) return JS_EXCEPTION;
    return JS_NewUint32(ctx,qc_checksum(kind,data,length,initial));
}
static JSValue versions(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args) {
    JSValue object=JS_NewObject(ctx); if (JS_IsException(object)) return object;
    const char *names[]={"zlib","zstd","lz4","bzip2"};
    for (int i=0;i<(QJS_COMPRESSION_FULL?4:1);i++) if (put(ctx,object,names[i],JS_NewString(ctx,qc_version(i)))<0) { JS_FreeValue(ctx,object); return JS_EXCEPTION; }
    if (JS_SetPropertyStr(ctx,object,"zlibVernum",JS_NewInt32(ctx,ZLIB_VERNUM))<0) { JS_FreeValue(ctx,object); return JS_EXCEPTION; }
    return object;
}
#include "stream-binding.h"
JSValue js_cosmo_compression_api(JSContext *ctx) {
    JSValue api=JS_NewObject(ctx); if (JS_IsException(api)) return api;
    const char *names[]={"run","checksum","versions","runAsync","cancel","streamCreate","streamStep","streamClose","streamReset"};
    JSCFunction *functions[]={run,checksum,versions,run_async,cancel,stream_create,stream_step,stream_close,stream_reset};
    for (int i=0;i<9;i++) if (put(ctx,api,names[i],JS_NewCFunction(ctx,functions[i],names[i],0))<0) { JS_FreeValue(ctx,api); return JS_EXCEPTION; }
    return api;
}
