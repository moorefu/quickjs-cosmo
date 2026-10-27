#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "quickjs-libc.h"
#include "qjs-cosmo.h"
static void evaluate(JSContext *ctx,const char *source) {
    JSValue value=JS_Eval(ctx,source,strlen(source),"<stream-sdk>",JS_EVAL_TYPE_MODULE);
    if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}
    value=js_std_await(ctx,value);if(JS_IsException(value)){js_std_dump_error(ctx);assert(0);}JS_FreeValue(ctx,value);
}
int main(void) {
    for(int iteration=0;iteration<4;iteration++) {
        JSRuntime *rt=JS_NewRuntime();assert(rt);js_std_init_handlers(rt);
        JSContext *ctx=JS_NewContext(rt);assert(ctx);JS_SetContextOpaque(ctx,(void *)(uintptr_t)0x1234);assert(js_cosmo_init_modules(ctx)==0);
        JS_SetModuleLoaderFunc2(rt,js_cosmo_module_normalize,js_module_loader,js_module_check_attributes,NULL);
        evaluate(ctx,"import s,{Readable,Writable,Transform,PassThrough} from 'node:stream';import bare from 'stream';import p from 'node:stream/promises';import a from 'node:assert/strict';"
            "a.equal(s,bare);a.equal(s.promises,p);const output=[];await p.pipeline(Readable.from([1,2,3]),new Transform({objectMode:true,transform(c,e,cb){cb(null,c*2);}}),new Writable({objectMode:true,highWaterMark:1,write(c,e,cb){output.push(c);setTimeout(cb,1);}}));a.equal(output.join(','),'2,4,6');"
            "const controller=new AbortController(),source=new PassThrough(),sink=new Writable({write(c,e,cb){cb();}});const done=p.pipeline(source,sink,{signal:controller.signal}).catch(e=>e.code);controller.abort();a.equal(await done,'ABORT_ERR');a(source.closed&&sink.closed);"
            "globalThis.pending=new Writable({construct(cb){setTimeout(cb,10000);},write(c,e,cb){cb();}});pending.write('retained');");
        assert(JS_GetContextOpaque(ctx)==(void *)(uintptr_t)0x1234);js_std_free_handlers(rt);JS_FreeContext(ctx);JS_FreeRuntime(rt);
    }
    puts("PASS stream-sdk: pipeline, backpressure, abort and pending construction shutdown");
}
