#include <cosmo.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include "binding.h"
#include "../module_registry.h"
#include "../runtime_state.h"
#include "../process/binding.h"
typedef struct {JSRuntime *rt;JSContext *ctx;JSValue callback;int referenced,owner;} Input;
static Input *reader;
static pthread_mutex_t mutex=PTHREAD_MUTEX_INITIALIZER;
static JSValue failure(JSContext *ctx,const char *code,const char *message){
    JSValue e=JS_NewError(ctx);if(JS_IsException(e))return e;
    if(JS_SetPropertyStr(ctx,e,"code",JS_NewString(ctx,code))<0||JS_SetPropertyStr(ctx,e,"message",JS_NewString(ctx,message))<0){JS_FreeValue(ctx,e);return JS_EXCEPTION;}return JS_Throw(ctx,e);
}
static void release(Input *input){if(!input)return;JSContext *ctx=input->ctx;JSValue callback=input->callback;js_free_rt(input->rt,input);JS_FreeValue(ctx,callback);JS_FreeContext(ctx);}
void js_cosmo_stdio_close_context(JSContext *ctx){pthread_mutex_lock(&mutex);Input *old=reader&&reader->ctx==ctx?reader:NULL;if(old)reader=NULL;pthread_mutex_unlock(&mutex);release(old);}
void js_cosmo_stdio_shutdown(JSRuntime *rt){pthread_mutex_lock(&mutex);Input *old=reader&&reader->rt==rt?reader:NULL;if(old)reader=NULL;pthread_mutex_unlock(&mutex);release(old);}
static void unwatch(JSContext *ctx,int owner){pthread_mutex_lock(&mutex);Input *old=reader&&reader->ctx==ctx&&reader->owner==owner?reader:NULL;if(old)reader=NULL;pthread_mutex_unlock(&mutex);release(old);}
static JSValue watch(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){
    if(argc<1)return JS_ThrowTypeError(ctx,"Missing stdin callback");
    int owner=0;if(argc>2&&JS_ToInt32(ctx,&owner,argv[2])<0)return JS_EXCEPTION;
    if(JS_IsNull(argv[0])){unwatch(ctx,owner);return JS_UNDEFINED;}
    if(!JS_IsFunction(ctx,argv[0]))return JS_ThrowTypeError(ctx,"Expected stdin callback");
    CosmoRuntimeState *state=js_cosmo_state(ctx);if(!state)return JS_EXCEPTION;
    if(state->worker)return failure(ctx,"ERR_WORKER_UNSUPPORTED_OPERATION","Shared stdin reading is unavailable in QuickJS Worker");
    if(js_cosmo_scheduler_stopped(ctx))return failure(ctx,"ERR_RUNTIME_CLOSED","Runtime is closed");
    int referenced=argc<2?1:JS_ToBool(ctx,argv[1]);if(referenced<0)return JS_EXCEPTION;
    pthread_mutex_lock(&mutex);int busy=reader&&(reader->ctx!=ctx||reader->owner!=owner);pthread_mutex_unlock(&mutex);
    if(busy)return failure(ctx,"ERR_STDIN_BUSY","Only one Context can read process stdin");
    Input *fresh=js_mallocz(ctx,sizeof(*fresh));if(!fresh)return JS_EXCEPTION;
    fresh->rt=JS_GetRuntime(ctx);fresh->ctx=JS_DupContext(ctx);fresh->callback=JS_DupValue(ctx,argv[0]);fresh->referenced=referenced;fresh->owner=owner;
    pthread_mutex_lock(&mutex);Input *old=reader;busy=old&&(old->ctx!=ctx||old->owner!=owner);if(!busy)reader=fresh;pthread_mutex_unlock(&mutex);
    if(busy){release(fresh);return failure(ctx,"ERR_STDIN_BUSY","Only one Context can read process stdin");}release(old);return JS_UNDEFINED;
}
static JSValue reference(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){int value=argc?JS_ToBool(ctx,argv[0]):1,owner=0;if(value<0||(argc>1&&JS_ToInt32(ctx,&owner,argv[1])<0))return JS_EXCEPTION;pthread_mutex_lock(&mutex);if(reader&&reader->ctx==ctx&&reader->owner==owner)reader->referenced=value;pthread_mutex_unlock(&mutex);return JS_UNDEFINED;}
int js_cosmo_stdio_pending(JSRuntime *rt){pthread_mutex_lock(&mutex);int result=reader&&reader->rt==rt&&reader->referenced;pthread_mutex_unlock(&mutex);return result;}
int js_cosmo_stdio_active(JSRuntime *rt){pthread_mutex_lock(&mutex);int result=reader&&reader->rt==rt;pthread_mutex_unlock(&mutex);return result;}
int js_cosmo_stdio_poll(JSContext *current){
    JSRuntime *rt=JS_GetRuntime(current);pthread_mutex_lock(&mutex);JSContext *ctx=reader&&reader->rt==rt?JS_DupContext(reader->ctx):NULL;JSValue callback=ctx?JS_DupValue(ctx,reader->callback):JS_UNDEFINED;pthread_mutex_unlock(&mutex);if(!ctx)return 0;
    int ready=0;if(js_cosmo_scheduler_stopped(ctx))js_cosmo_stdio_close_context(ctx);
    else {struct pollfd descriptor={0,POLLIN,0};if(poll(&descriptor,1,0)>0&&descriptor.revents){ready=1;JSValue result=JS_Call(ctx,callback,JS_UNDEFINED,0,NULL);if(JS_IsException(result)){js_cosmo_stdio_close_context(ctx);js_cosmo_scheduler_error(ctx);}JS_FreeValue(ctx,result);js_cosmo_checkpoint(ctx,1);}}
    JS_FreeValue(ctx,callback);JS_FreeContext(ctx);return ready;
}
static JSValue terminal(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){int fd;if(!argc)return JS_ThrowTypeError(ctx,"Missing stdio descriptor");if(JS_ToInt32(ctx,&fd,argv[0])<0)return JS_EXCEPTION;if(fd<0||fd>2)return JS_ThrowRangeError(ctx,"Invalid stdio descriptor");return JS_NewBool(ctx,isatty(fd));}
static ssize_t safe_write(int fd,const void *data,size_t length){
    struct stat st;int old_no_sig=-1;if(IsXnu()&&!fstat(fd,&st)&&S_ISFIFO(st.st_mode)){old_no_sig=fcntl(fd,74);if(old_no_sig<0||fcntl(fd,73,1)<0)return -1;}
    sigset_t blocked,original,pending;sigemptyset(&blocked);sigemptyset(&pending);sigaddset(&blocked,SIGPIPE);sigpending(&pending);int status=pthread_sigmask(SIG_BLOCK,&blocked,&original);
    if(status){if(old_no_sig>=0)fcntl(fd,73,old_no_sig);errno=status;return -1;}
    ssize_t count;do{count=write(fd,data,length);}while(count<0&&errno==EINTR);int saved=errno;
    if(count<0&&saved==EPIPE&&!sigismember(&pending,SIGPIPE)){struct timespec zero={0};while(sigtimedwait(&blocked,NULL,&zero)<0&&errno==EINTR){}}
    pthread_sigmask(SIG_SETMASK,&original,NULL);if(old_no_sig>=0)fcntl(fd,73,old_no_sig);errno=saved;return count;
}
static JSValue output(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){
    int fd;int64_t offset,length;if(argc<4)return JS_ThrowTypeError(ctx,"Missing stdio byte span");
    if(JS_ToInt32(ctx,&fd,argv[0])<0||JS_ToInt64(ctx,&offset,argv[2])<0||JS_ToInt64(ctx,&length,argv[3])<0)return JS_EXCEPTION;
    size_t size;uint8_t *data=JS_GetArrayBuffer(ctx,&size,argv[1]);if(JS_HasException(ctx))return JS_EXCEPTION;
    if((fd!=1&&fd!=2)||offset<0||length<0||(uint64_t)offset>size||(uint64_t)length>size-offset||length>65536)return JS_ThrowRangeError(ctx,"Invalid stdio byte span");
    ssize_t count=safe_write(fd,data?data+offset:NULL,length);if(count>=0)return JS_NewInt64(ctx,count);
    int saved=errno;JSValue info=js_cosmo_process_error_info(ctx,saved),e=JS_NewError(ctx);if(JS_IsException(info)||JS_IsException(e)){JS_FreeValue(ctx,info);JS_FreeValue(ctx,e);return JS_EXCEPTION;}
    for(const char **key=(const char *[]){"code","errno",NULL};*key;key++)if(JS_SetPropertyStr(ctx,e,*key,JS_GetPropertyStr(ctx,info,*key))<0)goto failed;
    if(JS_SetPropertyStr(ctx,e,"message",JS_NewString(ctx,strerror(saved)))<0||JS_SetPropertyStr(ctx,e,"syscall",JS_NewString(ctx,"write"))<0)goto failed;
    JS_FreeValue(ctx,info);return JS_Throw(ctx,e);
failed:JS_FreeValue(ctx,info);JS_FreeValue(ctx,e);return JS_EXCEPTION;
}
JSValue js_cosmo_stdio_api(JSContext *ctx){JSValue api=JS_NewObject(ctx);if(JS_IsException(api))return api;const struct {const char *name;JSCFunction *function;int length;} methods[]={{"watch",watch,2},{"ref",reference,1},{"isTTY",terminal,1},{"write",output,4}};for(size_t i=0;i<sizeof(methods)/sizeof(*methods);i++)if(JS_SetPropertyStr(ctx,api,methods[i].name,JS_NewCFunction(ctx,methods[i].function,methods[i].name,methods[i].length))<0){JS_FreeValue(ctx,api);return JS_EXCEPTION;}return api;}
