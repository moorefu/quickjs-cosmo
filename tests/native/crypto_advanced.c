#include <assert.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
#include "qjs-tasks.h"
typedef struct {void *pointer;size_t size;int freed;} Probe;
typedef struct {void *pointer;size_t size;int live;} Allocation;
static Probe probes[4];static Allocation captured[32];static int capture_mode,captured_count,checked;
static int workspace_fail,workspace_calls,output_fail,output_injected;static atomic_int foreign;
static pthread_t owner;
void *__real_js_malloc_rt(JSRuntime *,size_t);
void *__real_js_malloc(JSContext *,size_t);
void __real_js_free_rt(JSRuntime *,void *);
void *__wrap_js_malloc_rt(JSRuntime *rt,size_t size){
    if(checked && !pthread_equal(owner,pthread_self()))atomic_fetch_add(&foreign,1);
    if(workspace_fail && size>=5120 && size<=5300){workspace_calls++;if(workspace_calls==workspace_fail)return NULL;}
    void *p=__real_js_malloc_rt(rt,size);
    if(p && capture_mode && captured_count<32)captured[captured_count++]=(Allocation){p,size,1};
    if(p && capture_mode==4 && size>=32*1024*1024 && size<34*1024*1024)probes[3]=(Probe){p,size,0};
    return p;
}
void *__wrap_js_malloc(JSContext *ctx,size_t size){
    if(checked && !pthread_equal(owner,pthread_self()))atomic_fetch_add(&foreign,1);
    if(output_fail && size==16){output_fail=0;output_injected++;JS_ThrowOutOfMemory(ctx);return NULL;}
    return __real_js_malloc(ctx,size);
}
void __wrap_js_free_rt(JSRuntime *rt,void *p){
    if(p){
        for(int i=0;i<captured_count;i++)if(captured[i].pointer==p)captured[i].live=0;
        for(int i=0;i<4;i++)if(probes[i].pointer==p){
            const uint8_t *bytes=p;for(size_t j=0;j<probes[i].size;j++)assert(bytes[j]==0);
            probes[i].pointer=NULL;probes[i].freed++;
        }
    }
    __real_js_free_rt(rt,p);
}
static JSValue arm(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){
    int mode=0;if(argc)JS_ToInt32(ctx,&mode,argv[0]);
    capture_mode=mode;captured_count=0;memset(captured,0,sizeof(captured));return JS_UNDEFINED;
}
static void find_marker(int index){
    capture_mode=0;int found=0;
    for(int i=0;i<captured_count;i++)if(captured[i].live && captured[i].size>=32){
        const uint8_t *bytes=captured[i].pointer;
        for(size_t j=0;j+32<=captured[i].size;j++){
            size_t k=0;while(k<32 && bytes[j+k]==0xa5)k++;
            if(k==32){probes[index]=(Probe){captured[i].pointer,captured[i].size,0};found++;break;}
        }
    }
    assert(found==1);
}
static void evaluate(JSContext *ctx,const char *source){
    JSValue value=JS_Eval(ctx,source,strlen(source),"<crypto-advanced-sdk>",JS_EVAL_TYPE_MODULE);
    if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}value=js_std_await(ctx,value);
    if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}JS_FreeValue(ctx,value);
}
int main(void){
    owner=pthread_self();
    for(int iteration=0;iteration<3;iteration++){
        memset(probes,0,sizeof(probes));capture_mode=captured_count=workspace_fail=workspace_calls=0;
        JSRuntime *rt=JS_NewRuntime();assert(rt);js_std_init_handlers(rt);JSContext *ctx=JS_NewContext(rt);assert(ctx);
        JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);assert(js_cosmo_init_modules(ctx)==0);
        JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
        JSValue global=JS_GetGlobalObject(ctx);assert(JS_SetPropertyStr(ctx,global,"armCryptoProbe",JS_NewCFunction(ctx,arm,"armCryptoProbe",1))>=0);JS_FreeValue(ctx,global);checked=1;
        evaluate(ctx,"import c from 'node:crypto';globalThis.c=c;globalThis.marker=Buffer.alloc(32,0xa5);"
            "globalThis.privateKey=c.createPrivateKey({key:Buffer.from('302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex'),format:'der',type:'pkcs8'});"
            "globalThis.publicKey=c.createPublicKey(privateKey);globalThis.signature=c.sign(null,Buffer.alloc(0),privateKey);"
            "globalThis.verifyKnown=()=>c.verify(null,Buffer.alloc(0),publicKey,signature);if(!verifyKnown())throw Error('signature vector');"
            "armCryptoProbe(1);globalThis.secret=c.createSecretKey(marker);");
        find_marker(0);evaluate(ctx,"globalThis.secret=null;");for(int i=0;i<4;i++)JS_RunGC(rt);assert(probes[0].freed==1);
        const char *algorithms[]={"aes-256-gcm","chacha20-poly1305"};
        for(int i=0;i<2;i++){
            char source[240];snprintf(source,sizeof(source),"armCryptoProbe(2);globalThis.cipher=c.createCipheriv('%s',marker,Buffer.alloc(12));",algorithms[i]);evaluate(ctx,source);
            find_marker(i+1);evaluate(ctx,"cipher.update('private material cleanup');cipher.final();globalThis.cipher=null;");assert(probes[i+1].freed==1);
        }
        workspace_calls=0;workspace_fail=1;
        evaluate(ctx,"let failed=false;try{verifyKnown();}catch(e){failed=true;}if(!failed)throw Error('missing verification OOM');");assert(workspace_calls==1);
        workspace_calls=0;workspace_fail=2;evaluate(ctx,"if(!verifyKnown())throw Error('verification workspace');");assert(workspace_calls==1);workspace_fail=0;
        evaluate(ctx,"globalThis.oomCipher=c.createCipheriv('aes-128-gcm',Buffer.alloc(16),Buffer.alloc(12));");
        output_fail=1;evaluate(ctx,"let failed=false;try{oomCipher.final();}catch(e){failed=true;}if(!failed)throw Error('missing output OOM');");assert(!output_fail);
        /* One pending signature task owns a copied private key and message.
           Its entire prepaid arena must be wiped on RT shutdown. */
        evaluate(ctx,"globalThis.message=Buffer.alloc(32*1024*1024,66);armCryptoProbe(4);c.sign(null,message,privateKey,()=>{throw Error('shutdown callback');});");capture_mode=0;
        assert(probes[3].pointer);QJSCosmoTaskStats stats;js_cosmo_tasks_stats(rt,&stats);assert(stats.active>0);
        assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);js_std_free_handlers(rt);assert(probes[3].freed==1);
        JS_FreeContext(ctx);JS_FreeRuntime(rt);checked=0;assert(!atomic_load(&foreign));
    }
    assert(output_injected==3);puts("PASS crypto-advanced-sdk: key/schedule/task wiping, prepaid verification OOM, output OOM and pending shutdown");
}
