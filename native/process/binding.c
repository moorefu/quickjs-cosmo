#include <cosmo.h>
#include <errno.h>
#include <limits.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <string.h>
#include "libc/calls/syscall_support-sysv.internal.h"
#include "binding.h"
#include "core.h"
#include "async.h"
static uint8_t empty;
static int put(JSContext *ctx,JSValueConst object,const char *name,JSValue value) {
    return JS_IsException(value)?-1:JS_SetPropertyStr(ctx,object,name,value);
}
static void *allocate(void *runtime,size_t size){return js_malloc_rt(runtime,size);}
static void release(void *runtime,void *data){js_free_rt(runtime,data);}
static void output_free(JSRuntime *runtime,void *opaque,void *data){js_free_rt(runtime,data);}
static int number(JSContext *ctx,JSValueConst value,double min,double max,int whole,double *out) {
    if(!JS_IsNumber(value)){JS_ThrowTypeError(ctx,"Expected native process number");return -1;}
    if(JS_ToFloat64(ctx,out,value)<0)return -1;
    if(isnan(*out)||*out<min||*out>max||(whole&&(!isfinite(*out)||floor(*out)!=*out))){JS_ThrowRangeError(ctx,"Native process number out of range");return -1;}
    return 0;
}
static int element(JSContext *ctx,JSValueConst array,unsigned index,double min,double max,int whole,double *out) {
    JSValue value=JS_GetPropertyUint32(ctx,array,index);if(JS_IsException(value))return -1;
    int code=number(ctx,value,min,max,whole,out);JS_FreeValue(ctx,value);return code;
}
static void free_strings(JSContext *ctx,char **strings) {
    if(!strings)return;
    for(size_t i=0;strings[i];i++)JS_FreeCString(ctx,strings[i]);
    js_free(ctx,strings);
}
static char **strings(JSContext *ctx,JSValueConst array) {
    JSValue length=JS_GetPropertyStr(ctx,array,"length");if(JS_IsException(length))return NULL;
    double count;int code=number(ctx,length,0,65535,1,&count);JS_FreeValue(ctx,length);if(code<0)return NULL;
    char **result=js_mallocz(ctx,((size_t)count+1)*sizeof(char *));if(!result)return NULL;
    for(unsigned i=0;i<count;i++) {
        JSValue value=JS_GetPropertyUint32(ctx,array,i);
        if(JS_IsException(value))goto fail;
        if(!JS_IsString(value)){JS_FreeValue(ctx,value);JS_ThrowTypeError(ctx,"Expected native process string");goto fail;}
        size_t length;const char *text=JS_ToCStringLen(ctx,&length,value);JS_FreeValue(ctx,value);
        if(!text)goto fail;
        if(memchr(text,0,length)){JS_FreeCString(ctx,text);JS_ThrowTypeError(ctx,"Process string contains NUL");goto fail;}
        result[i]=(char *)text;
    }
    return result;
fail:free_strings(ctx,result);return NULL;
}
static int span(JSContext *ctx,JSValueConst array,uint8_t **out,size_t *length) {
    double offset,count;
    if(element(ctx,array,1,0,INT32_MAX,1,&offset)<0||element(ctx,array,2,0,INT32_MAX,1,&count)<0)return -1;
    *length=count;if(!count){*out=&empty;return 0;}
    JSValue value=JS_GetPropertyUint32(ctx,array,0);if(JS_IsException(value))return -1;
    size_t size;uint8_t *data=JS_GetArrayBuffer(ctx,&size,value);JS_FreeValue(ctx,value);
    if(JS_HasException(ctx))return -1;
    if(!data||offset>size||count>size-(size_t)offset){JS_ThrowRangeError(ctx,"Process span exceeds backing store");return -1;}
    *out=data+(size_t)offset;return 0;
}
typedef struct {int value,windows;const char *name;} ErrorCode;
JSValue js_cosmo_process_error_info(JSContext *ctx,int code) {
    const ErrorCode values[]={
        {E2BIG,-4093,"E2BIG"},{EACCES,-4092,"EACCES"},{EAGAIN,-4088,"EAGAIN"},{EBADF,-4083,"EBADF"},
        {EBUSY,-4082,"EBUSY"},{EFAULT,-4074,"EFAULT"},{EINTR,-4072,"EINTR"},{EINVAL,-4071,"EINVAL"},
        {EIO,-4070,"EIO"},{EISDIR,-4068,"EISDIR"},{ELOOP,-4067,"ELOOP"},{EMFILE,-4066,"EMFILE"},
        {ENAMETOOLONG,-4064,"ENAMETOOLONG"},{ENFILE,-4061,"ENFILE"},{ENOBUFS,-4060,"ENOBUFS"},
        {ENOENT,-4058,"ENOENT"},{ENOMEM,-4057,"ENOMEM"},{ENOSYS,-4054,"ENOSYS"},{ENOTDIR,-4052,"ENOTDIR"},
        {ENOTSUP,-4049,"ENOTSUP"},{EPERM,-4048,"EPERM"},{EPIPE,-4047,"EPIPE"},{ESRCH,-4040,"ESRCH"},
        {ETIMEDOUT,-4039,"ETIMEDOUT"},{ENOEXEC,-4022,"ENOEXEC"}};
    const char *name="UNKNOWN";int number=-code;
    for(size_t i=0;i<sizeof(values)/sizeof(*values);i++)if(values[i].value==code){name=values[i].name;if(IsWindows())number=values[i].windows;break;}
    if(IsXnu()) {
        if(code==EAGAIN)number=-35;else if(code==ENAMETOOLONG)number=-63;else if(code==ELOOP)number=-62;
        else if(code==ENOBUFS)number=-55;else if(code==ENOSYS)number=-78;else if(code==ENOTSUP)number=-45;
        else if(code==ETIMEDOUT)number=-60;
    }
    JSValue result=JS_NewObject(ctx);if(JS_IsException(result))return result;
    if(put(ctx,result,"code",JS_NewString(ctx,name))<0||put(ctx,result,"errno",JS_NewInt32(ctx,number))<0){JS_FreeValue(ctx,result);return JS_EXCEPTION;}
    return result;
}
static JSValue result_value(JSContext *ctx,QPResult *result) {
    JSValue object=JS_NewObject(ctx);if(JS_IsException(object))return object;
    if(put(ctx,object,"pid",JS_NewUint32(ctx,result->pid))<0||
       put(ctx,object,"status",result->exited&&!result->signal?JS_NewUint32(ctx,result->status):JS_NULL)<0||
       put(ctx,object,"signal",JS_NewInt32(ctx,result->signal))<0)goto fail;
    if(result->error&&put(ctx,object,"error",js_cosmo_process_error_info(ctx,result->error))<0)goto fail;
    JSValue output=result->exited?JS_NewArray(ctx):JS_NULL;
    if(JS_IsException(output))goto fail;
    if(result->exited)for(int i=0;i<3;i++) {
        JSValue value=JS_NULL;
        if(result->capture[i]) {
            value=JS_NewArrayBuffer(ctx,result->output[i].data,result->output[i].length,output_free,NULL,0);
            if(JS_IsException(value)){JS_FreeValue(ctx,output);goto fail;}
            result->output[i].data=NULL;
        }
        if(JS_SetPropertyUint32(ctx,output,i,value)<0){JS_FreeValue(ctx,output);goto fail;}
    }
    if(put(ctx,object,"output",output)<0)goto fail;
    return object;
fail:JS_FreeValue(ctx,object);return JS_EXCEPTION;
}
static JSValue run(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args,int asynchronous) {
    if(argc<(asynchronous?8:7))return JS_ThrowTypeError(ctx,"Invalid native process arguments");
    QPRequest options={0};double values[7],stdio[3];
    if(element(ctx,args[6],0,0,9007199254740991.0,1,values)<0||
       element(ctx,args[6],1,0,INFINITY,0,values+1)<0||
       element(ctx,args[6],2,1,64,1,values+2)<0||
       element(ctx,args[6],3,0,1,1,values+3)<0||element(ctx,args[6],4,0,1,1,values+4)<0||
       element(ctx,args[6],5,-1,UINT32_MAX,1,values+5)<0||element(ctx,args[6],6,-1,UINT32_MAX,1,values+6)<0)return JS_EXCEPTION;
    for(int i=0;i<3;i++)if(element(ctx,args[4],i,-2,INT32_MAX,1,stdio+i)<0)return JS_EXCEPTION;
    char **candidates=NULL,**arguments=NULL,**environment=NULL,*cwd=NULL;
    JSValue result=JS_EXCEPTION;
    candidates=strings(ctx,args[0]);if(!candidates)goto done;
    arguments=strings(ctx,args[1]);if(!arguments)goto done;
    environment=strings(ctx,args[2]);if(!environment)goto done;
    if(!arguments[0]||!candidates[0]){JS_ThrowTypeError(ctx,"Empty native process argument vector");goto done;}
    if(!JS_IsNull(args[3])) {
        uint8_t *data;size_t length;if(span(ctx,args[3],&data,&length)<0)goto done;
        if(memchr(data,0,length)){JS_ThrowTypeError(ctx,"Process cwd contains NUL");goto done;}
        cwd=js_malloc(ctx,length+1);if(!cwd)goto done;memcpy(cwd,data,length);cwd[length]=0;
    }
    uint8_t *input;size_t length;if(span(ctx,args[5],&input,&length)<0)goto done;
    options.candidates=(const char **)candidates;options.arguments=arguments;options.environment=environment;options.cwd=cwd;
    options.input=input;options.input_length=length;
    options.timeout=values[0];options.max_buffer=values[1];options.kill_signal=values[2];options.windows_hide=values[3];
    options.windows_verbatim=values[4];options.uid=values[5];options.gid=values[6];
    for(int i=0;i<3;i++)options.stdio[i]=stdio[i];
    QPAllocator memory={JS_GetRuntime(ctx),allocate,release};
    if(asynchronous){result=js_cosmo_process_start(ctx,&options,&memory,args[7]);goto done;}
    QPResult collected=qp_run(&options,&memory);
    result=collected.error==ENOMEM?JS_ThrowOutOfMemory(ctx):result_value(ctx,&collected);
    qp_result_free(&collected,&memory);
done:
    free_strings(ctx,candidates);free_strings(ctx,arguments);free_strings(ctx,environment);js_free(ctx,cwd);return result;
}
static JSValue signals(JSContext *ctx) {
    const struct {const char *name;int signal;} items[]={
        {"SIGHUP",SIGHUP},{"SIGINT",SIGINT},{"SIGQUIT",SIGQUIT},{"SIGILL",SIGILL},{"SIGTRAP",SIGTRAP},
        {"SIGABRT",SIGABRT},{"SIGBUS",SIGBUS},{"SIGFPE",SIGFPE},{"SIGKILL",SIGKILL},{"SIGUSR1",SIGUSR1},
        {"SIGSEGV",SIGSEGV},{"SIGUSR2",SIGUSR2},{"SIGPIPE",SIGPIPE},{"SIGALRM",SIGALRM},{"SIGTERM",SIGTERM},
        {"SIGCHLD",SIGCHLD},{"SIGCONT",SIGCONT},{"SIGSTOP",SIGSTOP},{"SIGTSTP",SIGTSTP},
        {"SIGTTIN",SIGTTIN},{"SIGTTOU",SIGTTOU},{"SIGURG",SIGURG},{"SIGXCPU",SIGXCPU},{"SIGXFSZ",SIGXFSZ},
        {"SIGVTALRM",SIGVTALRM},{"SIGPROF",SIGPROF},{"SIGWINCH",SIGWINCH},{"SIGSYS",SIGSYS}};
    JSValue object=JS_NewObject(ctx);if(JS_IsException(object))return object;
    for(size_t i=0;i<sizeof(items)/sizeof(*items);i++) {
        int internal=items[i].signal,public=internal;
        if(IsWindows()) {
            if(internal!=1&&internal!=2&&internal!=3&&internal!=4&&internal!=6&&internal!=8&&internal!=9&&internal!=11&&internal!=15&&internal!=28)continue;
            if(internal==6)public=22;
        } else if(IsXnu())for(int native=1;native<32;native++)if(__sig2linux(native)==internal){public=native;break;}
        JSValue pair=JS_NewArray(ctx);if(JS_IsException(pair))goto fail;
        if(JS_SetPropertyUint32(ctx,pair,0,JS_NewInt32(ctx,public))<0||JS_SetPropertyUint32(ctx,pair,1,JS_NewInt32(ctx,internal))<0){JS_FreeValue(ctx,pair);goto fail;}
        if(put(ctx,object,items[i].name,pair)<0)goto fail;
    }
    return object;
fail:JS_FreeValue(ctx,object);return JS_EXCEPTION;
}
JSValue js_cosmo_child_process_api(JSContext *ctx) {
    JSValue object=JS_NewObject(ctx);if(JS_IsException(object))return object;
    JSValue async=js_cosmo_process_async_api(ctx);if(JS_IsException(async)){JS_FreeValue(ctx,object);return async;}
    if(put(ctx,async,"start",JS_NewCFunctionMagic(ctx,run,"start",8,JS_CFUNC_generic_magic,1))<0){JS_FreeValue(ctx,async);JS_FreeValue(ctx,object);return JS_EXCEPTION;}
    if(put(ctx,object,"async",async)<0||put(ctx,object,"run",JS_NewCFunctionMagic(ctx,run,"run",7,JS_CFUNC_generic_magic,0))<0||put(ctx,object,"signals",signals(ctx))<0){JS_FreeValue(ctx,object);return JS_EXCEPTION;}
    return object;
}
