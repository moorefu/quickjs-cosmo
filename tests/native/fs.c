/* Fault injection belongs only to this SDK executable, never the runtime. */
#include <assert.h>
#include <errno.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"

static int target=-1, opened, closed, mode, reads, writes, interrupted, large_offset;
int __real_qjs_cosmo_fs_openat(int,const char *,int,...);
ssize_t __real_read(int,void *,size_t);
ssize_t __real_pread(int,void *,size_t,int64_t);
ssize_t __real_write(int,const void *,size_t);
ssize_t __real_pwrite(int,const void *,size_t,int64_t);
int __real_close(int);
int __real_fstat(int,struct stat *);

int __wrap_qjs_cosmo_fs_openat(int directory,const char *path,int flags,...) {
    va_list args; va_start(args,flags); unsigned permissions=va_arg(args,unsigned); va_end(args);
    int chosen=strstr(path,"/.fs-fault-data") || strstr(path,"\\.fs-fault-data");
    if (chosen && !(interrupted&1)) { interrupted|=1; errno=EINTR; return -1; }
    int result=__real_qjs_cosmo_fs_openat(directory,path,flags,permissions);
    if (chosen && result>=0) { assert(target==-1); target=result; opened++; reads=writes=0; }
    return result;
}
ssize_t __wrap_read(int fd,void *buffer,size_t length) {
    if (fd!=target) return __real_read(fd,buffer,length);
    if (!(interrupted&2)) { interrupted|=2; errno=EINTR; return -1; }
    if (mode==8) { errno=EAGAIN; return -1; }
    if (mode==3 && reads++) { errno=EIO; return -1; }
    return __real_read(fd,buffer,length>3?3:length);
}
ssize_t __wrap_pread(int fd,void *buffer,size_t length,int64_t position) {
    if (fd==target && position>UINT32_MAX) large_offset++;
    if (fd==target && mode==7) { errno=ESPIPE; return -1; }
    return __real_pread(fd,buffer,length,position);
}
ssize_t __wrap_write(int fd,const void *buffer,size_t length) {
    if (fd!=target) return __real_write(fd,buffer,length);
    writes++;
    if (!(interrupted&4)) { interrupted|=4; errno=EINTR; return -1; }
    if (mode==2) return 0;
    return __real_write(fd,buffer,length>3?3:length);
}
ssize_t __wrap_pwrite(int fd,const void *buffer,size_t length,int64_t position) {
    return __real_pwrite(fd,buffer,length,position);
}
int __wrap_close(int fd) {
    if (fd==target) { target=-1; closed++; }
    return __real_close(fd);
}
int __wrap_fstat(int fd,struct stat *value) {
    int result=__real_fstat(fd,value);
    if (!result && fd==target && mode==4) value->st_size=INT64_C(0x80000000);
    if (!result && fd==target && mode==5) value->st_size=0;
    if (!result && fd==target && mode==6) value->st_size=50;
    return result;
}

static JSValue allocation_limit(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    int64_t limit;
    if (JS_ToInt64(ctx,&limit,argv[0])<0) return JS_EXCEPTION;
    JS_SetMemoryLimit(JS_GetRuntime(ctx),limit); return JS_UNDEFINED;
}
static int evaluate(JSContext *ctx,const char *source) {
    JSValue value=JS_Eval(ctx,source,strlen(source),"<fs-sdk>",JS_EVAL_TYPE_MODULE);
    if (JS_IsException(value)) { js_std_dump_error(ctx); return -1; }
    value=js_std_await(ctx,value);
    if (JS_IsException(value)) { js_std_dump_error(ctx); return -1; }
    JS_FreeValue(ctx,value); return 0;
}

