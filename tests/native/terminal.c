#include <assert.h>
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>
#include <cosmo.h>
#ifdef __x86_64__
#include "libc/calls/internal.h"
#include "libc/nt/console.h"
#include "libc/nt/createfile.h"
#include "libc/nt/runtime.h"
#endif
#include "quickjs-libc.h"
extern char **environ;

typedef struct {
    int valid;
    struct termios attr;
#ifdef __x86_64__
    uint32_t input,output;
#endif
} Snapshot;
#ifdef __x86_64__
typedef struct { int valid;uint16_t attributes;uint32_t visible;struct NtCharInfo row[64]; } Display;
static Display display(void) {
    Display d={0};
    int64_t handle=CreateFile(u"CONOUT$",0xc0000000,3,NULL,3,0,0);
    struct NtConsoleScreenBufferInfo info={0};struct NtConsoleCursorInfo cursor={0};
    struct NtSmallRect area={0,0,63,0};struct NtCoord size={64,1},origin={0,0};
    d.valid=GetConsoleScreenBufferInfo(handle,&info)&&GetConsoleCursorInfo(handle,&cursor)&&ReadConsoleOutput(handle,d.row,size,origin,&area);
    d.attributes=info.wAttributes;d.visible=cursor.bVisible;CloseHandle(handle);return d;
}
static int same_display(Display a,Display b) {
    return a.valid&&b.valid&&a.attributes==b.attributes&&a.visible==b.visible&&!memcmp(a.row,b.row,sizeof(a.row));
}
#endif
static Snapshot snapshot(void) {
    Snapshot s={0};s.valid=isatty(0)&&isatty(1)&&!tcgetattr(0,&s.attr);
#ifdef __x86_64__
    if(IsWindows())s.valid=s.valid&&GetConsoleMode(GetConsoleInputHandle(),&s.input)&&GetConsoleMode(GetConsoleOutputHandle(),&s.output);
#endif
    return s;
}
static int equal(Snapshot a,Snapshot b) {
    if(!a.valid||!b.valid)return 0;
#ifdef __x86_64__
    if(IsWindows())return a.input==b.input&&a.output==b.output;
#endif
    return a.attr.c_iflag==b.attr.c_iflag&&a.attr.c_oflag==b.attr.c_oflag&&
        a.attr.c_cflag==b.attr.c_cflag&&a.attr.c_lflag==b.attr.c_lflag&&
        !memcmp(a.attr.c_cc,b.attr.c_cc,sizeof(a.attr.c_cc))&&
        cfgetispeed(&a.attr)==cfgetispeed(&b.attr)&&cfgetospeed(&a.attr)==cfgetospeed(&b.attr);
}
static int64_t milliseconds(void) {
    struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (int64_t)t.tv_sec*1000+t.tv_nsec/1000000;
}
static void report_modes(const char *name,Snapshot s) {
#ifdef __x86_64__
    if(IsWindows()) {printf("TTY_CONTROL %s [%u,%u]\n",name,s.input,s.output);fflush(stdout);return;}
#endif
    printf("TTY_CONTROL %s [%lu,%lu,%lu,%lu]\n",name,(unsigned long)s.attr.c_iflag,(unsigned long)s.attr.c_oflag,(unsigned long)s.attr.c_cflag,(unsigned long)s.attr.c_lflag);fflush(stdout);
}
static int supervise(int argc,char **argv) {
    if(argc<4)return 2;
    Snapshot before=snapshot();if(!before.valid) {puts("TTY_CONTROL INVALID");return 2;}
    report_modes("BEFORE",before);
#ifdef __x86_64__
    Display display_before={0};if(IsWindows())display_before=display();
#endif
    pid_t child;int error=posix_spawn(&child,argv[3],NULL,NULL,argv+3,environ);
    if(error) {printf("TTY_CONTROL SPAWN_ERROR [%d]\n",error);return 3;}
    int status=0,timed_out=0;int64_t deadline=milliseconds()+20000;
    for(;;) {
        pid_t rc=waitpid(child,&status,WNOHANG);
        if(rc==child)break;
        if(rc<0&&errno!=EINTR) {printf("TTY_CONTROL WAIT_ERROR [%d]\n",errno);return 3;}
        char command[32]={0};FILE *control=fopen(argv[2],"rb");
        if(control) {fread(command,1,sizeof(command)-1,control);fclose(control);unlink(argv[2]);}
        if(!strncmp(command,"CHECK",5))report_modes("CHECK",snapshot());
        else if(!strncmp(command,"TERM",4)||!strncmp(command,"INT",3)||!strncmp(command,"HUP",3)) {
            int number=command[0]=='T'?SIGTERM:command[0]=='I'?SIGINT:SIGHUP;
            int result=kill(child,number),saved=errno;
            printf("TTY_CONTROL SIGNAL [%d,%d,%d]\n",number,result,result?saved:0);fflush(stdout);
        }
        if(milliseconds()>=deadline) {timed_out=1;kill(child,SIGKILL);while(waitpid(child,&status,0)<0&&errno==EINTR){}break;}
        struct timespec pause={0,10000000};nanosleep(&pause,NULL);
    }
    Snapshot after=snapshot();
#ifdef __x86_64__
    const char *mode=getenv("QJS_TERMINAL_CASE");
    if(IsWindows()&&mode&&!strncmp(mode,"sample",6)) {
        int display_restored=same_display(display_before,display());
        printf("TTY_CONTROL DISPLAY [%d]\n",display_restored);fflush(stdout);
        if(!display_restored)before.valid=0;
    }
#endif
    report_modes("AFTER",after);
    int code=IsWindows()?status:WIFEXITED(status)?WEXITSTATUS(status):-1;
    int number=IsWindows()?0:WIFSIGNALED(status)?WTERMSIG(status):0,restored=equal(before,after);
    printf("TTY_CONTROL RESULT [%d,%d,%d,%d,%u]\n",restored,code,number,timed_out,(uint32_t)status);fflush(stdout);
    return restored&&!timed_out?0:1;
}
static JSContext *new_context(JSRuntime *rt) {
    JSContext *ctx=JS_NewContext(rt);if(ctx&&js_cosmo_init_modules(ctx)<0) {JS_FreeContext(ctx);return NULL;}return ctx;
}
static int lifecycle(void) {
    Snapshot before=snapshot();assert(before.valid);
    JSRuntime *rt=JS_NewRuntime();assert(rt);js_std_init_handlers(rt);
    void *opaque=JS_GetRuntimeOpaque(rt);
    for(int i=0;i<16;i++) {
        JSContext *first=new_context(rt),*second=new_context(rt);assert(first&&second);
        JS_SetContextOpaque(first,&i);JS_SetContextOpaque(second,&i);
        JSValue argv[]={JS_NewInt32(first,0),JS_TRUE};
        JSValue value=js_cosmo_tty_legacy(first,2,argv);assert(!JS_IsException(value));JS_FreeValue(first,value);
        value=js_cosmo_tty_legacy(first,2,argv);assert(!JS_IsException(value));JS_FreeValue(first,value);
        value=js_cosmo_tty_legacy(second,2,argv);assert(!JS_IsException(value));JS_FreeValue(second,value);
        assert(!equal(before,snapshot()));assert(JS_GetContextOpaque(first)==&i);
        JS_FreeContext(first);JS_RunGC(rt);assert(!equal(before,snapshot()));
        JS_FreeContext(second);JS_RunGC(rt);assert(equal(before,snapshot()));
        assert(JS_GetRuntimeOpaque(rt)==opaque);
    }
    JSContext *ctx=new_context(rt);JSValue argv[]={JS_NewInt32(ctx,0)};
    JSValue value=js_cosmo_tty_legacy(ctx,1,argv);assert(!JS_IsException(value));JS_FreeValue(ctx,value);
    js_std_free_handlers(rt);assert(equal(before,snapshot()));JS_FreeContext(ctx);JS_FreeRuntime(rt);
    puts("TTY_EVENT {\"kind\":\"done\",\"value\":\"lifecycle\"}");return 0;
}
int main(int argc,char **argv) {
#ifdef __x86_64__
    /* An embedding host can configure its console before starting QuickJS.
       Exercise exact restoration when output VT was initially disabled. */
    if(IsWindows()&&getenv("QJS_TERMINAL_TEST_NO_VT")) {
        uint32_t mode;int64_t output=GetConsoleOutputHandle();
        assert(GetConsoleMode(output,&mode));assert(SetConsoleMode(output,mode&~4u));
    }
#endif
    if(argc>1&&!strcmp(argv[1],"--supervise"))return supervise(argc,argv);
    if(argc>1&&!strcmp(argv[1],"--lifecycle"))return lifecycle();
    if(argc<2)return 2;
    JSRuntime *rt=JS_NewRuntime();if(!rt)return 2;js_std_init_handlers(rt);js_std_set_worker_new_context_func(new_context);
    JSContext *ctx=JS_NewContext(rt);if(!ctx) {js_std_free_handlers(rt);JS_FreeRuntime(rt);return 2;}
    int opaque=1234;JS_SetContextOpaque(ctx,&opaque);
    if(js_cosmo_init_modules(ctx)<0)return 2;
    JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
    js_std_add_helpers(ctx,argc-1,argv+1);
    if(js_cosmo_set_cli(ctx,argc,argv,1,3)<0)return 2;
    JSValue global=JS_GetGlobalObject(ctx);JS_SetPropertyStr(ctx,global,"terminalSDK",JS_TRUE);JS_FreeValue(ctx,global);
    size_t length;uint8_t *source=js_load_file(ctx,&length,argv[1]);
    JSValue value=source?JS_Eval(ctx,(char*)source,length,argv[1],JS_EVAL_TYPE_MODULE|JS_EVAL_FLAG_COMPILE_ONLY):JS_EXCEPTION;
    js_free(ctx,source);
    if(!JS_IsException(value)&&js_module_set_import_meta(ctx,value,1,1)<0) {JS_FreeValue(ctx,value);value=JS_EXCEPTION;}
    if(!JS_IsException(value))value=JS_EvalFunction(ctx,value);
    if(!JS_IsException(value))value=js_std_await(ctx,value);
    int failed=JS_IsException(value);if(failed)js_std_dump_error(ctx);JS_FreeValue(ctx,value);
    if(!failed)js_std_loop(ctx);
    int code=failed?1:js_cosmo_exit_code(ctx);assert(JS_GetContextOpaque(ctx)==&opaque);
    js_std_free_handlers(rt);JS_FreeContext(ctx);JS_FreeRuntime(rt);return code;
}
