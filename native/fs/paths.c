/* Private names preserve std/os and the public libc policy. Node permits Unix
   byte filenames, newlines and trailing dots/spaces. Reuse the pinned Nightly
   implementations with a Node creation policy. The pinned private openat
   overlay also permits POSIX O_RDONLY|O_TRUNC, matching the Node baseline. */
#include "libc/calls/calls.h"
#include "libc/calls/syscall_support-sysv.internal.h"
#include "libc/dce.h"
#include "libc/temp.h"
#include "sync.h"

static bool node_creation_policy(const char *path) {
    return IsWindows() && __is_evil_path(path);
}

#define __is_evil_path node_creation_policy
#define openat qjs_cosmo_fs_openat
#undef openat64
#define openat64 qjs_cosmo_fs_openat64
#include "libc/calls/openat.c"
#undef openat
#undef openat64
#define mkdirat qjs_cosmo_fs_mkdirat
#include "libc/calls/mkdirat.c"
#undef mkdirat
#define renameat qjs_cosmo_fs_renameat
#include "libc/calls/renameat.c"
#undef renameat
#undef __is_evil_path

static int node_mkdir(const char *path, unsigned mode) {
    return qjs_cosmo_fs_mkdirat(AT_FDCWD,path,mode);
}
#define mkdir node_mkdir
#define mkdtemp qjs_cosmo_fs_mkdtemp
#include "libc/calls/mkdtemp.c"
#undef mkdtemp
#undef mkdir
