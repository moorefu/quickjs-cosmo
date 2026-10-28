#include <cosmo.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "async.h"
#include "sync.h"
#include "../tasks.h"
#include "../common/windows_host.h"

enum { OPEN,CLOSE,READ,WRITE,STAT,MKDIR,SCAN,RENAME,UNLINK,RMDIR,REALPATH,MKDTEMP,TRUNCATE,SYNC,ACCESS,CHMOD,CLOSE_HANDLE };
typedef struct {int fd;} Handle;
static JSClassID handle_class;
static pthread_once_t handle_once=PTHREAD_ONCE_INIT;
static void handle_id(void){JS_NewClassID(&handle_class);}
static void handle_finalize(JSRuntime *rt,JSValue value){Handle *h=JS_GetOpaque(value,handle_class);if(h){if(h->fd>=0)close(h->fd);js_free_rt(rt,h);}}
static const JSClassDef handle_definition={"QjsFileHandle",.finalizer=handle_finalize};
static JSValue handle_new(JSContext *ctx,int fd) {
    Handle *h=js_malloc(ctx,sizeof(*h));if(!h)return JS_EXCEPTION;
    JSValue value=JS_NewObjectProtoClass(ctx,JS_NULL,handle_class);
    if(JS_IsException(value)){js_free(ctx,h);return value;}h->fd=fd;JS_SetOpaque(value,h);return value;
}
static JSValue handle_control(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args,int magic) {
    if(!argc)return JS_ThrowTypeError(ctx,"Missing native file handle");
    Handle *h=JS_GetOpaque2(ctx,args[0],handle_class);if(!h)return JS_EXCEPTION;
    int fd=h->fd;if(magic!=2)h->fd=-1;
    if(magic==1){if(fd>=0 && close(fd)<0)return js_cosmo_fs_error(ctx,errno,"close");return JS_UNDEFINED;}
    return JS_NewInt32(ctx,fd);
}
typedef struct Entry {struct Entry *next;unsigned type;char name[];} Entry;
typedef struct {
    int operation,fd,lease,n,mode,opened;
    int64_t length,position,result;
    size_t amount;
    char *a,*b,*resolved;
    uint8_t *bytes;
    struct stat stat;
    Entry *entries;
    const char *syscall;
} Request;
static void cleanup(QJSCosmoTask *task) {
    Request *r=js_cosmo_task_data(task);
    if(r->lease>=0)close(r->lease);
    if(r->opened>=0)close(r->opened);
}
static int work(QJSCosmoTask *task) {
    Request *r=js_cosmo_task_data(task);int rc=0;
    switch(r->operation) {
    case OPEN:
        r->syscall="open";
        if((IsWindows() && (r->n&~(3|256|1024|512|8))) ||
           (IsXnu() && (r->n&~(3|0x200|0x800|0x400|8|0x100000|0x100|0x20000|4|0x400000|0x80))))return EINVAL;
        do{rc=qjs_cosmo_fs_openat(AT_FDCWD,r->a,js_cosmo_fs_flags(r->n)|O_CLOEXEC,r->mode);}while(rc<0 && errno==EINTR && !js_cosmo_task_cancelled(task));
        if(rc>=0)r->opened=rc;
        break;
    case CLOSE:r->syscall="close";rc=close(r->fd);if(r->lease==r->fd)r->lease=-1;break;
    case READ:case WRITE:
        r->syscall=r->operation==READ?"read":"write";
        if(!r->length){r->result=0;return 0;}
        do {
            if(r->operation==READ)r->result=r->position<0?read(r->lease,r->bytes,r->length):pread(r->lease,r->bytes,r->length,r->position);
            else r->result=r->position<0?write(r->lease,r->bytes,r->length):pwrite(r->lease,r->bytes,r->length,r->position);
        }while(r->result<0 && errno==EINTR && !js_cosmo_task_cancelled(task));
        return r->result<0?errno:0;
    case STAT:
        r->syscall=r->n==2?"fstat":r->n==1?"lstat":"stat";
        do{rc=r->n==2?fstat(r->lease,&r->stat):r->n==1?lstat(r->a,&r->stat):stat(r->a,&r->stat);}while(rc<0 && errno==EINTR && !js_cosmo_task_cancelled(task));break;
    case MKDIR:r->syscall="mkdir";rc=qjs_cosmo_fs_mkdirat(AT_FDCWD,r->a,r->n);break;
    case SCAN: {
        r->syscall="scandir";DIR *directory=opendir(r->a);if(!directory)return errno;
        Entry **tail=&r->entries;int error=0;
        for(;;) {
            if(js_cosmo_task_cancelled(task)){error=ECANCELED;break;}
            errno=0;struct dirent *entry=readdir(directory);
            if(!entry){error=errno;break;}
            if(!strcmp(entry->d_name,".") || !strcmp(entry->d_name,".."))continue;
            size_t length=strlen(entry->d_name);Entry *copy=js_cosmo_task_alloc(task,sizeof(*copy)+length+1);
            if(!copy){error=ENOMEM;break;}
            copy->next=NULL;copy->type=entry->d_type;memcpy(copy->name,entry->d_name,length+1);*tail=copy;tail=&copy->next;
        }
        if(closedir(directory)<0 && !error)error=errno;
        return error;
    }
    case RENAME:r->syscall="rename";rc=qjs_cosmo_fs_renameat(AT_FDCWD,r->a,AT_FDCWD,r->b);break;
    case UNLINK:r->syscall="unlink";rc=unlink(r->a);break;
    case RMDIR:r->syscall="rmdir";rc=rmdir(r->a);break;
    case REALPATH: {
        r->syscall="realpath";char *path=js_cosmo_host_realpath(r->a,NULL);if(!path)return errno;
        size_t length=strlen(path);r->resolved=js_cosmo_task_alloc(task,length+3);
        if(!r->resolved){free(path);return ENOMEM;}
        memcpy(r->resolved,path,length+1);free(path);
        if(IsWindows()) {
            char *p=r->resolved;
            if(p[0]=='/' && p[1] && p[2]=='/' && ((p[1]>='A' && p[1]<='Z') || (p[1]>='a' && p[1]<='z'))){p[0]=p[1];p[1]=':';}
            else if(p[0]=='/' && p[1]!='/'){memmove(p+2,p,length+1);p[0]=js_cosmo_windows_root_drive();p[1]=':';}
            for(;*p;p++)if(*p=='/')*p='\\';
        }
        break;
    }
    case MKDTEMP:r->syscall="mkdtemp";if(!qjs_cosmo_fs_mkdtemp(r->a))rc=-1;else r->resolved=r->a;break;
    case TRUNCATE:r->syscall="ftruncate";do{rc=ftruncate(r->lease,r->length);}while(rc<0 && errno==EINTR && !js_cosmo_task_cancelled(task));break;
    case SYNC:r->syscall="fsync";do{rc=fsync(r->lease);}while(rc<0 && errno==EINTR && !js_cosmo_task_cancelled(task));break;
    case ACCESS:r->syscall="access";rc=access(r->a,IsWindows()?r->n&~X_OK:r->n);break;
    case CHMOD:r->syscall="fchmod";rc=fchmod(r->lease,r->n);break;
    default:return EINVAL;
    }
    return rc<0?errno:0;
}
static JSValue finish(JSContext *ctx,QJSCosmoTask *task,int error) {
    Request *r=js_cosmo_task_data(task);
    if(IsWindows() && error==ENOTDIR && (r->operation==OPEN || r->operation==RMDIR || (r->operation==STAT && r->n!=2)))error=ENOENT;
    if((IsWindows() || IsXnu()) && error==EISDIR && r->operation==UNLINK)error=EPERM;
    if(IsWindows() && error==EACCES && r->operation==SYNC)error=EPERM;
    if(error==ENOMEM)return JS_ThrowOutOfMemory(ctx);
    if(error==ECANCELED) {
        JSValue e=JS_NewError(ctx);if(JS_IsException(e))return e;
        JS_SetPropertyStr(ctx,e,"code",JS_NewString(ctx,"ECANCELED"));return JS_Throw(ctx,e);
    }
    if(error)return js_cosmo_fs_error(ctx,error,r->syscall?r->syscall:"fs");
    switch(r->operation) {
    case OPEN:{JSValue value=handle_new(ctx,r->opened);if(!JS_IsException(value))r->opened=-1;return value;}
    case READ: {
        JSValue result=JS_NewObject(ctx);if(JS_IsException(result))return result;
        JSValue buffer=JS_NewArrayBufferCopy(ctx,r->bytes,r->result);
        if(JS_IsException(buffer) || JS_SetPropertyStr(ctx,result,"buffer",buffer)<0 || JS_SetPropertyStr(ctx,result,"count",JS_NewInt64(ctx,r->result))<0){JS_FreeValue(ctx,result);return JS_EXCEPTION;}
        return result;
    }
    case WRITE:return JS_NewInt64(ctx,r->result);
    case STAT:return js_cosmo_fs_stat(ctx,&r->stat);
    case REALPATH:case MKDTEMP:return JS_NewArrayBufferCopy(ctx,(uint8_t *)r->resolved,strlen(r->resolved));
    case SCAN: {
        JSValue list=JS_NewArray(ctx);if(JS_IsException(list))return list;
        uint32_t index=0;
        for(Entry *entry=r->entries;entry;entry=entry->next) {
            JSValue pair=JS_NewArray(ctx);if(JS_IsException(pair))goto fail;
            JSValue bytes=JS_NewArrayBufferCopy(ctx,(uint8_t *)entry->name,strlen(entry->name));
            if(JS_IsException(bytes) || JS_SetPropertyUint32(ctx,pair,0,bytes)<0 || JS_SetPropertyUint32(ctx,pair,1,JS_NewInt32(ctx,entry->type))<0){JS_FreeValue(ctx,pair);goto fail;}
            if(JS_SetPropertyUint32(ctx,list,index++,pair)<0)goto fail;
        }
        return list;
    fail:JS_FreeValue(ctx,list);return JS_EXCEPTION;
    }
    default:return JS_UNDEFINED;
    }
}
static JSValue call(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args,int operation) {
    const int required[]={3,1,5,5,2,2,1,2,1,1,1,1,2,1,2,2,1};
    const char *names[]={"open","close","read","write","stat","mkdir","scandir","rename","unlink","rmdir","realpath","mkdtemp","ftruncate","fsync","access","fchmod","close"};
    if(operation<0 || operation>=sizeof(required)/sizeof(*required) || argc<required[operation])return JS_ThrowTypeError(ctx,"Invalid native async fs arguments");
    Handle *closing=NULL;
    if(operation==CLOSE_HANDLE){closing=JS_GetOpaque2(ctx,args[0],handle_class);if(!closing)return JS_EXCEPTION;operation=CLOSE;}
    Request value={.operation=operation,.fd=-1,.lease=-1,.opened=-1};
    char *a=NULL,*b=NULL;uint8_t *input=NULL;size_t input_length=0;int64_t offset=0;size_t budget=16384;
    if(operation==STAT && JS_ToInt32(ctx,&value.n,args[1])<0)return JS_EXCEPTION;
    value.syscall=operation==STAT?(value.n==2?"fstat":value.n==1?"lstat":"stat"):names[operation];
    int descriptor=operation==CLOSE || operation==READ || operation==WRITE || operation==TRUNCATE || operation==SYNC || operation==CHMOD || (operation==STAT && value.n==2);
    if(descriptor){if(closing)value.fd=closing->fd;else if(JS_ToInt32(ctx,&value.fd,args[0])<0)return JS_EXCEPTION;}
    else {a=js_cosmo_fs_path(ctx,args[0]);if(!a)return JS_EXCEPTION;budget+=strlen(a)+8;}
    if(operation==RENAME){b=js_cosmo_fs_path(ctx,args[1]);if(!b)goto exception;budget+=strlen(b)+1;}
    if(operation==READ || operation==WRITE) {
        if(JS_ToInt64(ctx,&offset,args[2])<0 || JS_ToInt64(ctx,&value.length,args[3])<0 ||
           (JS_IsBigInt(ctx,args[4])?JS_ToBigInt64(ctx,&value.position,args[4]):JS_ToInt64(ctx,&value.position,args[4]))<0)goto exception;
        input=JS_GetArrayBuffer(ctx,&input_length,args[1]);if(JS_HasException(ctx))goto exception;
        if(offset<0 || value.length<0 || (uint64_t)offset>input_length || (uint64_t)value.length>input_length-(uint64_t)offset){JS_ThrowRangeError(ctx,"Invalid native async I/O span");goto exception;}
        if(value.length>64*1024*1024){JS_ThrowRangeError(ctx,"Native task I/O exceeds arena limit");goto exception;}
        budget+=value.length;
    } else if(operation==OPEN) {
        if(JS_ToInt32(ctx,&value.n,args[1])<0 || JS_ToInt32(ctx,&value.mode,args[2])<0)goto exception;
    } else if(operation==MKDIR || operation==ACCESS || operation==CHMOD) {
        if(JS_ToInt32(ctx,&value.n,args[1])<0)goto exception;
    } else if(operation==TRUNCATE && JS_ToInt64(ctx,&value.length,args[1])<0)goto exception;
    if(operation==SCAN)budget+=4*1024*1024;
    QJSCosmoTask *task=js_cosmo_task_create(ctx,budget,sizeof(Request),work,finish);if(!task)goto exception;
    Request *r=js_cosmo_task_data(task);*r=value;js_cosmo_task_set_cleanup(task,cleanup);
    if(a) {
        size_t length=strlen(a);r->a=js_cosmo_task_alloc(task,length+8);if(!r->a)goto memory;
        memcpy(r->a,a,length+1);if(operation==MKDTEMP)memcpy(r->a+length,"XXXXXX",7);
    }
    if(b){size_t length=strlen(b);r->b=js_cosmo_task_alloc(task,length+1);if(!r->b)goto memory;memcpy(r->b,b,length+1);}
    if(operation==READ || operation==WRITE) {
        r->bytes=js_cosmo_task_alloc(task,r->length?r->length:1);if(!r->bytes)goto memory;
        if(operation==WRITE && r->length)memcpy(r->bytes,input+offset,r->length);
    }
    if(descriptor && operation!=CLOSE && !((operation==READ || operation==WRITE) && !r->length)) {
        do{r->lease=fcntl(r->fd,F_DUPFD_CLOEXEC,3);}while(r->lease<0 && errno==EINTR);
        if(r->lease<0){int error=errno;js_cosmo_task_discard(task);js_free(ctx,a);js_free(ctx,b);return js_cosmo_fs_error(ctx,error,value.syscall);}
    }
    if(closing){r->lease=r->fd;closing->fd=-1;}
    uint64_t id;JSValue promise=js_cosmo_task_submit(ctx,task,&id);js_free(ctx,a);js_free(ctx,b);
    if(JS_IsException(promise))return promise;
    JSValue result=JS_NewObject(ctx);if(JS_IsException(result)){JS_FreeValue(ctx,promise);js_cosmo_task_cancel(ctx,id);return result;}
    if(JS_SetPropertyStr(ctx,result,"promise",promise)<0 || JS_SetPropertyStr(ctx,result,"id",JS_NewInt64(ctx,id))<0){JS_FreeValue(ctx,result);js_cosmo_task_cancel(ctx,id);return JS_EXCEPTION;}
    return result;
memory:js_cosmo_task_discard(task);JS_ThrowOutOfMemory(ctx);
exception:js_free(ctx,a);js_free(ctx,b);return JS_EXCEPTION;
}
static JSValue cancel(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args) {
    int64_t id;if(JS_ToInt64(ctx,&id,args[0])<0)return JS_EXCEPTION;return JS_NewBool(ctx,js_cosmo_task_cancel(ctx,id));
}
JSValue js_cosmo_fs_async_api(JSContext *ctx) {
    pthread_once(&handle_once,handle_id);
    if(!JS_IsRegisteredClass(JS_GetRuntime(ctx),handle_class) && JS_NewClass(JS_GetRuntime(ctx),handle_class,&handle_definition)<0)return JS_ThrowInternalError(ctx,"Cannot register FileHandle owner");
    JSValue api=JS_NewObject(ctx);if(JS_IsException(api))return api;
    const char *names[]={"open","close","read","write","stat","mkdir","scan","rename","unlink","rmdir","realpath","mkdtemp","truncate","sync","access","chmod","closeHandle"};
    for(int i=0;i<sizeof(names)/sizeof(*names);i++)if(JS_SetPropertyStr(ctx,api,names[i],JS_NewCFunctionMagic(ctx,call,names[i],5,JS_CFUNC_generic_magic,i))<0)goto fail;
    if(JS_SetPropertyStr(ctx,api,"cancel",JS_NewCFunction(ctx,cancel,"cancel",1))<0)goto fail;
    const char *controls[]={"takeHandle","dropHandle","handleFd"};
    for(int i=0;i<3;i++)if(JS_SetPropertyStr(ctx,api,controls[i],JS_NewCFunctionMagic(ctx,handle_control,controls[i],1,JS_CFUNC_generic_magic,i))<0)goto fail;
    return api;
fail:JS_FreeValue(ctx,api);return JS_EXCEPTION;
}
