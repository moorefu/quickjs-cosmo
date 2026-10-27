#ifndef QUICKJS_COSMO_PROCESS_CORE_H
#define QUICKJS_COSMO_PROCESS_CORE_H
#include <stddef.h>
#include <stdint.h>
enum { QP_PIPE=-1, QP_IGNORE=-2 };
typedef struct { void *opaque; void *(*allocate)(void *,size_t); void (*release)(void *,void *); } QPAllocator;
typedef struct { uint8_t *data; size_t length,capacity; } QPBuffer;
typedef struct {
    const char **candidates;
    char **arguments,**environment;
    const char *cwd;
    const uint8_t *input; size_t input_length;
    int stdio[3],kill_signal,windows_hide,windows_verbatim;
    int64_t timeout,uid,gid;
    double max_buffer;
} QPRequest;
typedef struct {
    uint32_t pid,status,raw_status;
    int error,signal,exited,capture[3];
    int64_t handle;
    int64_t sync_handles[3];
    int sync_fds[3];
    QPBuffer output[3];
} QPResult;
QPResult qp_run(const QPRequest *,QPAllocator *);
void qp_result_free(QPResult *,QPAllocator *);
int qp_unix_launch(const QPRequest *,const char *,const int [3],QPResult *);
int qp_windows_launch(const QPRequest *,const char *,const int [3],QPResult *);
int qp_windows_wait(QPResult *);
int qp_windows_kill(QPResult *,int);
void qp_windows_close(QPResult *);
/* Shared launch/wait primitives; asynchronous supervision owns its own pipes. */
int qp_make_pipe(int [2]);
int qp_launch(const QPRequest *,const int [3],QPResult *,QPAllocator *);
int qp_wait_child(QPResult *);
int qp_kill_child(QPResult *,int);
int qp_force_reap(QPResult *);
#endif
