#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <signal.h>
#include <spawn.h>
#include <unistd.h>
#include "core.h"
#include "libc/proc/execve.internal.h"

/* WSL may accept an APE's PE header as a Windows program before libc gets
   ENOEXEC. Prefer the pinned native APE fallback on Linux for APE targets. */
#define sys_execve qp_private_sys_execve
#define sys_execve_fallback qp_private_execve_fallback
#define IsApeLoadable IsApeMagic
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wprio-ctor-dtor"
#include "libc/proc/execve-sysv.c"
#pragma GCC diagnostic pop
#undef sys_execve
#undef sys_execve_fallback
#undef IsApeLoadable
static int node_execve(const char *program,char *const arguments[],char *const environment[]) {
    if(IsLinux() && IsApeFile(program)){errno=ENOEXEC;return qp_private_execve_fallback(program,arguments,environment);}
    return execve(program,arguments,environment);
}

/* Keep Nightly's signal/error/vfork handling. RESETIDS supplies the explicit
   Node uid/gid through private, thread-local getters in this translation unit. */
static _Thread_local const QPRequest *request;
static unsigned requested_uid(void) { return request && request->uid>=0?(unsigned)request->uid:getuid(); }
static unsigned requested_gid(void) { return request && request->gid>=0?(unsigned)request->gid:getgid(); }
static int node_setgid(unsigned gid) {
    /* Match libuv's optimistic supplementary-group drop, preserving errno. */
    if(request && (request->uid>=0 || request->gid>=0)){int saved=errno;setgroups(0,NULL);errno=saved;}
    return request && request->gid<0?0:setgid(gid);
}
static int node_setuid(unsigned uid) {return request && request->uid<0?0:setuid(uid);}
#define posix_spawn qp_private_posix_spawn
#define getuid requested_uid
#define getgid requested_gid
#define setgid node_setgid
#define setuid node_setuid
#define execve node_execve
#include "libc/proc/posix_spawn.c"
#undef execve
#undef getuid
#undef getgid
#undef setgid
#undef setuid
#undef posix_spawn

int qp_unix_launch(const QPRequest *options,const char *filename,const int child[3],QPResult *result) {
    posix_spawn_file_actions_t actions;
    posix_spawnattr_t attributes;
    int code=posix_spawn_file_actions_init(&actions); if (code) return code;
    code=posix_spawnattr_init(&attributes); if (code) { posix_spawn_file_actions_destroy(&actions); return code; }
    short flags=POSIX_SPAWN_USEVFORK | POSIX_SPAWN_SETSIGDEF;
    if (options->uid>=0 || options->gid>=0) flags|=POSIX_SPAWN_RESETIDS;
    sigset_t defaults; sigemptyset(&defaults); sigaddset(&defaults,SIGPIPE);
    if ((code=posix_spawnattr_setsigdefault(&attributes,&defaults)) ||
        (code=posix_spawnattr_setflags(&attributes,flags))) goto done;
    if (options->cwd && (code=posix_spawn_file_actions_addchdir_np(&actions,options->cwd))) goto done;
    for (int i=0;i<3;i++) if ((code=posix_spawn_file_actions_adddup2(&actions,child[i],i))) goto done;
    int pid=0;
    const QPRequest *previous=request; request=options;
    code=qp_private_posix_spawn(&pid,filename,&actions,&attributes,options->arguments,options->environment);
    request=previous;
    if (!code) result->pid=pid;
done:
    posix_spawnattr_destroy(&attributes); posix_spawn_file_actions_destroy(&actions); return code;
}
