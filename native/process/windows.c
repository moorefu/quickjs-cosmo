#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>
#include "core.h"
#ifdef __x86_64__
#include "libc/calls/internal.h"
#include "libc/calls/state.internal.h"
#include "libc/calls/syscall_support-nt.internal.h"
#include "libc/nt/accounting.h"
#include "libc/nt/enum/accessmask.h"
#include "libc/nt/enum/fileflagandattributes.h"
#include "libc/nt/enum/filetype.h"
#include "libc/nt/enum/processcreationflags.h"
#include "libc/nt/enum/startf.h"
#include "libc/nt/enum/sw.h"
#include "libc/nt/enum/wait.h"
#include "libc/nt/files.h"
#include "libc/nt/process.h"
#include "libc/nt/runtime.h"
#include "libc/nt/struct/securityattributes.h"
#include "libc/nt/synchronization.h"
#include "libc/proc/ntspawn.h"
#include "libc/proc/describefds.internal.h"
#include "libc/sysv/pib.h"

typedef struct { int verbatim;int64_t prepared[3]; } Launch;
static _Thread_local Launch *launch;
static void append16(char16_t *output,size_t capacity,size_t *length,uint32_t code) {
    if(code>=0x10000) {
        code-=0x10000;
        if(*length<capacity)output[*length]=(code>>10)+0xd800;
        (*length)++;code=(code&1023)+0xdc00;
    }
    if(*length<capacity)output[*length]=code;
    (*length)++;
}
/* MSVCRT/libuv quoting; preserve argument text, including /C/... strings.
   windowsVerbatimArguments joins literal UTF-16 arguments without quoting. */
static size_t node_command_line(char16_t *output,char *const arguments[],size_t capacity) {
    size_t used=0;
    for(size_t i=0;arguments[i];i++) {
        if(i)append16(output,capacity,&used,' ');
        int quote=!launch->verbatim && (!*arguments[i] || strpbrk(arguments[i]," \t\"")!=NULL);
        if(quote)append16(output,capacity,&used,'"');
        const unsigned char *p=(void *)arguments[i];size_t slashes=0;
        while(*p) {
            uint32_t code=*p++;
            if(code>=0xc0) {
                int n=code<0xe0?1:code<0xf0?2:3;
                code&=n==1?31:n==2?15:7;
                while(n-- && *p)code=(code<<6)|(*p++&63);
            }
            if(!launch->verbatim && code=='\\') {slashes++;continue;}
            size_t count=slashes;
            if(!launch->verbatim && code=='"')count=slashes*2+1;
            while(count--)append16(output,capacity,&used,'\\');
            slashes=0;append16(output,capacity,&used,code);
        }
        size_t count=slashes*(quote?2:1);while(count--)append16(output,capacity,&used,'\\');
        if(quote)append16(output,capacity,&used,'"');
    }
    if(capacity)output[used<capacity?used:capacity-1]=0;
    return used;
}
/* Disk handles have already been reopened synchronously, grouped by shared
   cursor, and retained for parent-offset synchronization. Avoid reopening
   those handles again in the common compatibility source. */
static uint32_t prepared_file_type(int64_t handle) {
    if(launch)for(int i=0;i<3;i++)if(launch->prepared[i]==handle)return kNtFileTypePipe;
    return GetFileType(handle);
}
#define ntspawn qp_private_ntspawn
#define mkntcmdline node_command_line
#define GetFileType prepared_file_type
#include "libc/calls/ntspawn.c"
#undef GetFileType
#undef mkntcmdline
#undef ntspawn

