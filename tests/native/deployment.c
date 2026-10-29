#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/auxv.h>
#include <sys/stat.h>
#include <unistd.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
#include "tls_flags.h"
static JSContext *worker_context(JSRuntime *rt){JSContext *ctx=JS_NewContext(rt);if(ctx&&js_cosmo_init_modules(ctx)<0){js_std_dump_error(ctx);JS_FreeContext(ctx);return NULL;}return ctx;}
static int probe(const char *root){
    if(qjs_test_tls_flags()){fprintf(stderr,"TLS getter changed status flags\n");return 1;}
    printf("DEPLOYMENT_ERRNO {\"ENOSYS\":%d,\"ENOTSUP\":%d,\"EACCES\":%d,\"EPERM\":%d,\"ENOENT\":%d}\n",ENOSYS,ENOTSUP,EACCES,EPERM,ENOENT);
    char file[4096];snprintf(file,sizeof(file),"%s/fifo",root);errno=0;int fifo=mknod(file,S_IFIFO|0600,0),fifo_error=errno;
    if(!fifo){struct stat st;assert(!stat(file,&st)&&S_ISFIFO(st.st_mode));assert(!unlink(file));}
    errno=0;long cpus=sysconf(_SC_NPROCESSORS_ONLN);int cpu_error=errno;
    char zero[32];memset(zero,255,sizeof(zero));errno=0;int fd=open("/dev/zero",O_RDONLY),zero_error=errno;ssize_t count=-1;int all=1;
    if(fd>=0){count=read(fd,zero,sizeof(zero));zero_error=errno;close(fd);for(int i=0;i<32;i++)if(zero[i])all=0;}
    printf("DEPLOYMENT_NATIVE {\"pageSize\":%d,\"auxPageSize\":%lu,\"legacyPid\":%d,\"cpuCount\":%ld,\"cpuError\":%d,\"fifo\":%d,\"fifoError\":%d,\"zeroBytes\":%ld,\"zeroError\":%d,\"zeroContent\":%s}\n",getpagesize(),getauxval(6),getpid(),cpus,cpu_error,fifo,fifo_error,count,zero_error,all?"true":"false");
    return 0;
}
int main(int argc,char **argv){
    if(argc==3&&!strcmp(argv[1],"--native-probe"))return probe(argv[2]);
    assert(argc==2);js_std_set_worker_new_context_func(worker_context);
    JSRuntime *rt=JS_NewRuntime();assert(rt);js_std_init_handlers(rt);JSContext *ctx=JS_NewContext(rt);assert(ctx);assert(!js_cosmo_init_modules(ctx));
    JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
    JSValue native=JS_NewObject(ctx),args=JS_NewArray(ctx);assert(!JS_IsException(native));
    assert(0<=JS_SetPropertyStr(ctx,native,"pageSize",JS_NewInt32(ctx,getpagesize())));
    assert(0<=JS_SetPropertyStr(ctx,native,"auxPageSize",JS_NewInt64(ctx,getauxval(6))));
    for(int i=0;i<argc;i++)assert(0<=JS_SetPropertyUint32(ctx,args,i,JS_NewString(ctx,argv[i])));
    assert(0<=JS_SetPropertyStr(ctx,native,"argv",args));
    JSValue global=JS_GetGlobalObject(ctx);assert(0<=JS_SetPropertyStr(ctx,global,"deploymentNative",native));JS_FreeValue(ctx,global);
    size_t length;uint8_t *source=js_load_file(ctx,&length,argv[1]);assert(source);
    JSValue value=JS_Eval(ctx,(char *)source,length,argv[1],JS_EVAL_TYPE_MODULE|JS_EVAL_FLAG_COMPILE_ONLY);js_free(ctx,source);
    if(!JS_IsException(value)&&js_module_set_import_meta(ctx,value,1,1)<0){JS_FreeValue(ctx,value);value=JS_EXCEPTION;}
    if(!JS_IsException(value))value=JS_EvalFunction(ctx,value);
    if(!JS_IsException(value))value=js_std_await(ctx,value);
    int failed=JS_IsException(value);if(failed)js_std_dump_error(ctx);JS_FreeValue(ctx,value);if(!failed)js_std_loop(ctx);
    js_std_free_handlers(rt);JS_FreeContext(ctx);JS_FreeRuntime(rt);return failed;
}
