/* These files are the checksum-verified sources of the selected toolchain. */
#if defined(__x86_64__)
#include "libc/calls/open-nt.c"
#include "libc/calls/readntsym.c"
#include "libc/calls/mkntcmdline.c"
#include "libc/calls/ntspawn.c"
/* Native children use synchronous Windows offsets. Keep the cursor alive until
   libc harvests the logical child, including nonblocking legacy os.exec. */
static pthread_mutex_t qjs_cursor_lock = PTHREAD_MUTEX_INITIALIZER;
static struct QjsNativeCursors *qjs_cursors;
void qjs_host_cursor_submit(struct QjsNativeCursors *record) {
    pthread_mutex_lock(&qjs_cursor_lock);
    record->next = qjs_cursors;
    qjs_cursors = record;
    pthread_mutex_unlock(&qjs_cursor_lock);
}
void qjs_host_cursor_complete(int pid) {
    pthread_mutex_lock(&qjs_cursor_lock);
    struct QjsNativeCursors **link = &qjs_cursors, *record;
    while ((record = *link) && record->pid != pid)
        link = &record->next;
    if (record)
        *link = record->next;
    pthread_mutex_unlock(&qjs_cursor_lock);
    if (!record)
        return;
    for (int i = 0; i < 3; i++) {
        if (!record->cursors[i])
            continue;
        int64_t position;
        if (SetFilePointerEx(record->handles[i], 0, &position, 1)) {
            __cursor_lock(record->cursors[i]);
            record->cursors[i]->shared->pointer = position;
            __cursor_unlock(record->cursors[i]);
        }
        CloseHandle(record->handles[i]);
        __cursor_unref(record->cursors[i]);
    }
    ntspawn_free(record);
}
#include "libc/intrin/fds.c"
#include "libc/proc/proc.c"
#include "libc/proc/wait4-nt.c"
#include "libc/intrin/terminatethisprocess.c"
#include "libc/proc/fork-nt.c"
#ifdef QJS_COSMO_SIGPROC
#include "libc/intrin/sigproc.c"
#endif
#endif

void qjs_cosmo_process_link(void) {}

/* Shared Unix exec fallback for Node and legacy os.exec, including ARM64. */
#include "libc/proc/execve-sysv.c"
