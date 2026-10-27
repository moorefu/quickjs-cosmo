#include <cosmo.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include "sync.h"
#include "../common/windows_host.h"

static int property(JSContext *ctx, JSValueConst object, const char *name, JSValue value) {
    return JS_IsException(value) ? -1 : JS_SetPropertyStr(ctx,object,name,value);
}
static int index_property(JSContext *ctx, JSValueConst object, uint32_t index, JSValue value) {
    return JS_IsException(value) ? -1 : JS_SetPropertyUint32(ctx,object,index,value);
}

enum { FS_OPEN, FS_CLOSE, FS_READ, FS_WRITE, FS_STAT, FS_MKDIR, FS_SCAN,
       FS_RENAME, FS_UNLINK, FS_RMDIR, FS_REALPATH, FS_MKDTEMP, FS_TRUNCATE,
       FS_SYNC, FS_ACCESS, FS_ERROR, FS_PAUSE, FS_CHMOD };

typedef struct { int value; const char *name; int windows; } FsError;
static JSValue failure(JSContext *ctx, int number, const char *call) {
    const FsError errors[] = {
        {ENOENT,"ENOENT",-4058}, {ENOTDIR,"ENOTDIR",-4052}, {EACCES,"EACCES",-4092},
        {EPERM,"EPERM",-4048}, {EINVAL,"EINVAL",-4071}, {ENOMEM,"ENOMEM",-4057},
        {ENAMETOOLONG,"ENAMETOOLONG",-4064}, {ELOOP,"ELOOP",-4067}, {ENOSYS,"ENOSYS",-4054},
        {EBADF,"EBADF",-4083}, {EEXIST,"EEXIST",-4075}, {EISDIR,"EISDIR",-4068},
        {ENOTEMPTY,"ENOTEMPTY",-4051}, {EMFILE,"EMFILE",-4066}, {ENFILE,"ENFILE",-4061},
        {ENOSPC,"ENOSPC",-4055}, {EFBIG,"EFBIG",-4036}, {EROFS,"EROFS",-4043},
        {EXDEV,"EXDEV",-4037}, {EBUSY,"EBUSY",-4082}, {ENOTSUP,"ENOTSUP",-4049},
        {EINTR,"EINTR",-4072}, {ETXTBSY,"ETXTBSY",-4038}, {EIO,"EIO",-4070},
        {EILSEQ,"EILSEQ",-4027}, {EAGAIN,"EAGAIN",-4088}, {EPIPE,"EPIPE",-4047}, {ESPIPE,"ESPIPE",-4041}
    };
    const char *name = "EIO"; int code = IsWindows() ? -4070 : -number;
    for (size_t i = 0; i < sizeof(errors)/sizeof(*errors); i++) if (errors[i].value == number) {
        name = errors[i].name; if (IsWindows()) code = errors[i].windows; break;
    }
    if (IsXnu()) code=-(number==ENAMETOOLONG?63:number==ELOOP?62:number==ENOSYS?78:
        number==ENOTEMPTY?66:number==ENOTSUP?45:number==EILSEQ?92:number==EAGAIN?35:number);
    JSValue error = JS_NewError(ctx);
    if (JS_IsException(error)) return error;
    if (property(ctx,error,"code",JS_NewString(ctx,name)) < 0 ||
        property(ctx,error,"errno",JS_NewInt32(ctx,code)) < 0 ||
        property(ctx,error,"syscall",JS_NewString(ctx,call)) < 0 ||
        property(ctx,error,"message",JS_NewString(ctx,strerror(number))) < 0) {
        JS_FreeValue(ctx,error); return JS_EXCEPTION;
    }
    return JS_Throw(ctx,error);
}

/* JS passes byte paths, so Unix filenames need not be valid UTF-8. */
static char *path_bytes(JSContext *ctx, JSValueConst value) {
    size_t offset, length, element, size=0;
    JSValue array = JS_GetTypedArrayBuffer(ctx,value,&offset,&length,&element);
    if (JS_IsException(array)) return NULL;
    uint8_t *data = JS_GetArrayBuffer(ctx,&size,array);
    if (JS_HasException(ctx)) { JS_FreeValue(ctx,array); return NULL; }
    if ((!data && size) || offset > size || length > size-offset || length == SIZE_MAX) {
        JS_FreeValue(ctx,array); JS_ThrowTypeError(ctx,"Invalid path buffer"); return NULL;
    }
    if (length && memchr(data+offset,0,length)) {
        JS_FreeValue(ctx,array); JS_ThrowTypeError(ctx,"Path contains NUL"); return NULL;
    }
    char *path = js_malloc(ctx,length+1);
    if (path) { if (length) memcpy(path,data+offset,length); path[length]=0; }
    JS_FreeValue(ctx,array); return path;
}

