/* Freestanding AArch64 PID 1. The kernel, not a libc shim, supplies AT_PAGESZ.
   Test-only: raw Linux syscalls, no external root filesystem or init binary. */
typedef unsigned long U;
static long call(U n,U a,U b,U c,U d,U e,U f){
    register U x0 __asm__("x0")=a,x1 __asm__("x1")=b,x2 __asm__("x2")=c;
    register U x3 __asm__("x3")=d,x4 __asm__("x4")=e,x5 __asm__("x5")=f,x8 __asm__("x8")=n;
    __asm__ volatile("svc 0":"+r"(x0):"r"(x1),"r"(x2),"r"(x3),"r"(x4),"r"(x5),"r"(x8):"memory","cc");
    return x0;
}
static U size(const char *s){U n=0;while(s[n])++n;return n;}
static void put(const char *s){call(64,1,(U)s,size(s),0,0,0);}
static void number(U v){char b[24];U i=sizeof(b);b[--i]=0;do{b[--i]='0'+v%10;v/=10;}while(v);put(b+i);}
static void poweroff(void){call(142,0xfee1dead,672274793,0x4321fedc,0,0,0);for(;;)call(93,1,0,0,0,0,0);}
static void fail(const char *message,long error){put("KERNEL64K_FAIL ");put(message);put(" errno=");number(error<0?-error:error);put("\n");poweroff();}
static char *environment[]={"PATH=/bin:/app","HOME=/root","TMPDIR=/tmp","TMP=/tmp","LANG=C","QJS_KERNEL64K=1",0};
static void execute(const char *label,char **argv){
    long child=call(220,17,0,0,0,0,0);if(child<0)fail("clone",child);
    if(!child){long error=call(221,(U)argv[0],(U)argv,(U)environment,0,0,0);fail("execve",error);}
    int status=0;long result;
    do{result=call(260,child,(U)&status,0,0,0,0);}while(result==-4);
    if(result!=child||status)fail(label,status?status:result);
    put("KERNEL64K_CASE ");put(label);put("\n");
}
static void write_file(const char *path,const char *data){
    long fd=call(56,-100,(U)path,1,0,0,0);if(fd<0)fail(path,fd);
    long result=call(64,fd,(U)data,size(data),0,0,0);call(57,fd,0,0,0,0,0);
    if(result!=(long)size(data))fail("write",result);
}
void start(U *sp){
    U argc=*sp++,*aux;sp+=argc+1;while(*sp++){}aux=sp;
    U pages=0;for(;aux[0];aux+=2)if(aux[0]==6)pages=aux[1];
    if(pages!=65536)fail("AT_PAGESZ",pages);
    char uname[390];long error=call(160,(U)uname,0,0,0,0,0);if(error)fail("uname",error);
    put("KERNEL64K_AUXV {\"pageSize\":");number(pages);put(",\"release\":\"");put(uname+130);put("\",\"machine\":\"");put(uname+260);put("\"}\n");
    error=call(40,(U)"proc",(U)"/proc",(U)"proc",0,0,0);if(error)fail("mount proc",error);
    char *loader[]={"/bin/ape","/app/qjs.exe","-m","/app/kernel.mjs",0};execute("loader-fat",loader);
    char *literal[]={"/bin/ape","-","/app/qjs.exe","custom argv0 中文","-m","/app/kernel.mjs",0};execute("literal-argv0",literal);
    char *bare[]={"/app/qjs.elf","-m","/app/kernel.mjs",0};execute("bare-elf",bare);
    char *compiled[]={"/bin/ape","/app/deployment-standalone.exe",0};execute("compiled",compiled);
    char *sdk[]={"/bin/ape","/app/deployment-sdk.exe","/app/kernel.mjs",0};execute("sdk",sdk);
    char *qjsc[]={"/bin/ape","/app/qjsc.exe","-c","-m","-o","/tmp/kernel.c","/app/kernel.mjs",0};execute("qjsc",qjsc);
    /* Loading a matching module is confined to this disposable VM. */
    long fd=call(56,-100,(U)"/bin/binfmt_misc.ko",0,0,0,0);
    if(fd>=0){error=call(273,fd,(U)"",0,0,0,0);call(57,fd,0,0,0,0,0);if(error)fail("finit_module",error);}
    call(34,-100,(U)"/proc/sys/fs/binfmt_misc",0755,0,0,0);
    error=call(40,(U)"binfmt_misc",(U)"/proc/sys/fs/binfmt_misc",(U)"binfmt_misc",0,0,0);if(error)fail("mount binfmt_misc",error);
    write_file("/proc/sys/fs/binfmt_misc/register",":qjs-ape:M::MZqFpD::/bin/ape:PF");
    char *fat[]={"/app/qjs.exe","-m","/app/kernel.mjs",0};execute("binfmt-fat",fat);
    char *nested[]={"/app/qjs.exe","-m","/app/kernel.mjs","nested",0};execute("binfmt-nested",nested);
    put("KERNEL64K_PASS\n");poweroff();
}
__asm__(".global _start\n_start:\nmov x0, sp\nbl start\n");
