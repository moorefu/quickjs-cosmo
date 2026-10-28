#include <stdint.h>
#include <string.h>
#include "net/http/http.h"
#include "binding.h"
/* Only the pinned parser objects are wrapped/localized with this adapter. */
/* Nightly declares its parser "dontcallback" (GCC leaf). Link wrapping adds
   allocator callbacks into this TU, so preserve both scope stores explicitly. */
static _Thread_local JSContext *volatile allocation_context;
void *__wrap_realloc(void *p,size_t n){return js_realloc(allocation_context,p,n);}
void __wrap_free(void *p){js_free(allocation_context,p);}
static JSValue failure(JSContext *ctx,const char *code){
    JSValue e=JS_NewError(ctx);if(JS_IsException(e))return e;
    if(JS_SetPropertyStr(ctx,e,"code",JS_NewString(ctx,code))<0||JS_SetPropertyStr(ctx,e,"message",JS_NewString(ctx,"Invalid HTTP response headers"))<0){JS_FreeValue(ctx,e);return JS_EXCEPTION;}
    return JS_Throw(ctx,e);
}
static JSValue parse(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
    int64_t offset,length,limit;
    if(argc<4)return JS_ThrowTypeError(ctx,"Missing HTTP header span");
    if(JS_ToInt64(ctx,&offset,args[1])<0||JS_ToInt64(ctx,&length,args[2])<0||JS_ToInt64(ctx,&limit,args[3])<0)return JS_EXCEPTION;
    size_t size;uint8_t *bytes=JS_GetArrayBuffer(ctx,&size,args[0]);if(JS_HasException(ctx))return JS_EXCEPTION;
    if(offset<0||length<0||(uint64_t)offset>size||(uint64_t)length>size-offset||limit<16||limit>32767)return JS_ThrowRangeError(ctx,"Invalid HTTP header span/limit");
    size_t count=length<limit?length:limit;char *copy=js_malloc(ctx,count?count:1);if(!copy)return JS_EXCEPTION;
    if(count)memcpy(copy,bytes+offset,count);
    /* Nightly rejects C1 characters even inside obs-text. Node/RFC 9110 allow
       them in values/reason phrases. Substitute another obs-text byte for
       validation only; JS consumes the untouched Latin-1 bytes. Both bytes
       are forbidden in header names/version/status, so syntax stays strict. */
    for(size_t i=0;i<count;i++)if((unsigned char)copy[i]>=0x80&&(unsigned char)copy[i]<0xa0)copy[i]=(char)0xa0;
    struct HttpMessage message;allocation_context=ctx;InitHttpMessage(&message,kHttpResponse);
    int used=ParseHttpMessage(&message,copy,count,limit);DestroyHttpMessage(&message);allocation_context=NULL;js_free(ctx,copy);
    /* Nightly silently omits an unknown header if realloc fails. The wrapped
       owner allocator records OOM; never publish such an incomplete result. */
    if(JS_HasException(ctx))return JS_EXCEPTION;
    if(used<0)return failure(ctx,count==(size_t)limit?"HPE_HEADER_OVERFLOW":"HPE_INVALID_HEADER_TOKEN");
    if(!used)return count==(size_t)limit?failure(ctx,"HPE_HEADER_OVERFLOW"):JS_NULL;
    JSValue result=JS_NewObject(ctx);if(JS_IsException(result))return result;
    if(JS_SetPropertyStr(ctx,result,"length",JS_NewInt32(ctx,used))<0||JS_SetPropertyStr(ctx,result,"status",JS_NewInt32(ctx,message.status))<0||JS_SetPropertyStr(ctx,result,"version",JS_NewInt32(ctx,message.version))<0){JS_FreeValue(ctx,result);return JS_EXCEPTION;}
    return result;
}
JSValue js_cosmo_http_api(JSContext *ctx){JSValue api=JS_NewObject(ctx);if(JS_IsException(api))return api;if(JS_SetPropertyStr(ctx,api,"parse",JS_NewCFunction(ctx,parse,"parse",4))<0){JS_FreeValue(ctx,api);return JS_EXCEPTION;}return api;}
