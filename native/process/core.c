#include <cosmo.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include "core.h"

typedef struct {
    int fd,error;
    const uint8_t *data; size_t length;
    atomic_int done;
} Input;
static int64_t milliseconds(void) {
    struct timespec value; clock_gettime(CLOCK_MONOTONIC,&value);
    return value.tv_sec*INT64_C(1000)+value.tv_nsec/1000000;
}
static void close_fd(int *fd) { if (*fd>=0) {close(*fd);*fd=-1;} }
static int promote(int fd) {
    if (fd<0 || fd>=3) return fd;
    int copy=fcntl(fd,F_DUPFD_CLOEXEC,3),saved=errno; close(fd);errno=saved;return copy;
}
static int make_pipe(int pair[2]) {
    if (pipe2(pair,O_CLOEXEC)<0) return -1;
    for (int i=0;i<2;i++) {
        pair[i]=promote(pair[i]);
        if (pair[i]<0) {int saved=errno;close_fd(pair);close_fd(pair+1);errno=saved;return -1;}
    }
    return 0;
}
static void *write_input(void *opaque) {
    Input *input=opaque;
    sigset_t mask;sigemptyset(&mask);sigaddset(&mask,SIGPIPE);pthread_sigmask(SIG_BLOCK,&mask,NULL);
    size_t offset=0;
    while (offset<input->length) {
        size_t size=input->length-offset; if (size>65536) size=65536;
        ssize_t count=write(input->fd,input->data+offset,size);
        if (count<0 && errno==EINTR) continue;
        if (count<=0) {input->error=count<0?errno:EIO;break;}
        offset+=count;
    }
    atomic_store_explicit(&input->done,1,memory_order_release);return NULL;
}
static void finish_input(Input *input,pthread_t thread,int *started) {
    if (*started) {
        if (!atomic_load_explicit(&input->done,memory_order_acquire)) pthread_cancel(thread);
        pthread_join(thread,NULL);*started=0;
    }
    close_fd(&input->fd);
}
static int append(QPBuffer *buffer,const uint8_t *data,size_t size,QPAllocator *memory) {
    if (size>(size_t)INT32_MAX-buffer->length) return ENOBUFS;
    size_t length=buffer->length+size;
    if (length>buffer->capacity) {
        size_t capacity=buffer->capacity?buffer->capacity*2:16384;
        if (capacity<length) capacity=length;
        if (capacity>INT32_MAX) capacity=INT32_MAX;
        uint8_t *next=memory->allocate(memory->opaque,capacity);if (!next) return ENOMEM;
        if (buffer->length) memcpy(next,buffer->data,buffer->length);
        if (buffer->data) memory->release(memory->opaque,buffer->data);
        buffer->data=next;buffer->capacity=capacity;
    }
    memcpy(buffer->data+buffer->length,data,size);buffer->length=length;return 0;
}
static int wait_child(QPResult *result) {
    if (result->exited) return 1;
    if (IsWindows()) return qp_windows_wait(result);
    int status;pid_t pid=waitpid(result->pid,&status,WNOHANG);
    if (pid<0) return errno==EINTR?0:-1;
    if (!pid) return 0;
    result->raw_status=status;result->exited=1;
    if (WIFEXITED(status)) result->status=WEXITSTATUS(status);
    else if (WIFSIGNALED(status)) result->signal=WTERMSIG(status);
    return 1;
}
static int kill_child(QPResult *result,int signal) {
    if (result->exited) return 0;
    return IsWindows()?qp_windows_kill(result,signal):kill(result->pid,signal);
}
static int launch(const QPRequest *options,const int child[3],QPResult *result,QPAllocator *memory) {
    int denied=0,last=ENOENT;
    for (const char **candidate=options->candidates;*candidate;candidate++) {
        last=IsWindows()?qp_windows_launch(options,*candidate,child,result):qp_unix_launch(options,*candidate,child,result);
        if (!last) return 0;
        if (!IsWindows() && last==ENOEXEC) {
            size_t length=0;while(options->arguments[length])length++;
            if (length>SIZE_MAX/sizeof(char *)-2) return ENOMEM;
            char **arguments=memory->allocate(memory->opaque,(length+2)*sizeof(char *));if(!arguments)return ENOMEM;
            arguments[0]="/bin/sh";arguments[1]=(char *)*candidate;
            for(size_t i=1;i<=length;i++)arguments[i+1]=options->arguments[i];
            QPRequest shell=*options;shell.arguments=arguments;
            last=qp_unix_launch(&shell,"/bin/sh",child,result);memory->release(memory->opaque,arguments);return last;
        }
        if (last==EACCES) {if(IsWindows())return last;denied=1;}
        else if (last!=ENOENT && last!=ENOTDIR) return last;
    }
    return denied?EACCES:last;
}
QPResult qp_run(const QPRequest *options,QPAllocator *memory) {
    QPResult result={0};result.handle=-1;
    int64_t start=milliseconds();
    for(int i=0;i<3;i++){result.sync_handles[i]=-1;result.sync_fds[i]=-1;}
    int parent[3]={-1,-1,-1},child[3]={-1,-1,-1};
    Input input={.fd=-1};pthread_t writer={0};int started=0,killed=0;
    /* Nightly pthread stacks default to 80 KiB. Keep the I/O workspace in
       the caller's quota instead of consuming almost the entire Worker stack. */
    uint8_t *block=NULL;
    if(options->stdio[1]==QP_PIPE || options->stdio[2]==QP_PIPE) {
        block=memory->allocate(memory->opaque,65536);
        if(!block){result.error=ENOMEM;goto done;}
    }
    for(int i=0;i<3;i++) {
        if(options->stdio[i]==QP_PIPE) {
            int pair[2];if(make_pipe(pair)<0){result.error=errno;goto done;}
            parent[i]=pair[i?0:1];child[i]=pair[i?1:0];result.capture[i]=i!=0;
        } else if(options->stdio[i]==QP_IGNORE) {
            child[i]=promote(open("/dev/null",O_RDWR|O_CLOEXEC));
            if(child[i]<0){result.error=errno;goto done;}
        } else {
            child[i]=fcntl(options->stdio[i],F_DUPFD_CLOEXEC,3);
            if(child[i]<0){result.error=errno;goto done;}
        }
    }
    /* XNU sends pipe-write SIGPIPE to the process, so blocking it on the
       writer thread alone cannot protect an SDK host with SIG_DFL. Darwin's
       descriptor-local F_SETNOSIGPIPE (73) avoids changing host handlers. */
    if(IsXnu() && parent[0]>=0 && fcntl(parent[0],73,1)<0){result.error=errno;goto done;}
    result.error=launch(options,child,&result,memory);if(result.error)goto done;
    for(int i=0;i<3;i++)close_fd(child+i);
    input.fd=parent[0];parent[0]=-1;input.data=options->input;input.length=options->input_length;
    if(input.fd>=0 && input.length) {
        int code=pthread_create(&writer,NULL,write_input,&input);
        if(code){result.error=code;kill_child(&result,SIGKILL);killed=1;finish_input(&input,writer,&started);}
        else started=1;
    } else close_fd(&input.fd);
    uint64_t total=0;
    while(!result.exited || parent[1]>=0 || parent[2]>=0) {
        if(started && atomic_load_explicit(&input.done,memory_order_acquire)) {
            finish_input(&input,writer,&started);
            if(input.error && input.error!=EPIPE && !result.error)result.error=input.error;
        }
        if(wait_child(&result)<0){if(!result.error)result.error=errno;break;}
        int64_t elapsed=milliseconds()-start;
        if(!killed && options->timeout>0 && elapsed>=options->timeout) {
            if(!result.error)result.error=ETIMEDOUT;
        }
        if(result.error && !killed) {
            int signal=result.error==ENOMEM?SIGKILL:options->kill_signal;
            if(kill_child(&result,signal)<0 && errno!=ESRCH)kill_child(&result,SIGKILL);
            killed=1;for(int i=1;i<3;i++)close_fd(parent+i);
            finish_input(&input,writer,&started);
        }
        if(result.exited && parent[1]<0 && parent[2]<0)break;
        struct pollfd pipes[2]={{parent[1],POLLIN,0},{parent[2],POLLIN,0}};
        int delay=10;if(!killed && options->timeout>0 && options->timeout-elapsed<delay)delay=options->timeout-elapsed;
        if(delay<0)delay=0;
        int count=poll(pipes,2,delay);
        if(count<0){if(errno!=EINTR && !result.error)result.error=errno;continue;}
        for(int i=0;i<2;i++)if(parent[i+1]>=0 && pipes[i].revents) {
            ssize_t size=read(parent[i+1],block,65536);
            if(size<0){if(errno!=EINTR && errno!=EAGAIN){if(!result.error)result.error=errno;close_fd(parent+i+1);}}
            else if(!size)close_fd(parent+i+1);
            else {
                int code=append(result.output+i+1,block,size,memory);if(code && !result.error)result.error=code;
                total+=size;
                if(options->max_buffer>0 && total>options->max_buffer && !result.error)result.error=ENOBUFS;
                if(result.error)break;
            }
        }
    }
done:
    if(block)memory->release(memory->opaque,block);
    finish_input(&input,writer,&started);
    for(int i=0;i<3;i++){close_fd(parent+i);close_fd(child+i);}
    if(result.pid && !result.exited) {
        kill_child(&result,SIGKILL);
        while(!result.exited) {if(wait_child(&result)<0)break;struct timespec pause={0,1000000};nanosleep(&pause,NULL);}
    }
    if(IsWindows())qp_windows_close(&result);
    return result;
}
void qp_result_free(QPResult *result,QPAllocator *memory) {
    for(int i=0;i<3;i++)if(result->output[i].data){memory->release(memory->opaque,result->output[i].data);memset(result->output+i,0,sizeof(QPBuffer));}
}