int main(void) {
    for (int iteration=0;iteration<8;iteration++) {
        JSRuntime *rt=JS_NewRuntime(); assert(rt); js_std_init_handlers(rt);
        JSContext *ctx=JS_NewContext(rt); assert(ctx);
        JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);
        assert(js_cosmo_init_modules(ctx)==0);
        JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
        JSValue global=JS_GetGlobalObject(ctx);
        assert(JS_SetPropertyStr(ctx,global,"allocationLimit",JS_NewCFunction(ctx,allocation_limit,"allocationLimit",1))==1);
        JS_FreeValue(ctx,global);
        interrupted=0; mode=0;
        assert(evaluate(ctx,
            "import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';"
            "const cwd=process.cwd(), root=fs.mkdtempSync(path.join(cwd,'.fs-sdk-'));"
            "assert.equal(path.dirname(root),cwd); globalThis.fsFixture={fs,path,assert,root,file:path.join(root,'.fs-fault-data')};"
            "fs.writeFileSync(fsFixture.file,Buffer.alloc(100,7));"
            "assert.equal(fs.readFileSync(fsFixture.file).toString('hex'),'07'.repeat(100));"
            "assert.throws(()=>fs.readFileSync(fsFixture.file,{buffer:()=>{throw Error('allocator');}}),/allocator/);"
            "const fd=fs.openSync(fsFixture.file,'r');"
            "assert.throws(()=>fs.readFileSync(fd,{buffer:()=>{throw Error('allocator');}}),/allocator/);"
            "assert.equal(fs.fstatSync(fd).size,100);"
            "assert.equal(fs.readSync(fd,Buffer.alloc(1),{length:1,position:4294967303n}),0); fs.closeSync(fd);") ==0);
        assert(opened==closed && target==-1 && interrupted==7 && large_offset>0);
        mode=7;
        assert(evaluate(ctx,"const {fs,assert,file}=fsFixture; const fd=fs.openSync(file,'r'); try { assert.throws(()=>fs.readSync(fd,Buffer.alloc(1),{position:0,length:1}),{code:'ESPIPE',syscall:'read',errno:process.platform==='win32'?-4041:-29}); } finally {fs.closeSync(fd);}")==0);
        assert(opened==closed && target==-1);
        mode=8;
        assert(evaluate(ctx,"const {fs,assert,file}=fsFixture; assert.throws(()=>fs.readFileSync(file),{code:'EAGAIN',syscall:'read',errno:process.platform==='win32'?-4088:process.platform==='darwin'?-35:-11});")==0);
        assert(opened==closed && target==-1);
        mode=3;
        assert(evaluate(ctx,"const {fs,assert,file}=fsFixture; assert.throws(()=>fs.readFileSync(file),{code:'EIO',syscall:'read'});")==0);
        assert(opened==closed && target==-1);
        mode=5;
        assert(evaluate(ctx,"const {fs,assert,file}=fsFixture; assert.equal(fs.readFileSync(file).length,100); assert.throws(()=>fs.readFileSync(file,{buffer:Buffer.alloc(50)}),{code:'ERR_INVALID_ARG_VALUE'});")==0);
        assert(opened==closed && target==-1);
        mode=6;
        assert(evaluate(ctx,"const {fs,assert,file}=fsFixture; assert.equal(fs.readFileSync(file).length,50); assert.equal(fs.readFileSync(file,'utf8').length,100);")==0);
        assert(opened==closed && target==-1);
        mode=4;
        assert(evaluate(ctx,"const {fs,assert,file}=fsFixture; assert.throws(()=>fs.readFileSync(file),{code:'ERR_FS_FILE_TOO_LARGE'});")==0);
        assert(opened==closed && target==-1);
        mode=2;
        assert(evaluate(ctx,"const {fs,assert,file}=fsFixture; assert.throws(()=>fs.writeFileSync(file,'abc'),{code:'EIO',syscall:'write'});")==0);
        assert(opened==closed && target==-1);
        mode=0;
        assert(evaluate(ctx,
            "const {fs,assert,file}=fsFixture; fs.writeFileSync(file,'allocation'); let failed=false;"
            "try { fs.readFileSync(file,{buffer:()=>{allocationLimit(1); return Buffer.alloc(1024);}}); }"
            "catch { failed=true; } finally { allocationLimit(64*1024*1024); } assert(failed);") ==0);
        assert(opened==closed && target==-1);
        assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);
        assert(evaluate(ctx,"const {fs,path,assert,root}=fsFixture; assert.equal(path.dirname(root),process.cwd()); fs.rmSync(root,{recursive:true});")==0);
        JS_FreeContext(ctx); js_std_free_handlers(rt); JS_FreeRuntime(rt);
    }
    puts("PASS fs-sdk: partial I/O, EINTR, 64-bit read, allocation and failure cleanup");
    return 0;
}