static JSValue stat_value(JSContext *ctx, const struct stat *s) {
    JSValue value = JS_NewObject(ctx);
    if (JS_IsException(value)) return value;
#define FIELD(name,expr) if (property(ctx,value,name,JS_NewBigInt64(ctx,(int64_t)(expr)))<0) goto fail
    FIELD("size",s->st_size); FIELD("blksize",s->st_blksize); FIELD("blocks",s->st_blocks);
#undef FIELD
#define FIELD(name,expr) if (property(ctx,value,name,JS_NewBigUint64(ctx,(uint64_t)(expr)))<0) goto fail
    uint32_t public_mode=s->st_mode;
    if (IsWindows()) public_mode=(public_mode&S_IFMT)|(S_ISDIR(public_mode)?0777:0444|((public_mode&S_IWUSR)?0222:0));
    FIELD("dev",s->st_dev); FIELD("ino",s->st_ino); FIELD("mode",public_mode); FIELD("nlink",s->st_nlink);
    FIELD("uid",IsWindows()?0:s->st_uid); FIELD("gid",IsWindows()?0:s->st_gid); FIELD("rdev",s->st_rdev);
#undef FIELD
    const struct timespec times[] = {s->st_atim,s->st_mtim,s->st_ctim,s->st_birthtim};
    const char *names[] = {"atime","mtime","ctime","birthtime"};
    for (int i=0;i<4;i++) {
        JSValue pair=JS_NewArray(ctx);
        if (JS_IsException(pair)) goto fail;
        if (index_property(ctx,pair,0,JS_NewBigInt64(ctx,times[i].tv_sec))<0 ||
            index_property(ctx,pair,1,JS_NewInt32(ctx,times[i].tv_nsec))<0) { JS_FreeValue(ctx,pair); goto fail; }
        if (property(ctx,value,names[i],pair)<0) goto fail;
    }
    return value;
fail: JS_FreeValue(ctx,value); return JS_EXCEPTION;
}

static JSValue scan(JSContext *ctx, const char *path) {
    DIR *directory=opendir(path);
    if (!directory) return failure(ctx,errno,"scandir");
    JSValue list=JS_NewArray(ctx); uint32_t count=0; int saved=0;
    if (JS_IsException(list)) { closedir(directory); return list; }
    for (;;) {
        errno=0; struct dirent *entry=readdir(directory);
        if (!entry) { saved=errno; break; }
        if (!strcmp(entry->d_name,".") || !strcmp(entry->d_name,"..")) continue;
        JSValue pair=JS_NewArray(ctx), bytes;
        if (JS_IsException(pair)) goto fail;
        bytes=JS_NewArrayBufferCopy(ctx,(const uint8_t *)entry->d_name,strlen(entry->d_name));
        if (JS_IsException(bytes)) { JS_FreeValue(ctx,pair); goto fail; }
        if (index_property(ctx,pair,0,bytes)<0 ||
            index_property(ctx,pair,1,JS_NewInt32(ctx,entry->d_type))<0) { JS_FreeValue(ctx,pair); goto fail; }
        if (count==UINT32_MAX) { JS_FreeValue(ctx,pair); JS_ThrowOutOfMemory(ctx); goto fail; }
        if (index_property(ctx,list,count++,pair)<0) goto fail;
    }
    if (closedir(directory) && !saved) saved=errno;
    if (saved) { JS_FreeValue(ctx,list); return failure(ctx,saved,"scandir"); }
    return list;
fail: closedir(directory); JS_FreeValue(ctx,list); return JS_EXCEPTION;
}

