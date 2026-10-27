typedef struct {int kind,valid;QCryptoKey *key,*peer;Bytes data,signature;uint8_t output[64];} KeyTask;
static void key_task_cleanup(QJSCosmoTask *task){KeyTask *r=js_cosmo_task_data(task);qcrypto_key_free(r->key);qcrypto_key_free(r->peer);}
static int key_task_work(QJSCosmoTask *task){
    KeyTask *r=js_cosmo_task_data(task);QCryptoAllocator old=qcrypto_allocator_enter((QCryptoAllocator){task,task_allocate,task_release});int result;
    if(r->kind==CR_KEY_SIGN)result=qcrypto_key_sign(r->key,r->data.data,r->data.length,r->output);
    else if(r->kind==CR_KEY_DERIVE)result=qcrypto_key_derive(r->key,r->peer,r->output);
    else if(r->signature.length!=64){r->valid=0;result=0;}
    else {result=qcrypto_key_verify(r->key,r->data.data,r->data.length,r->signature.data);if(result>=0){r->valid=result;result=0;}}
    qcrypto_allocator_leave(old);return result;
}
static JSValue key_task_finish(JSContext *ctx,QJSCosmoTask *task,int error){
    KeyTask *r=js_cosmo_task_data(task);
    if(error){if(r->kind==CR_KEY_DERIVE && error==QCR_BACKEND)return failure(ctx,"ERR_OSSL_FAILED_DURING_DERIVATION","Failed during key derivation");return compute_failure(ctx,error);}
    if(r->kind==CR_KEY_VERIFY)return JS_NewBool(ctx,r->valid);
    size_t length=r->kind==CR_KEY_SIGN?64:32;uint8_t *data;JSValue value=output(ctx,length,&data);if(JS_IsException(value))return value;memcpy(data,r->output,length);return value;
}
static JSValue call_key_async(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args,int kind){
    if(argc<(kind==CR_KEY_DERIVE?2:kind==CR_KEY_SIGN?4:7))return JS_ThrowTypeError(ctx,"Invalid native asynchronous key arguments");
    QCryptoKey *key=key_receiver(ctx,args[0]),*peer=NULL;if(!key)return JS_EXCEPTION;
    Bytes data={0},signature={0};
    if(kind==CR_KEY_DERIVE){peer=key_receiver(ctx,args[1]);if(!peer)return JS_EXCEPTION;}
    else if(span(ctx,args+1,&data)<0 || (kind==CR_KEY_VERIFY && span(ctx,args+4,&signature)<0))return JS_EXCEPTION;
    size_t budget=65536+data.length+signature.length;
    QJSCosmoTask *task=js_cosmo_task_create(ctx,budget,sizeof(KeyTask),key_task_work,key_task_finish);if(!task)return JS_EXCEPTION;
    KeyTask *r=js_cosmo_task_data(task);*r=(KeyTask){.kind=kind,.data=data,.signature=signature};js_cosmo_task_set_cleanup(task,key_task_cleanup);
    QCryptoAllocator old=qcrypto_allocator_enter((QCryptoAllocator){task,task_allocate,task_release});
    r->key=qcrypto_key_create(qcrypto_key_algorithm(key),qcrypto_key_kind(key),qcrypto_key_bytes(key),qcrypto_key_length(key));
    if(peer)r->peer=qcrypto_key_create(qcrypto_key_algorithm(peer),qcrypto_key_kind(peer),qcrypto_key_bytes(peer),qcrypto_key_length(peer));
    qcrypto_allocator_leave(old);if(!r->key || (peer && !r->peer))goto memory;
    Bytes *spans[]={&r->data,&r->signature};
    for(int i=0;i<2;i++)if(spans[i]->length){uint8_t *copy=js_cosmo_task_alloc(task,spans[i]->length);if(!copy)goto memory;memcpy(copy,spans[i]->data,spans[i]->length);spans[i]->data=copy;}
    return js_cosmo_task_submit(ctx,task,NULL);
memory:js_cosmo_task_discard(task);return JS_ThrowOutOfMemory(ctx);
}
