#include <cosmo.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <termios.h>
#include <unistd.h>
#ifdef __x86_64__
#include "libc/calls/internal.h"
#include "libc/intrin/nomultics.h"
#include "libc/nt/console.h"
#endif
#include "tty.h"
#include "module_registry.h"
#include "runtime_state.h"
#include "process/binding.h"

enum { DEVICE_LIMIT=16, OWNER_LIMIT=64, DEPTH_LIMIT=32, SIGNAL_COUNT=8, RESOURCE_LIMIT=-2 };
typedef struct {
    int active, fd, refs, full;
    dev_t dev, rdev;
    ino_t ino;
    pid_t foreground;
    struct termios original;
#ifdef __x86_64__
    int64_t input, output;
    uint32_t input_mode, output_mode;
    int has_input, has_output;
    struct TtyConf original_conf;
#endif
} Device;
typedef struct {
    JSContext *ctx;
    JSRuntime *rt;
    int fd, token, depth, device;
} Owner;
static Device devices[DEVICE_LIMIT];
static Owner owners[OWNER_LIMIT];
static int signals[SIGNAL_COUNT], installed[SIGNAL_COUNT];
static struct sigaction previous[SIGNAL_COUNT];
static sigset_t guarded_signals;
static pthread_once_t once=PTHREAD_ONCE_INIT;
static atomic_flag locked=ATOMIC_FLAG_INIT;
static pid_t owner_pid;

/* No JS, allocation or pthread mutex may run under this lock. Blocking the
   guarded signals prevents reentering the lock on its owning thread. */