/* Public numeric flags use Node's host ABI, independently of Cosmo's ABI. */
static int host_flags(int flags) {
    if (IsXnu()) {
        int out=flags&3;
        if (flags&0x200) out|=O_CREAT;
        if (flags&0x800) out|=O_EXCL;
        if (flags&0x400) out|=O_TRUNC;
        if (flags&8) out|=O_APPEND;
        if (flags&0x100000) out|=O_DIRECTORY;
        if (flags&0x100) out|=O_NOFOLLOW;
        if (flags&0x20000) out|=O_NOCTTY;
        if (flags&4) out|=O_NONBLOCK;
        if (flags&0x400000) out|=O_DSYNC;
        if (flags&0x80) out|=O_SYNC;
        return out;
    }
    if (!IsWindows()) return flags;
    int out=flags&3;
    if (flags&256) out|=O_CREAT;
    if (flags&1024) out|=O_EXCL;
    if (flags&512) out|=O_TRUNC;
    if (flags&8) out|=O_APPEND;
    return out;
}

static JSValue call(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv, int magic) {
    char *a=NULL,*b=NULL; JSValue value=JS_UNDEFINED; int fd=0,n=0,result=0,saved=0;
    const char *name="fs"; (void)self;
    const int required[]={3,1,5,5,2,2,1,2,1,1,1,1,2,1,2,2,1,2};
    if (magic<0 || magic>=sizeof(required)/sizeof(*required) || argc<required[magic])
        return JS_ThrowTypeError(ctx,"Invalid native fs argument count");
    if (magic==FS_READ || magic==FS_WRITE) {
        int64_t offset,length,position; size_t size;
        if (argc<5 || JS_ToInt32(ctx,&fd,argv[0])<0 || JS_ToInt64(ctx,&offset,argv[2])<0 ||
            JS_ToInt64(ctx,&length,argv[3])<0) return JS_EXCEPTION;
        if ((JS_IsBigInt(ctx,argv[4]) ? JS_ToBigInt64(ctx,&position,argv[4]) : JS_ToInt64(ctx,&position,argv[4]))<0) return JS_EXCEPTION;
        if (offset<0 || length<0) return JS_ThrowRangeError(ctx,"Invalid native I/O bounds");
        if (!length) return JS_NewInt32(ctx,0);
        uint8_t *bytes=JS_GetArrayBuffer(ctx,&size,argv[1]);
        if (JS_HasException(ctx)) return JS_EXCEPTION;
        if (offset<0 || length<0 || (uint64_t)offset>size || (uint64_t)length>size-(uint64_t)offset)
            return JS_ThrowRangeError(ctx,"Invalid native I/O bounds");
        ssize_t count;
        do {
            if (magic==FS_READ) count=position<0 ? read(fd,bytes+offset,length) : pread(fd,bytes+offset,length,position);
            else count=position<0 ? write(fd,bytes+offset,length) : pwrite(fd,bytes+offset,length,position);
        } while (count<0 && errno==EINTR);
        return count<0 ? failure(ctx,errno,magic==FS_READ?"read":"write") : JS_NewInt64(ctx,count);
    }
    if (magic==FS_PAUSE) {
        int64_t delay; if (JS_ToInt64(ctx,&delay,argv[0])<0) return JS_EXCEPTION;
        if (delay<0) return JS_ThrowRangeError(ctx,"Negative retry delay");
        struct timespec time={delay/1000,(delay%1000)*1000000};
        while (nanosleep(&time,&time)<0 && errno==EINTR) {}
        return JS_UNDEFINED;
    }
    if (magic==FS_ERROR) {
        const char *code=JS_ToCString(ctx,argv[0]),*sys=JS_ToCString(ctx,argv[1]);
        if (!code || !sys) { JS_FreeCString(ctx,code); JS_FreeCString(ctx,sys); return JS_EXCEPTION; }
        n=!strcmp(code,"EISDIR")?EISDIR:!strcmp(code,"ENOTDIR")?ENOTDIR:!strcmp(code,"EEXIST")?EEXIST:!strcmp(code,"ENOTSUP")?ENOTSUP:!strcmp(code,"EPERM")?EPERM:EIO;
        value=failure(ctx,n,sys); JS_FreeCString(ctx,code); JS_FreeCString(ctx,sys); return value;
    }
    if (magic==FS_STAT && JS_ToInt32(ctx,&n,argv[1])<0) return JS_EXCEPTION;
    if (magic==FS_CLOSE || magic==FS_TRUNCATE || magic==FS_SYNC || magic==FS_CHMOD || (magic==FS_STAT && n==2)) {
        if (JS_ToInt32(ctx,&fd,argv[0])<0) return JS_EXCEPTION;
    } else {
        a=path_bytes(ctx,argv[0]); if (!a) return JS_EXCEPTION;
    }
    switch (magic) {
    case FS_OPEN:
        name="open";
        if (JS_ToInt32(ctx,&n,argv[1])<0 || JS_ToInt32(ctx,&fd,argv[2])<0) goto exception;
        if (IsWindows() && (n & ~(3|256|1024|512|8))) { errno=EINVAL; result=-1; break; }
        if (IsXnu() && (n & ~(3|0x200|0x800|0x400|8|0x100000|0x100|0x20000|4|0x400000|0x80))) { errno=EINVAL; result=-1; break; }
        do { result=qjs_cosmo_fs_openat(AT_FDCWD,a,host_flags(n)|O_CLOEXEC,fd); } while (result<0 && errno==EINTR);
        if (result>=0) value=JS_NewInt32(ctx,result);
        break;
    case FS_CLOSE: name="close"; result=close(fd); break; /* Do not retry close after EINTR. */
    case FS_STAT: {
        struct stat s; name=n==2?"fstat":n==1?"lstat":"stat";
        do { result=n==2?fstat(fd,&s):n==1?lstat(a,&s):stat(a,&s); } while (result<0 && errno==EINTR);
        if (!result) value=stat_value(ctx,&s);
        break;
    }
    case FS_MKDIR: name="mkdir"; if (JS_ToInt32(ctx,&n,argv[1])<0) goto exception; result=qjs_cosmo_fs_mkdirat(AT_FDCWD,a,n); break;
    case FS_SCAN: value=scan(ctx,a); break;
    case FS_RENAME: name="rename"; b=path_bytes(ctx,argv[1]); if (!b) goto exception; result=qjs_cosmo_fs_renameat(AT_FDCWD,a,AT_FDCWD,b); break;
    case FS_UNLINK: name="unlink"; result=unlink(a); break;
    case FS_RMDIR: name="rmdir"; result=rmdir(a); break;
    case FS_REALPATH: {
        name="realpath"; char *resolved=realpath(a,NULL);
        if (!resolved) { result=-1; break; }
        if (IsWindows()) {
            size_t len=strlen(resolved); char *p=js_malloc(ctx,len+3);
            if (!p) { free(resolved); goto exception; }
            memcpy(p,resolved,len+1);
            if (p[0]=='/' && p[1] && p[2]=='/' && ((p[1]>='A'&&p[1]<='Z')||(p[1]>='a'&&p[1]<='z'))) { p[0]=p[1]; p[1]=':'; }
            else if (p[0]=='/' && p[1]!='/') { memmove(p+2,p,len+1); p[0]=js_cosmo_windows_root_drive(); p[1]=':'; }
            for (char *q=p;*q;q++) if (*q=='/') *q='\\';
            value=JS_NewArrayBufferCopy(ctx,(uint8_t *)p,strlen(p)); js_free(ctx,p);
        } else value=JS_NewArrayBufferCopy(ctx,(uint8_t *)resolved,strlen(resolved));
        free(resolved); break;
    }
    case FS_MKDTEMP: {
        name="mkdtemp"; size_t length=strlen(a);
        b=js_malloc(ctx,length+7); if (!b) goto exception;
        memcpy(b,a,length); memcpy(b+length,"XXXXXX",7);
        if (!qjs_cosmo_fs_mkdtemp(b)) result=-1;
        else value=JS_NewArrayBufferCopy(ctx,(uint8_t *)b,strlen(b));
        break;
    }
    case FS_TRUNCATE: {
        int64_t length; name="ftruncate"; if (JS_ToInt64(ctx,&length,argv[1])<0) goto exception;
        do { result=ftruncate(fd,length); } while (result<0 && errno==EINTR); break;
    }
    case FS_SYNC: name="fsync"; do { result=fsync(fd); } while (result<0 && errno==EINTR); break;
    case FS_CHMOD: name="fchmod"; if (JS_ToInt32(ctx,&n,argv[1])<0) goto exception; result=fchmod(fd,n); break;
    case FS_ACCESS: name="access"; if (JS_ToInt32(ctx,&n,argv[1])<0) goto exception; if (IsWindows()) n&=~X_OK; result=access(a,n); break;
    default: JS_ThrowInternalError(ctx,"Unknown native fs operation"); goto exception;
    }
    saved=errno;
    if (IsWindows() && saved==ENOTDIR && (magic==FS_OPEN || magic==FS_RMDIR || (magic==FS_STAT && n!=2))) saved=ENOENT;
    if ((IsWindows()||IsXnu()) && saved==EISDIR && magic==FS_UNLINK) saved=EPERM;
    if (result<0) { JS_FreeValue(ctx,value); value=failure(ctx,saved,name); }
    js_free(ctx,a); js_free(ctx,b); return value;
exception: js_free(ctx,a); js_free(ctx,b); JS_FreeValue(ctx,value); return JS_EXCEPTION;
}

