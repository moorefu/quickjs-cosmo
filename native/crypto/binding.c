#include <errno.h>
#include <math.h>
#include <pthread.h>
#include <stdint.h>
#include <string.h>
#include "libc/str/str.h"
#include "binding.h"
#include "core.h"
#include "keys.h"
#include "aead.h"
#include "../tasks.h"

static JSClassID hash_class,key_class,cipher_class;
static pthread_once_t class_once=PTHREAD_ONCE_INIT;
static uint8_t empty_byte;
enum { CR_NEW, CR_UPDATE, CR_DIGEST, CR_COPY, CR_HKDF, CR_PBKDF2, CR_FILL, CR_EQUAL, CR_BLAKE256, CR_RANDOM,
       CR_KEY_NEW,CR_KEY_EXPORT,CR_KEY_PUBLIC,CR_KEY_GENERATE,CR_KEY_SIGN,CR_KEY_VERIFY,CR_KEY_DERIVE,
       CR_CIPHER_NEW,CR_CIPHER_AAD,CR_CIPHER_UPDATE,CR_CIPHER_FINISH,CR_CIPHER_CLOSE };
typedef struct { uint8_t *data; size_t length; } Bytes;

static void class_id(void) { JS_NewClassID(&hash_class);JS_NewClassID(&key_class);JS_NewClassID(&cipher_class); }
static void hash_finalize(JSRuntime *rt,JSValue value) {
    QCryptoHash *state=JS_GetOpaque(value,hash_class); qcrypto_hash_free(state);
}
static const JSClassDef hash_definition={"QjsCryptoState",.finalizer=hash_finalize};
static void *allocate(void *opaque,size_t size) { return js_malloc_rt(opaque,size); }
static void release(void *opaque,void *data) { js_free_rt(opaque,data); }

static JSValue failure(JSContext *ctx,const char *code,const char *message) {
    JSValue value=JS_NewError(ctx); if (JS_IsException(value)) return value;
    JSValue text=JS_NewString(ctx,message);
    if (JS_IsException(text)) { JS_FreeValue(ctx,value); return JS_EXCEPTION; }
    if (JS_SetPropertyStr(ctx,value,"message",text)<0) { JS_FreeValue(ctx,value); return JS_EXCEPTION; }
    if (code) {
        text=JS_NewString(ctx,code);
        if (JS_IsException(text)) { JS_FreeValue(ctx,value); return JS_EXCEPTION; }
        if (JS_SetPropertyStr(ctx,value,"code",text)<0) { JS_FreeValue(ctx,value); return JS_EXCEPTION; }
    }
    return JS_Throw(ctx,value);
}
static int number(JSContext *ctx,JSValueConst value,uint64_t max,uint64_t *result) {
    double n;
    if (!JS_IsNumber(value)) { JS_ThrowTypeError(ctx,"Expected native crypto number"); return -1; }
    if (JS_ToFloat64(ctx,&n,value)<0) return -1;
    if (!isfinite(n) || n<0 || n>9007199254740991.0 || n>max || floor(n)!=n) { JS_ThrowRangeError(ctx,"Native crypto number out of range"); return -1; }
    *result=(uint64_t)n; return 0;
}
static int span(JSContext *ctx,const JSValueConst *args,Bytes *out) {
    uint64_t offset,length; size_t total=0;
    if (number(ctx,args[1],SIZE_MAX,&offset)<0 || number(ctx,args[2],SIZE_MAX,&length)<0) return -1;
    if (!length) { out->data=&empty_byte; out->length=0; return 0; }
    QCryptoKey *key=JS_GetOpaque(args[0],key_class);
    uint8_t *data;
    if(key){
        if(qcrypto_key_kind(key)!=QKEY_SYMMETRIC){JS_ThrowTypeError(ctx,"Expected a secret key");return -1;}
        total=qcrypto_key_length(key);data=(uint8_t *)qcrypto_key_bytes(key);
    }else data=JS_GetArrayBuffer(ctx,&total,args[0]);
    if (JS_HasException(ctx)) return -1;
    if (!data || offset>total || length>total-offset) { JS_ThrowRangeError(ctx,"Native crypto view exceeds backing store"); return -1; }
    out->data=data+offset; out->length=length; return 0;
}
static void output_free(JSRuntime *rt,void *opaque,void *data) {
    explicit_bzero(data,(size_t)(uintptr_t)opaque); js_free_rt(rt,data);
}
static JSValue output(JSContext *ctx,size_t length,uint8_t **data) {
    size_t allocated=length?length:1;
    *data=js_malloc(ctx,allocated); if (!*data) return JS_EXCEPTION;
    JSValue value=JS_NewArrayBuffer(ctx,*data,length,output_free,(void *)(uintptr_t)allocated,0);
    if (JS_IsException(value)) { explicit_bzero(*data,allocated); js_free(ctx,*data); *data=NULL; }
    return value;
}
static QCryptoHash *state(JSContext *ctx,JSValueConst value) {
    QCryptoHash *hash=JS_GetOpaque(value,hash_class);
    if (!hash) failure(ctx,"ERR_CRYPTO_HASH_FINALIZED","Hash state is unavailable");
    return hash;
}
static JSValue wrap_state(JSContext *ctx,QCryptoHash *hash) {
    if (!hash) return JS_ThrowOutOfMemory(ctx);
    JSValue value=JS_NewObjectProtoClass(ctx,JS_NULL,hash_class);
    if (JS_IsException(value)) { qcrypto_hash_free(hash); return value; }
    JS_SetOpaque(value,hash); return value;
}
static JSValue compute_failure(JSContext *ctx,int error) {
    return error==QCR_ALLOCATION?JS_ThrowOutOfMemory(ctx):failure(ctx,"ERR_CRYPTO_OPERATION_FAILED","Native crypto operation failed");
}
#include "extended-binding.h"