static void lock(sigset_t *old) {
    pthread_sigmask(SIG_BLOCK,&guarded_signals,old);
    while(atomic_flag_test_and_set_explicit(&locked,memory_order_acquire)) {}
}
static void unlock(const sigset_t *old) {
    atomic_flag_clear_explicit(&locked,memory_order_release);
    pthread_sigmask(SIG_SETMASK,old,NULL);
}
static int restore(Device *device) {
    int rc=tcsetattr(device->fd,TCSANOW,&device->original),saved=errno;
#ifdef __x86_64__
    if(IsWindows()) {
        __ttyconf=device->original_conf;
        if(device->has_input&&!SetConsoleMode(device->input,device->input_mode)) {rc=-1;saved=EIO;}
        if(device->has_output&&!SetConsoleMode(device->output,device->output_mode)) {rc=-1;saved=EIO;}
    }
#endif
    errno=saved;return rc;
}
static void restore_locked(void) {
    if(owner_pid!=getpid())return; /* A fork/vfork child does not own its parent's modes. */
    for(int i=0;i<DEVICE_LIMIT;i++)if(devices[i].active) {
        restore(&devices[i]);close(devices[i].fd);memset(&devices[i],0,sizeof(Device));
    }
    memset(owners,0,sizeof(owners));
}
static void terminal_signal(int number) {
    int saved=errno;sigset_t old;lock(&old);restore_locked();
    for(int i=0;i<SIGNAL_COUNT;i++)if(signals[i]==number) {
        sigaction(number,&previous[i],NULL);installed[i]=0;break;
    }
    unlock(&old);errno=saved;raise(number);
}
static void remove_guards(void) {
    for(int i=0;i<SIGNAL_COUNT;i++)if(installed[i]) {
        struct sigaction current;
        if(!sigaction(signals[i],NULL,&current)&&current.sa_handler==terminal_signal)
            sigaction(signals[i],&previous[i],NULL);
        installed[i]=0;
    }
}
void js_cosmo_tty_restore_all(void) {
    if(owner_pid!=getpid())return;
    sigset_t old;lock(&old);restore_locked();remove_guards();unlock(&old);
}
static void initialize(void) {
    int values[SIGNAL_COUNT]={SIGINT,SIGTERM,SIGHUP,SIGQUIT,SIGABRT,SIGUSR1,SIGUSR2,SIGALRM};
    memcpy(signals,values,sizeof(signals));sigemptyset(&guarded_signals);
    for(int i=0;i<SIGNAL_COUNT;i++)sigaddset(&guarded_signals,signals[i]);
    owner_pid=getpid();atexit(js_cosmo_tty_restore_all);
}
static int has_devices(void) {
    for(int i=0;i<DEVICE_LIMIT;i++)if(devices[i].active)return 1;
    return 0;
}
static void install_guards(void) {
    for(int i=0;i<SIGNAL_COUNT;i++)if(!installed[i]) {
        struct sigaction current;
        if(!sigaction(signals[i],NULL,&current)&&current.sa_handler==SIG_DFL) {
            struct sigaction action={0};action.sa_handler=terminal_signal;sigemptyset(&action.sa_mask);
            if(!sigaction(signals[i],&action,&previous[i]))installed[i]=1;
        }
    }
}
void js_cosmo_tty_signal(int number,void (*handler)(int)) {
    pthread_once(&once,initialize);sigset_t old;lock(&old);
    int index=-1;for(int i=0;i<SIGNAL_COUNT;i++)if(signals[i]==number)index=i;
    if(index>=0)installed[index]=0;
    if(index>=0&&handler==SIG_DFL&&has_devices()) {
        memset(&previous[index],0,sizeof(previous[index]));previous[index].sa_handler=SIG_DFL;
        sigemptyset(&previous[index].sa_mask);handler=terminal_signal;installed[index]=1;
    }
    signal(number,handler);unlock(&old);
}
static int apply(Device *device) {
    struct termios raw=device->original;
    raw.c_iflag&=~(IGNBRK|BRKINT|PARMRK|ISTRIP|INLCR|IGNCR|ICRNL|IXON);
    raw.c_oflag|=OPOST;
    raw.c_lflag&=~(ECHO|ECHONL|ICANON|IEXTEN);
    if(device->full)raw.c_lflag&=~ISIG;
    raw.c_cflag&=~(CSIZE|PARENB);raw.c_cflag|=CS8;
    raw.c_cc[VMIN]=1;raw.c_cc[VTIME]=0;
    int rc=tcsetattr(device->fd,TCSANOW,&raw);
#ifdef __x86_64__
    if(IsWindows()&&!rc) {
        unsigned managed=kTtySilence|kTtyEchoRaw|kTtyUncanon|kTtyNoCr2Nl|kTtyNoIsigs|kTtyNoIexten|kTtyNoEchoe|kTtyNoEchok|kTtyNoEchoke|kTtyNoFlow;
        __ttyconf.magic|=device->original_conf.magic&~managed;
        if(device->full)__ttyconf.magic|=kTtyNoFlow;
        else __ttyconf.magic|=device->original_conf.magic&kTtyNoFlow;
    }
#endif
    return rc;
}
static int same_device(Device *d,const struct stat *st,pid_t foreground) {
    return IsWindows()||(d->dev==st->st_dev&&d->ino==st->st_ino&&d->rdev==st->st_rdev)||
           (foreground>0&&d->foreground==foreground);
}
static int release_owner(Owner *owner,int force) {
    Device *device=&devices[owner->device];
    if(!force&&owner->token==0&&owner->depth>1) {owner->depth--;return 0;}
    device->refs--;if(owner->token)device->full--;
    int rc=device->refs?apply(device):restore(device),saved=errno;
    if(rc<0&&!force) {device->refs++;if(owner->token)device->full++;errno=saved;return rc;}
    if(!device->refs) {close(device->fd);memset(device,0,sizeof(*device));}
    memset(owner,0,sizeof(*owner));
    if(!has_devices())remove_guards();
    errno=saved;return rc;
}
static int change(JSContext *ctx,int fd,int enabled,int token) {
    pthread_once(&once,initialize);sigset_t old;lock(&old);
    Owner *owner=NULL,*empty=NULL;
    for(int i=0;i<OWNER_LIMIT;i++) {
        if(owners[i].depth&&owners[i].ctx==ctx&&owners[i].fd==fd&&owners[i].token==token)owner=&owners[i];
        if(!owners[i].depth&&!empty)empty=&owners[i];
    }
    int rc=0;
    if(!enabled) {if(owner)rc=release_owner(owner,0);goto done;}
    if(owner) {
        if(token)goto done;
        if(owner->depth==DEPTH_LIMIT) {rc=RESOURCE_LIMIT;goto done;}
        owner->depth++;goto done;
    }
    if(!empty) {rc=RESOURCE_LIMIT;goto done;}
    if(!isatty(fd)) {errno=ENOTTY;rc=-1;goto done;}
    struct stat st;if(fstat(fd,&st)<0) {rc=-1;goto done;}
    pid_t foreground=IsWindows()?0:tcgetpgrp(fd);
    int selected=-1,free_device=-1;
    for(int i=0;i<DEVICE_LIMIT;i++) {
        if(devices[i].active&&same_device(&devices[i],&st,foreground))selected=i;
        if(!devices[i].active&&free_device<0)free_device=i;
    }
    if(selected<0) {
        if(free_device<0) {rc=RESOURCE_LIMIT;goto done;}
        selected=free_device;Device *d=&devices[selected];memset(d,0,sizeof(*d));
        d->fd=fcntl(fd,F_DUPFD_CLOEXEC,3);
        if(d->fd<0) {rc=-1;goto done;}
        if(tcgetattr(d->fd,&d->original)<0) {int saved=errno;close(d->fd);errno=saved;rc=-1;goto done;}
        d->dev=st.st_dev;d->ino=st.st_ino;d->rdev=st.st_rdev;d->foreground=foreground;
#ifdef __x86_64__
        if(IsWindows()) {
            d->input=GetConsoleInputHandle();d->output=GetConsoleOutputHandle();
            d->has_input=GetConsoleMode(d->input,&d->input_mode);
            d->has_output=GetConsoleMode(d->output,&d->output_mode);
            d->original_conf=__ttyconf;
            if(!d->has_input||!d->has_output) {close(d->fd);errno=ENOTTY;rc=-1;goto done;}
        }
#endif
        d->active=1;install_guards();
    }
    Device *device=&devices[selected];device->refs++;if(token)device->full++;
    if(apply(device)<0) {
        int saved=errno;device->refs--;if(token)device->full--;
        if(!device->refs) {restore(device);close(device->fd);memset(device,0,sizeof(*device));}
        if(!has_devices())remove_guards();
        errno=saved;rc=-1;goto done;
    }
    *empty=(Owner){ctx,JS_GetRuntime(ctx),fd,token,1,selected};
done: {int saved=errno;unlock(&old);errno=saved;return rc;}
}
static void close_owners(JSContext *ctx,JSRuntime *rt) {
    if(owner_pid!=getpid())return;
    sigset_t old;lock(&old);
    for(int i=0;i<OWNER_LIMIT;i++)if(owners[i].depth&&((ctx&&owners[i].ctx==ctx)||(!ctx&&owners[i].rt==rt)))release_owner(&owners[i],1);
    unlock(&old);
}
void js_cosmo_tty_close_context(JSContext *ctx) {close_owners(ctx,NULL);}
void js_cosmo_tty_shutdown(JSRuntime *rt) {close_owners(NULL,rt);}
static JSValue failure(JSContext *ctx,const char *code,const char *message) {
    JSValue e=JS_NewError(ctx);if(JS_IsException(e))return e;
    if(JS_SetPropertyStr(ctx,e,"code",JS_NewString(ctx,code))<0||JS_SetPropertyStr(ctx,e,"message",JS_NewString(ctx,message))<0) {JS_FreeValue(ctx,e);return JS_EXCEPTION;}
    return JS_Throw(ctx,e);
}
static int descriptor(JSContext *ctx,JSValueConst value,int *fd) {
    double number;
    if(!JS_IsNumber(value)||JS_ToFloat64(ctx,&number,value)<0||!(number>=0&&number<=INT_MAX)||(double)(int)number!=number) {JS_ThrowTypeError(ctx,"Expected a nonnegative terminal descriptor");return -1;}
    *fd=number;return 0;
}
static JSValue raw(JSContext *ctx,int fd,int enabled,int token) {
    CosmoRuntimeState *state=js_cosmo_state(ctx);if(!state)return JS_EXCEPTION;
    if(state->worker)return failure(ctx,"ERR_WORKER_UNSUPPORTED_OPERATION","Worker cannot change shared terminal modes");
    if(enabled&&js_cosmo_scheduler_stopped(ctx))return failure(ctx,"ERR_RUNTIME_CLOSED","Runtime is closed");
    int rc=change(ctx,fd,enabled,token);
    if(rc==RESOURCE_LIMIT)return failure(ctx,"ERR_TTY_RESOURCE_LIMIT","Terminal owner, device or nesting budget exceeded");
    if(rc<0) {
        int saved=errno;JSValue info=js_cosmo_process_error_info(ctx,saved),e=JS_NewError(ctx);
        if(JS_IsException(info)||JS_IsException(e)) {JS_FreeValue(ctx,info);JS_FreeValue(ctx,e);return JS_EXCEPTION;}
        for(const char **p=(const char*[]){"code","errno",NULL};*p;p++)if(JS_SetPropertyStr(ctx,e,*p,JS_GetPropertyStr(ctx,info,*p))<0) {JS_FreeValue(ctx,info);JS_FreeValue(ctx,e);return JS_EXCEPTION;}
        JS_FreeValue(ctx,info);
        if(JS_SetPropertyStr(ctx,e,"message",JS_NewString(ctx,strerror(saved)))<0||JS_SetPropertyStr(ctx,e,"syscall",JS_NewString(ctx,"tcsetattr"))<0) {JS_FreeValue(ctx,e);return JS_EXCEPTION;}
        return JS_Throw(ctx,e);
    }
    return JS_UNDEFINED;
}
JSValue js_cosmo_tty_legacy(JSContext *ctx,int argc,JSValueConst *argv) {
    int fd;if(argc<1)return JS_ThrowTypeError(ctx,"Missing terminal descriptor");
    if(descriptor(ctx,argv[0],&fd)<0)return JS_EXCEPTION;
    int enabled=argc<2||JS_IsUndefined(argv[1])?1:JS_ToBool(ctx,argv[1]);if(enabled<0)return JS_EXCEPTION;
    return raw(ctx,fd,enabled,0);
}
static JSValue call(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv,int magic) {
    (void)self;int fd;if(!argc)return JS_ThrowTypeError(ctx,"Missing terminal descriptor");
    if(descriptor(ctx,argv[0],&fd)<0)return JS_EXCEPTION;
    if(magic==3)return JS_NewBool(ctx,isatty(fd));
    if(magic==0) {
        struct winsize size;
        if(ioctl(fd,TIOCGWINSZ,&size)<0||!size.ws_col||!size.ws_row)return JS_NULL;
        JSValue result=JS_NewArray(ctx);if(JS_IsException(result))return result;
        if(JS_SetPropertyUint32(ctx,result,0,JS_NewInt32(ctx,size.ws_col))<0||JS_SetPropertyUint32(ctx,result,1,JS_NewInt32(ctx,size.ws_row))<0) {JS_FreeValue(ctx,result);return JS_EXCEPTION;}
        return result;
    }
    int token;if(argc<3||JS_ToInt32(ctx,&token,argv[2])<0||token<=0)return JS_ThrowTypeError(ctx,"Expected terminal owner token");
    if(magic==1) {int enabled=JS_ToBool(ctx,argv[1]);return enabled<0?JS_EXCEPTION:raw(ctx,fd,enabled,token);}
    pthread_once(&once,initialize);sigset_t old;lock(&old);int enabled=0;
    for(int i=0;i<OWNER_LIMIT;i++)if(owners[i].depth&&owners[i].ctx==ctx&&owners[i].fd==fd&&owners[i].token==token)enabled=1;
    unlock(&old);return JS_NewBool(ctx,enabled);
}
JSValue js_cosmo_tty_api(JSContext *ctx) {
    JSValue api=JS_NewObject(ctx);if(JS_IsException(api))return api;
    const char *names[]={"size","raw","isRaw","isatty"};
    for(int i=0;i<4;i++) {
        JSValue fn=JS_NewCFunctionMagic(ctx,call,names[i],i==1||i==2?3:1,JS_CFUNC_generic_magic,i);
        if(JS_IsException(fn)||JS_SetPropertyStr(ctx,api,names[i],fn)<0) {JS_FreeValue(ctx,api);return JS_EXCEPTION;}
    }
    return api;
}