JSValue js_cosmo_fs_api(JSContext *ctx) {
    JSValue api=JS_NewObject(ctx), constants=JS_NewObject(ctx);
    if (JS_IsException(api) || JS_IsException(constants)) goto fail;
    const char *keys[]={"open","close","read","write","stat","mkdir","scan","rename","unlink","rmdir","realpath","mkdtemp","truncate","sync","access","error","pause","chmod"};
    for (size_t i=0;i<sizeof(keys)/sizeof(*keys);i++)
        if (property(ctx,api,keys[i],JS_NewCFunctionMagic(ctx,call,keys[i],0,JS_CFUNC_generic_magic,i))<0) goto fail;
#define ADD(key,val) if (property(ctx,constants,key,JS_NewInt32(ctx,val))<0) goto fail
    ADD("O_RDONLY",0); ADD("O_WRONLY",1); ADD("O_RDWR",2);
    ADD("O_CREAT",IsWindows()?256:IsXnu()?0x200:O_CREAT); ADD("O_EXCL",IsWindows()?1024:IsXnu()?0x800:O_EXCL);
    ADD("O_TRUNC",IsWindows()?512:IsXnu()?0x400:O_TRUNC); ADD("O_APPEND",(IsWindows()||IsXnu())?8:O_APPEND);
    if (!IsWindows()) {
        ADD("O_DIRECTORY",IsXnu()?0x100000:O_DIRECTORY); ADD("O_NOFOLLOW",IsXnu()?0x100:O_NOFOLLOW); ADD("O_NOCTTY",IsXnu()?0x20000:O_NOCTTY);
        ADD("O_NONBLOCK",IsXnu()?4:O_NONBLOCK); ADD("O_DSYNC",IsXnu()?0x400000:O_DSYNC); ADD("O_SYNC",IsXnu()?0x80:O_SYNC);
        ADD("S_IFBLK",S_IFBLK); ADD("S_IFSOCK",S_IFSOCK);
        ADD("S_IRGRP",S_IRGRP); ADD("S_IWGRP",S_IWGRP); ADD("S_IXGRP",S_IXGRP);
        ADD("S_IROTH",S_IROTH); ADD("S_IWOTH",S_IWOTH); ADD("S_IXOTH",S_IXOTH); ADD("S_IXUSR",S_IXUSR);
    }
    ADD("S_IFMT",S_IFMT); ADD("S_IFREG",S_IFREG); ADD("S_IFDIR",S_IFDIR); ADD("S_IFCHR",S_IFCHR);
    ADD("S_IFIFO",S_IFIFO); ADD("S_IFLNK",S_IFLNK); ADD("S_IRUSR",S_IRUSR); ADD("S_IWUSR",S_IWUSR);
    ADD("F_OK",F_OK); ADD("R_OK",R_OK); ADD("W_OK",W_OK); ADD("X_OK",X_OK);
    ADD("COPYFILE_EXCL",1); ADD("COPYFILE_FICLONE",2); ADD("COPYFILE_FICLONE_FORCE",4);
#undef ADD
    if (property(ctx,api,"constants",constants)<0) { JS_FreeValue(ctx,api); return JS_EXCEPTION; }
    return api;
fail: JS_FreeValue(ctx,api); JS_FreeValue(ctx,constants); return JS_EXCEPTION;
}
