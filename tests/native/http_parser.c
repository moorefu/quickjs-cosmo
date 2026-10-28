#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "quickjs.h"
#include "../../native/http/binding.h"
static int fail_header,failures;
void *__real_js_realloc(JSContext *,void *,size_t);
void *__wrap_js_realloc(JSContext *ctx,void *p,size_t n){if(fail_header&&n==8){fail_header=0;failures++;JS_ThrowOutOfMemory(ctx);return NULL;}return __real_js_realloc(ctx,p,n);}
static JSValue call(JSContext *ctx,JSValue parse,const char *wire,size_t n,int limit){
    JSValue args[]={JS_NewArrayBufferCopy(ctx,(const uint8_t *)wire,n),JS_NewInt32(ctx,0),JS_NewInt32(ctx,n),JS_NewInt32(ctx,limit)};
    JSValue result=JS_Call(ctx,parse,JS_UNDEFINED,4,args);for(int i=0;i<4;i++)JS_FreeValue(ctx,args[i]);return result;
}
int main(void){
    JSRuntime *rt=JS_NewRuntime();assert(rt);JSContext *ctx=JS_NewContext(rt);assert(ctx);
    JSValue api=js_cosmo_http_api(ctx),parse=JS_GetPropertyStr(ctx,api,"parse");
    const char *wire="HTTP/1.1 200 OK\r\nContent-Length: 4\r\nX-Custom: value\r\n\r\nbody";
    JSValue result=call(ctx,parse,wire,strlen(wire),16384);
    if(JS_IsException(result)){JSValue e=JS_GetException(ctx);const char *s=JS_ToCString(ctx,e);fprintf(stderr,"%s\n",s?s:"exception");assert(0);}
    JSValue status=JS_GetPropertyStr(ctx,result,"status");int32_t number;assert(!JS_ToInt32(ctx,&number,status)&&number==200);JS_FreeValue(ctx,status);JS_FreeValue(ctx,result);
    for(size_t i=0;i<strlen(wire)-4;i++){result=call(ctx,parse,wire,i,16384);assert(JS_IsNull(result));JS_FreeValue(ctx,result);}
    const char *bad[]={"HTTP/1.1 200 OK\r\nBad Name: x\r\n\r\n","HTTP/1.1 200 OK\r\nX: a\1b\r\n\r\n","HTTP/1.1 200 OK\r\n X: fold\r\n\r\n"};
    for(int i=0;i<3;i++){result=call(ctx,parse,bad[i],strlen(bad[i]),16384);assert(JS_IsException(result));JSValue e=JS_GetException(ctx);JS_FreeValue(ctx,e);}
    result=call(ctx,parse,wire,strlen(wire),16);assert(JS_IsException(result));JSValue e=JS_GetException(ctx);JS_FreeValue(ctx,e);
    fail_header=1;result=call(ctx,parse,wire,strlen(wire),16384);assert(JS_IsException(result)&&failures==1&&!fail_header);e=JS_GetException(ctx);JS_FreeValue(ctx,e);
    JS_RunGC(rt);JSMemoryUsage before,after;JS_ComputeMemoryUsage(rt,&before);
    for(int i=0;i<1000;i++){result=call(ctx,parse,wire,strlen(wire),16384);assert(!JS_IsException(result));JS_FreeValue(ctx,result);}
    JS_RunGC(rt);JS_ComputeMemoryUsage(rt,&after);assert(after.malloc_size<before.malloc_size+4096);
    JS_FreeValue(ctx,parse);JS_FreeValue(ctx,api);JS_FreeContext(ctx);JS_FreeRuntime(rt);puts("PASS http-parser-sdk: fragmentation, grammar/limit rejection, owner OOM and repeated GC");
}
