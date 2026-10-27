static void key_finalize(JSRuntime *rt,JSValue value){qcrypto_key_free(JS_GetOpaque(value,key_class));}
static void cipher_finalize(JSRuntime *rt,JSValue value){qcrypto_aead_free(JS_GetOpaque(value,cipher_class));}
static const JSClassDef key_definition={"QjsKeyMaterial",.finalizer=key_finalize};
static const JSClassDef cipher_definition={"QjsAeadState",.finalizer=cipher_finalize};
static QCryptoKey *key_receiver(JSContext *ctx,JSValueConst value){return JS_GetOpaque2(ctx,value,key_class);}
static QCryptoAead *cipher_receiver(JSContext *ctx,JSValueConst value){
    QCryptoAead *state=JS_GetOpaque2(ctx,value,cipher_class);
    if(!state && !JS_HasException(ctx))failure(ctx,"ERR_CRYPTO_INVALID_STATE","Invalid cipher state");return state;
}
static JSValue wrap_key(JSContext *ctx,QCryptoKey *key){
    if(!key)return JS_ThrowOutOfMemory(ctx);
    JSValue value=JS_NewObjectProtoClass(ctx,JS_NULL,key_class);if(JS_IsException(value)){qcrypto_key_free(key);return value;}
    JS_SetOpaque(value,key);return value;
}
static JSValue extended_call(JSContext *ctx,int argc,JSValueConst *args,int kind){
    static const uint8_t needed[]={5,1,1,1,4,7,2,8,4,4,4,1};
    if((unsigned)(kind-CR_KEY_NEW)>=sizeof(needed) || argc<needed[kind-CR_KEY_NEW])return JS_ThrowTypeError(ctx,"Invalid native key/cipher argument count");
    uint64_t algorithm,type;Bytes data,signature,iv;uint8_t *out;int error;
    if(kind==CR_KEY_NEW){
        if(number(ctx,args[0],QKEY_X25519,&algorithm)<0 || number(ctx,args[1],QKEY_PRIVATE,&type)<0 || span(ctx,args+2,&data)<0)return JS_EXCEPTION;
        if(algorithm==QKEY_SECRET?type!=QKEY_SYMMETRIC:type==QKEY_SYMMETRIC || data.length!=32)return JS_ThrowTypeError(ctx,"Invalid native key shape");
        return wrap_key(ctx,qcrypto_key_create(algorithm,type,data.data,data.length));
    }
    if(kind==CR_KEY_GENERATE){
        if(number(ctx,args[0],QKEY_X25519,&algorithm)<0)return JS_EXCEPTION;
        if(!algorithm)return JS_ThrowTypeError(ctx,"Invalid asymmetric key algorithm");
        uint8_t seed[32];error=qcrypto_random(seed,sizeof(seed));if(error){explicit_bzero(seed,sizeof(seed));return compute_failure(ctx,error);}
        if(algorithm==QKEY_X25519){seed[0]&=248;seed[31]&=127;seed[31]|=64;}
        QCryptoKey *private_key=qcrypto_key_create(algorithm,QKEY_PRIVATE,seed,sizeof(seed));explicit_bzero(seed,sizeof(seed));
        if(!private_key)return JS_ThrowOutOfMemory(ctx);
        QCryptoKey *public_key=qcrypto_key_public(private_key);if(!public_key){qcrypto_key_free(private_key);return JS_ThrowOutOfMemory(ctx);}
        JSValue private_value=wrap_key(ctx,private_key);if(JS_IsException(private_value)){qcrypto_key_free(public_key);return private_value;}
        JSValue public_value=wrap_key(ctx,public_key);if(JS_IsException(public_value)){JS_FreeValue(ctx,private_value);return public_value;}
        JSValue pair=JS_NewObject(ctx);if(JS_IsException(pair)){JS_FreeValue(ctx,private_value);JS_FreeValue(ctx,public_value);return pair;}
        if(JS_SetPropertyStr(ctx,pair,"privateKey",private_value)<0){JS_FreeValue(ctx,public_value);JS_FreeValue(ctx,pair);return JS_EXCEPTION;}
        if(JS_SetPropertyStr(ctx,pair,"publicKey",public_value)<0){JS_FreeValue(ctx,pair);return JS_EXCEPTION;}return pair;
    }
    if(kind<=CR_KEY_DERIVE){
        QCryptoKey *key=key_receiver(ctx,args[0]);if(!key)return JS_EXCEPTION;
        if(kind==CR_KEY_EXPORT){JSValue value=output(ctx,qcrypto_key_length(key),&out);if(JS_IsException(value))return value;if(qcrypto_key_length(key))memcpy(out,qcrypto_key_bytes(key),qcrypto_key_length(key));return value;}
        if(kind==CR_KEY_PUBLIC){if(qcrypto_key_algorithm(key)==QKEY_SECRET)return JS_ThrowTypeError(ctx,"Expected an asymmetric key");return wrap_key(ctx,qcrypto_key_public(key));}
        if(kind==CR_KEY_DERIVE){
            QCryptoKey *peer=key_receiver(ctx,args[1]);if(!peer)return JS_EXCEPTION;
            JSValue value=output(ctx,32,&out);if(JS_IsException(value))return value;
            error=qcrypto_key_derive(key,peer,out);if(error){JS_FreeValue(ctx,value);return failure(ctx,"ERR_OSSL_FAILED_DURING_DERIVATION","Failed during key derivation");}return value;
        }
        if(span(ctx,args+1,&data)<0)return JS_EXCEPTION;
        if(kind==CR_KEY_SIGN){
            JSValue value=output(ctx,64,&out);if(JS_IsException(value))return value;
            error=qcrypto_key_sign(key,data.data,data.length,out);if(error){JS_FreeValue(ctx,value);return compute_failure(ctx,error);}return value;
        }
        if(span(ctx,args+4,&signature)<0)return JS_EXCEPTION;if(signature.length!=64)return JS_FALSE;
        error=qcrypto_key_verify(key,data.data,data.length,signature.data);return error<0?compute_failure(ctx,error):JS_NewBool(ctx,error);
    }
    if(kind==CR_CIPHER_NEW){
        if(number(ctx,args[0],3,&algorithm)<0 || !JS_IsBool(args[1]))return JS_ThrowTypeError(ctx,"Invalid native cipher arguments");
        if(span(ctx,args+2,&data)<0 || span(ctx,args+5,&iv)<0)return JS_EXCEPTION;
        QCryptoAead *state=qcrypto_aead_create(algorithm,JS_ToBool(ctx,args[1]),data.data,data.length,iv.data,iv.length,&error);
        if(!state)return compute_failure(ctx,error);
        JSValue value=JS_NewObjectProtoClass(ctx,JS_NULL,cipher_class);if(JS_IsException(value)){qcrypto_aead_free(state);return value;}JS_SetOpaque(value,state);return value;
    }
    if(kind==CR_CIPHER_CLOSE){
        if(JS_GetClassID(args[0])!=cipher_class)return JS_ThrowTypeError(ctx,"Invalid native cipher receiver");
        qcrypto_aead_free(JS_GetOpaque(args[0],cipher_class));JS_SetOpaque(args[0],NULL);return JS_UNDEFINED;
    }
    QCryptoAead *state=cipher_receiver(ctx,args[0]);if(!state)return JS_EXCEPTION;
    if(span(ctx,args+1,&data)<0)return JS_EXCEPTION;
    if(kind==CR_CIPHER_AAD){error=qcrypto_aead_aad(state,data.data,data.length);return error?compute_failure(ctx,error):JS_UNDEFINED;}
    JSValue value=output(ctx,kind==CR_CIPHER_FINISH?16:data.length,&out);if(JS_IsException(value))return value;
    if(kind==CR_CIPHER_UPDATE)error=qcrypto_aead_update(state,data.data,data.length,out);
    else {error=qcrypto_aead_finish(state,data.data,data.length,out);qcrypto_aead_free(state);JS_SetOpaque(args[0],NULL);}
    if(!error)return value;JS_FreeValue(ctx,value);
    if(error==QCR_AUTH || kind==CR_CIPHER_FINISH && error==QCR_ARGUMENT)return failure(ctx,NULL,"Unsupported state or unable to authenticate data");
    return compute_failure(ctx,error);
}