static JSValue call_impl(JSContext *ctx,int argc,JSValueConst *args,int magic) {
    if(magic>=CR_KEY_NEW)return extended_call(ctx,argc,args,magic);
    const int needed[]={5,4,1,1,11,9,3,6,3,1};
    if ((unsigned)magic>=sizeof(needed)/sizeof(*needed) || argc<needed[magic])
        return JS_ThrowTypeError(ctx,"Invalid native crypto argument count");
    uint64_t algorithm=0,length=0,iterations=0;
    Bytes a,b,c; uint8_t *data; int result;
    if (magic==CR_RANDOM) {
        if (number(ctx,args[0],0x7fffffff,&length)<0) return JS_EXCEPTION;
        JSValue value=output(ctx,length,&data); if (JS_IsException(value)) return value;
        result=qcrypto_random(data,length);
        if (result) { JS_FreeValue(ctx,value); return compute_failure(ctx,result); }
        return value;
    }
    if (magic==CR_NEW || magic==CR_HKDF || magic==CR_PBKDF2) {
        if (number(ctx,args[0],QCR_ALGORITHMS-1,&algorithm)<0) return JS_EXCEPTION;
        if (magic!=CR_NEW && algorithm==QCR_BLAKE512) return failure(ctx,"ERR_CRYPTO_INVALID_DIGEST","Digest unavailable for KDF");
    }
    if (magic==CR_NEW) {
        if (!JS_IsBool(args[1])) return JS_ThrowTypeError(ctx,"Expected HMAC boolean");
        int hmac=JS_ToBool(ctx,args[1]);
        /* The new-hash key uses (buffer, offset, length) at indices 2..4. */
        if (span(ctx,args+2,&a)<0) return JS_EXCEPTION;
        if (hmac && algorithm==QCR_BLAKE512) return failure(ctx,"ERR_CRYPTO_INVALID_DIGEST","Digest unavailable for HMAC");
        return wrap_state(ctx,qcrypto_hash_create(algorithm,hmac,a.data,a.length));
    }
    if (magic==CR_UPDATE || magic==CR_DIGEST || magic==CR_COPY) {
        QCryptoHash *hash=state(ctx,args[0]); if (!hash) return JS_EXCEPTION;
        if (magic==CR_COPY) {
            if (qcrypto_hash_hmac(hash)) return JS_ThrowTypeError(ctx,"Cannot copy HMAC state");
            return wrap_state(ctx,qcrypto_hash_copy(hash));
        }
        if (magic==CR_UPDATE) {
            if (span(ctx,args+1,&a)<0) return JS_EXCEPTION;
            result=qcrypto_hash_update(hash,a.data,a.length);
            return result?compute_failure(ctx,result):JS_UNDEFINED;
        }
        /* Allocate before consuming the state: allocation failure permits retry. */
        JSValue value=output(ctx,qcrypto_hash_size(hash),&data);
        if (JS_IsException(value)) return value;
        result=qcrypto_hash_finish(hash,data);
        qcrypto_hash_free(hash); JS_SetOpaque(args[0],NULL);
        if (result) { JS_FreeValue(ctx,value); return compute_failure(ctx,result); }
        return value;
    }
    if (magic==CR_FILL || magic==CR_BLAKE256) {
        if (span(ctx,args,&a)<0) return JS_EXCEPTION;
        if (magic==CR_FILL) {
            result=qcrypto_random(a.data,a.length);
            return result?compute_failure(ctx,result):JS_UNDEFINED;
        }
        JSValue value=output(ctx,32,&data); if (JS_IsException(value)) return value;
        result=qcrypto_blake256(a.data,a.length,data);
        if (result) { JS_FreeValue(ctx,value); return compute_failure(ctx,result); }
        return value;
    }
    if (magic==CR_EQUAL) {
        if (span(ctx,args,&a)<0 || span(ctx,args+3,&b)<0) return JS_EXCEPTION;
        if (a.length!=b.length) return failure(ctx,"ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH","Inputs have different lengths");
        return JS_NewBool(ctx,qcrypto_equal(a.data,b.data,a.length));
    }
    int length_index=magic==CR_HKDF?10:8;
    if (number(ctx,args[length_index],0x7fffffff,&length)<0) return JS_EXCEPTION;
    if (!length) return failure(ctx,NULL,"Deriving bits failed");
    if (magic==CR_PBKDF2 && number(ctx,args[7],0x7fffffff,&iterations)<0) return JS_EXCEPTION;
    if (span(ctx,args+1,&a)<0 || span(ctx,args+4,&b)<0) return JS_EXCEPTION;
    if (magic==CR_HKDF && span(ctx,args+7,&c)<0) return JS_EXCEPTION;
    JSValue value=output(ctx,length,&data); if (JS_IsException(value)) return value;
    result=magic==CR_HKDF?qcrypto_hkdf(algorithm,a.data,a.length,b.data,b.length,c.data,c.length,data,length):
        qcrypto_pbkdf2(algorithm,a.data,a.length,b.data,b.length,iterations,data,length);
    if (result) { JS_FreeValue(ctx,value); return compute_failure(ctx,result); }
    return value;
}
static JSValue call(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args,int magic) {
    QCryptoAllocator hooks={.opaque=JS_GetRuntime(ctx),.allocate=allocate,.release=release};
    QCryptoAllocator previous=qcrypto_allocator_enter(hooks);
    JSValue result=call_impl(ctx,argc,args,magic);
    qcrypto_allocator_leave(previous); return result;
}
typedef struct {int kind,algorithm;Bytes a,b,c;uint32_t iterations;size_t length;uint8_t *output;} CryptoTask;
static void *task_allocate(void *task,size_t size){return js_cosmo_task_alloc(task,size);}
static void task_release(void *task,void *data){js_cosmo_task_free(task,data);}
static int task_cancelled(void *task){return js_cosmo_task_cancelled(task);}
static int crypto_work(QJSCosmoTask *task) {
    CryptoTask *r=js_cosmo_task_data(task);
    QCryptoAllocator hooks={task,task_allocate,task_release},previous=qcrypto_allocator_enter(hooks);
    QCryptoCancellation cancellation=qcrypto_cancel_enter((QCryptoCancellation){task_cancelled,task});
    int result;
    if(r->kind==CR_RANDOM)result=qcrypto_random(r->output,r->length);
    else if(!r->length)result=QCR_ARGUMENT;
    else if(r->kind==CR_HKDF)result=qcrypto_hkdf(r->algorithm,r->a.data,r->a.length,r->b.data,r->b.length,r->c.data,r->c.length,r->output,r->length);
    else result=qcrypto_pbkdf2(r->algorithm,r->a.data,r->a.length,r->b.data,r->b.length,r->iterations,r->output,r->length);
    qcrypto_cancel_leave(cancellation);qcrypto_allocator_leave(previous);return result;
}
static JSValue crypto_finish(JSContext *ctx,QJSCosmoTask *task,int error) {
    CryptoTask *r=js_cosmo_task_data(task);
    if(error){if(!r->length && r->kind!=CR_RANDOM)return failure(ctx,NULL,"Deriving bits failed");return compute_failure(ctx,error);}
    uint8_t *data;JSValue value=output(ctx,r->length,&data);if(JS_IsException(value))return value;
    if(r->length)memcpy(data,r->output,r->length);
    return value;
}
static JSValue call_async(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args,int kind) {
    CryptoTask request={.kind=kind};uint64_t id=0,length=0,iterations=0;
    if(argc<(kind==CR_RANDOM?1:kind==CR_HKDF?11:9))return JS_ThrowTypeError(ctx,"Invalid native async crypto arguments");
    if(kind==CR_RANDOM){if(number(ctx,args[0],0x7fffffff,&length)<0)return JS_EXCEPTION;}
    else {
        if(number(ctx,args[0],QCR_ALGORITHMS-2,&id)<0 || span(ctx,args+1,&request.a)<0 || span(ctx,args+4,&request.b)<0)return JS_EXCEPTION;
        if(kind==CR_HKDF && span(ctx,args+7,&request.c)<0)return JS_EXCEPTION;
        if(number(ctx,args[kind==CR_HKDF?10:8],0x7fffffff,&length)<0)return JS_EXCEPTION;
        if(kind==CR_PBKDF2 && number(ctx,args[7],0x7fffffff,&iterations)<0)return JS_EXCEPTION;
    }
    request.algorithm=id;request.length=length;request.iterations=iterations;
    size_t budget=65536+length+request.a.length+request.b.length+request.c.length;
    QJSCosmoTask *task=js_cosmo_task_create(ctx,budget,sizeof(CryptoTask),crypto_work,crypto_finish);if(!task)return JS_EXCEPTION;
    CryptoTask *r=js_cosmo_task_data(task);*r=request;
    Bytes *spans[]={&r->a,&r->b,&r->c};
    for(int i=0;i<3;i++)if(spans[i]->length) {
        uint8_t *copy=js_cosmo_task_alloc(task,spans[i]->length);if(!copy)goto memory;
        memcpy(copy,spans[i]->data,spans[i]->length);spans[i]->data=copy;
    }
    r->output=js_cosmo_task_alloc(task,length?length:1);if(!r->output)goto memory;
    return js_cosmo_task_submit(ctx,task,NULL);
memory:js_cosmo_task_discard(task);return JS_ThrowOutOfMemory(ctx);
}
#include "extended-async.h"
JSValue js_cosmo_crypto_api(JSContext *ctx) {
    pthread_once(&class_once,class_id);
    if (!JS_IsRegisteredClass(JS_GetRuntime(ctx),hash_class) && JS_NewClass(JS_GetRuntime(ctx),hash_class,&hash_definition)<0)
        return JS_ThrowInternalError(ctx,"Cannot register native crypto state");
    if((!JS_IsRegisteredClass(JS_GetRuntime(ctx),key_class) && JS_NewClass(JS_GetRuntime(ctx),key_class,&key_definition)<0) ||
       (!JS_IsRegisteredClass(JS_GetRuntime(ctx),cipher_class) && JS_NewClass(JS_GetRuntime(ctx),cipher_class,&cipher_definition)<0))return JS_ThrowOutOfMemory(ctx);
    JSValue api=JS_NewObject(ctx); if (JS_IsException(api)) return api;
    const char *names[]={"create","update","digest","copy","hkdf","pbkdf2","fill","equal","blake256","random",
        "keyNew","keyExport","keyPublic","keyGenerate","keySign","keyVerify","keyDerive",
        "cipherNew","cipherAAD","cipherUpdate","cipherFinish","cipherClose"};
    for (size_t i=0;i<sizeof(names)/sizeof(*names);i++) {
        JSValue fn=JS_NewCFunctionMagic(ctx,call,names[i],0,JS_CFUNC_generic_magic,i);
        if (JS_IsException(fn) || JS_SetPropertyStr(ctx,api,names[i],fn)<0) { JS_FreeValue(ctx,api); return JS_EXCEPTION; }
    }
    JSValue async=JS_NewObject(ctx);if(JS_IsException(async)){JS_FreeValue(ctx,api);return async;}
    const char *async_names[]={"hkdf","pbkdf2","random"};const int kinds[]={CR_HKDF,CR_PBKDF2,CR_RANDOM};
    for(int i=0;i<3;i++)if(JS_SetPropertyStr(ctx,async,async_names[i],JS_NewCFunctionMagic(ctx,call_async,async_names[i],0,JS_CFUNC_generic_magic,kinds[i]))<0){JS_FreeValue(ctx,async);JS_FreeValue(ctx,api);return JS_EXCEPTION;}
    const char *key_names[]={"keySign","keyVerify","keyDerive"};const int key_kinds[]={CR_KEY_SIGN,CR_KEY_VERIFY,CR_KEY_DERIVE};
    for(int i=0;i<3;i++)if(JS_SetPropertyStr(ctx,async,key_names[i],JS_NewCFunctionMagic(ctx,call_key_async,key_names[i],0,JS_CFUNC_generic_magic,key_kinds[i]))<0){JS_FreeValue(ctx,async);JS_FreeValue(ctx,api);return JS_EXCEPTION;}
    if(JS_SetPropertyStr(ctx,api,"async",async)<0){JS_FreeValue(ctx,api);return JS_EXCEPTION;}
    return api;
}