static void cleanup_redirects(QPResult *result,int synchronize) {
    for(int i=0;i<3;i++) {
        if(result->sync_handles[i]!=-1) {
            int64_t position;
            if(synchronize && result->sync_fds[i]>=0 && SetFilePointerEx(result->sync_handles[i],0,&position,1))
                lseek(result->sync_fds[i],position,SEEK_SET);
            CloseHandle(result->sync_handles[i]);result->sync_handles[i]=-1;
        }
        if(result->sync_fds[i]>=0){close(result->sync_fds[i]);result->sync_fds[i]=-1;}
    }
}
int qp_windows_launch(const QPRequest *options,const char *filename,const int child[3],QPResult *result) {
    if(options->uid>=0 || options->gid>=0)return ENOTSUP;
    const char *extension=strrchr(filename,'.');
    if(extension && (!strcasecmp(extension,".cmd") || !strcasecmp(extension,".bat")))return EINVAL;
    char16_t program[PATH_MAX];
    if(__mkntpath(filename,program)<0)return errno;
    uint32_t attributes=GetFileAttributes(program);
    if(attributes!=UINT32_MAX && (attributes&kNtFileAttributeDirectory))return ENOENT;
    Launch scope={.verbatim=options->windows_verbatim,.prepared={-1,-1,-1}};
    int ape=qjs_interpreter_is_ape(program);
    struct NtStartupInfo startup={.cb=sizeof(startup),.dwFlags=kNtStartfUsestdhandles|kNtStartfUseshowwindow,
        .wShowWindow=options->windows_hide?kNtSwHide:kNtSwShownormal};
    int64_t handles[3]={-1,-1,-1};void *cursors[3]={0};int error=0;
    struct Fd selected[3]={0};int retained[3]={0};
    char *fdspec=NULL;int64_t *inherited=NULL;uint32_t inherited_count=0;
    for(int i=0;i<3;i++) {
        __fds_lock();
        if(!__isfdopen(child[i])){__fds_unlock();error=EBADF;goto done;}
        struct Fd fd=__get_pib()->fds.p[child[i]];
        if(ape&&fd.cursor){
            if(!__cursor_ref(fd.cursor)){__fds_unlock();error=EBADF;goto done;}
            selected[i]=fd;retained[i]=1;
        }
        __fds_unlock();
        if(fd.kind==kFdDevNull) {
            struct NtSecurityAttributes attributes={sizeof(attributes),NULL,1};
            handles[i]=CreateFile(u"NUL",kNtGenericRead|kNtGenericWrite,7,&attributes,3,0,0);
            if(handles[i]==-1){__winerr();error=errno;goto done;}
        } else if(fd.kind!=kFdFile && fd.kind!=kFdConsole){error=ENOTSUP;goto done;}
        else if(!ape&&GetFileType(fd.handle)==kNtFileTypeDisk) {
            int shared=-1;
            for(int j=0;j<i;j++)if(cursors[j] && cursors[j]==fd.cursor){shared=j;break;}
            if(shared>=0) {
                if(!DuplicateHandle(GetCurrentProcess(),handles[shared],GetCurrentProcess(),handles+i,0,1,2)) {
                    __winerr();error=errno;goto done;
                }
            } else {
                uint32_t access=0;
                if((fd.flags&O_ACCMODE)!=O_WRONLY)access|=kNtGenericRead;
                if((fd.flags&O_ACCMODE)!=O_RDONLY)access|=(fd.flags&O_APPEND)?kNtFileAppendData|kNtFileReadAttributes|kNtSynchronize:kNtGenericWrite;
                handles[i]=ReOpenFile(fd.handle,access,7,0);
                if(handles[i]==-1){__winerr();error=errno;goto done;}
                int64_t position=lseek(child[i],0,SEEK_CUR);
                if(position>=0 && !SetFilePointerEx(handles[i],position,NULL,0)){__winerr();error=errno;goto done;}
                if(!SetHandleInformation(handles[i],1,1)){__winerr();error=errno;goto done;}
            }
            cursors[i]=fd.cursor;scope.prepared[i]=handles[i];
            result->sync_fds[i]=fcntl(child[i],F_DUPFD_CLOEXEC,3);
            if(result->sync_fds[i]<0){error=errno;goto done;}
        } else if(!DuplicateHandle(GetCurrentProcess(),fd.handle,GetCurrentProcess(),handles+i,0,1,2)) {
            __winerr();error=errno;goto done;
        }
        startup.stdiofds[i]=handles[i];
        if(ape){selected[i]=fd;selected[i].handle=handles[i];selected[i].flags&=~O_CLOEXEC;}
    }
    if(ape){
        /* Each selected handle is distinct, while duplicated descriptors retain
           the same cursor mapping. Only these three stdio fds cross the boundary. */
        __fds_lock();
        fdspec=__describe_fds(selected,3,NULL,&startup,GetCurrentProcess(),&inherited,&inherited_count);
        __fds_unlock();
        if(!fdspec){error=errno;goto done;}
    }
    char16_t cwd[PATH_MAX];
    if(options->cwd && __mkntpath(options->cwd,cwd)<0){error=errno;goto done;}
    if(options->cwd) {
        uint32_t attributes=GetFileAttributes(cwd);
        if(attributes==UINT32_MAX){__winerr();error=errno==EISDIR||errno==ENOTDIR?ENOENT:errno;goto done;}
        if(!(attributes&kNtFileAttributeDirectory)){error=ENOENT;goto done;}
    }
    struct NtProcessInformation process={0};
    char *extras[]={fdspec,NULL};
    struct NtSpawnArgs arguments={.dirhand=-100,.prog=filename,.argv=options->arguments,.envp=options->environment,
        .extravars=ape?extras:NULL,
        .dwCreationFlags=options->windows_hide?kNtCreateNoWindow:0,.opt_lpCurrentDirectory=options->cwd?cwd:NULL,
        .opt_lpExplicitHandleList=ape?inherited:handles,.dwExplicitHandleCount=ape?inherited_count:3,.lpStartupInfo=&startup,.opt_out_lpProcessInformation=&process};
    Launch *previous=launch;launch=&scope;
    int code=qp_private_ntspawn(&arguments);launch=previous;
    if(code<0){error=errno;goto done;}
    CloseHandle(process.hThread);result->handle=process.hProcess;result->pid=process.dwProcessId;
    for(int i=0;i<3;i++)if(scope.prepared[i]!=-1) {
        result->sync_handles[i]=handles[i];handles[i]=-1;
        SetHandleInformation(result->sync_handles[i],1,0);
    }
done:
    if(fdspec)__undescribe_fds(fdspec,GetCurrentProcess(),inherited,inherited_count);
    for(int i=0;i<3;i++)if(handles[i]!=-1)CloseHandle(handles[i]);
    for(int i=0;i<3;i++)if(retained[i])__cursor_unref(selected[i].cursor);
    if(error)cleanup_redirects(result,0);
    return error;
}
int qp_windows_wait(QPResult *result) {
    uint32_t wait=WaitForSingleObject(result->handle,0);
    if(wait==kNtWaitTimeout)return 0;
    uint32_t status;
    if(wait!=0 || !GetExitCodeProcess(result->handle,&status)){__winerr();return -1;}
    result->raw_status=result->status=status;result->exited=1;return 1;
}
int qp_windows_kill(QPResult *result,int signal) {
    if(signal!=2 && signal!=3 && signal!=9 && signal!=15){errno=ENOSYS;return -1;}
    if(!TerminateProcess(result->handle,1)){__winerr();return -1;}
    result->signal=signal;return 0;
}
void qp_windows_close(QPResult *result) {
    cleanup_redirects(result,result->exited);
    if(result->handle!=-1){CloseHandle(result->handle);result->handle=-1;}
}
#else
int qp_windows_launch(const QPRequest *a,const char *b,const int c[3],QPResult *d){return ENOSYS;}
int qp_windows_wait(QPResult *result){errno=ENOSYS;return -1;}
int qp_windows_kill(QPResult *result,int signal){errno=ENOSYS;return -1;}
void qp_windows_close(QPResult *result){}
#endif
