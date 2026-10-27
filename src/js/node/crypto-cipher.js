function createCiphers(binding, streams, keys, decoderFactory) {
    const states=new WeakMap(),names=['aes-128-gcm','aes-192-gcm','aes-256-gcm','chacha20-poly1305'];
    const invalidState=operation=>codedError(Error,'ERR_CRYPTO_INVALID_STATE','Invalid state'+(operation?' for operation '+operation:''));
    function receiver(value){const state=states.get(value);if(!state)throw new TypeError('Invalid Cipher receiver');return state;}
    function uintOption(options,name,fallback){const value=options?.[name];if(value==null)return fallback;if((value>>>0)!==value)throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid options.'+name);return value+0;}
    function stringOption(options,name){const value=options?.[name];if(value==null)return undefined;if(typeof value!=='string')throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid options.'+name);return value;}
    function validTag(algorithm,length){return algorithm===3?length>=1&&length<=16:[4,8,12,13,14,15,16].includes(length);}
    function tagError(length){return codedError(TypeError,'ERR_CRYPTO_INVALID_AUTH_TAG','Invalid authentication tag length: '+length);}
    function init(value,algorithm,key,iv,options,decrypt){
        if(typeof algorithm!=='string')throw invalidType('cipher','a string');
        const aliases={'id-aes128-gcm':0,'id-aes192-gcm':1,'id-aes256-gcm':2};
        const lower=algorithm.toLowerCase(),id=Object.prototype.hasOwnProperty.call(aliases,lower)?aliases[lower]:names.indexOf(lower);
        if(id<0)throw codedError(Error,'ERR_CRYPTO_UNKNOWN_CIPHER','Unknown cipher');
        const opts=options??{},encoding=stringOption(opts,'encoding');
        const keySpan=keys.has(key)?keys.secretSpan(key):keys.span(keys.raw(key,'key',encoding));
        const nonce=iv===null?Buffer.alloc(0):keys.raw(iv,'iv',encoding);
        const tagLength=uintOption(opts,'authTagLength',decrypt&&id!==3?undefined:16);
        if(tagLength!==undefined && !validTag(id,tagLength))throw tagError(tagLength);
        if(keySpan[2]!==[16,24,32,32][id])throw codedError(RangeError,'ERR_CRYPTO_INVALID_KEYLEN','Invalid key length');
        if(!nonce.length || id===3&&nonce.length!==12)throw codedError(TypeError,'ERR_CRYPTO_INVALID_IV','Invalid initialization vector');
        const handle=binding.cipherNew(id,decrypt,...keySpan,...keys.span(nonce));
        try{
            streams.Transform.call(value,opts);
            states.set(value,{handle,id,decrypt,tagLength,tag:null,expected:null,started:false,done:false,decoder:null});
        }catch(error){binding.cipherClose(handle);throw error;}
    }
    function Cipheriv(algorithm,key,iv,options){if(!(this instanceof Cipheriv))return new Cipheriv(algorithm,key,iv,options);init(this,algorithm,key,iv,options,false);}
    function Decipheriv(algorithm,key,iv,options){if(!(this instanceof Decipheriv))return new Decipheriv(algorithm,key,iv,options);init(this,algorithm,key,iv,options,true);}
    function encoded(state,data,encoding,final=false){
        if(!encoding || encoding==='buffer')return data;
        const normalized=normalizeEncoding(encoding);
        if(!normalized)throw codedError(TypeError,'ERR_UNKNOWN_ENCODING','Unknown encoding: '+encoding);
        if(state.decoder && state.decoder.encoding!==normalized)throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','The outputEncoding cannot be changed');
        state.decoder??=decoderFactory(encoding);
        return state.decoder.write(data)+(final?state.decoder.end():'');
    }
    for(const Constructor of [Cipheriv,Decipheriv]){
        Object.setPrototypeOf(Constructor.prototype,streams.Transform.prototype);Object.setPrototypeOf(Constructor,streams.Transform);
        Constructor.prototype.update=function(data,inputEncoding,outputEncoding){
            const state=receiver(this);if(state.done)throw new Error('Trying to add data in unsupported state');
            if(typeof data==='string' && typeof inputEncoding==='string' && inputEncoding.toLowerCase()==='hex' && data.length%2)throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid hex input');
            const input=keys.raw(data,'data',inputEncoding),result=Buffer.from(binding.cipherUpdate(state.handle,...keys.span(input)));
            if(input.length)state.started=true;return encoded(state,result,outputEncoding);
        };
        Constructor.prototype.final=function(outputEncoding){
            const state=receiver(this);if(state.done)throw invalidState();
            try{
                const tag=state.expected??Buffer.alloc(0),computed=Buffer.from(binding.cipherFinish(state.handle,...keys.span(tag)));
                if(!state.decrypt)state.tag=computed.subarray(0,state.tagLength);
            }finally{state.done=true;binding.cipherClose(state.handle);state.handle=null;}
            return encoded(state,Buffer.alloc(0),outputEncoding,true);
        };
        Constructor.prototype.setAAD=function(data,options){
            const encoding=stringOption(options,'encoding');uintOption(options,'plaintextLength',undefined);
            const input=keys.raw(data,'aadbuf',encoding),state=receiver(this);
            if(state.done || state.started)throw invalidState('setAAD');
            binding.cipherAAD(state.handle,...keys.span(input));return this;
        };
        Constructor.prototype.setAutoPadding=function(){if(receiver(this).done)throw invalidState('setAutoPadding');return this;};
        Constructor.prototype._transform=function(data,encoding,callback){try{callback(null,this.update(data,encoding));}catch(error){callback(error);}};
        Constructor.prototype._flush=function(callback){try{callback(null,this.final());}catch(error){callback(error);}};
        // Like Node, stream destruction does not invalidate the separate manual
        // update/final interface. Final or native-holder GC wipes key schedules.
        Constructor.prototype._destroy=function(error,callback){callback(error);};
    }
    Cipheriv.prototype.getAuthTag=function(){const state=receiver(this);if(!state.done || !state.tag)throw invalidState('getAuthTag');return Buffer.from(state.tag);};
    Decipheriv.prototype.setAuthTag=function(data,encoding){
        const tag=keys.raw(data,'buffer',encoding),state=receiver(this);
        if(state.done || state.expected)throw invalidState('setAuthTag');
        if(!validTag(state.id,tag.length) || state.tagLength!==undefined && tag.length!==state.tagLength)throw tagError(tag.length);
        state.expected=Buffer.from(tag);return this;
    };
    return {Cipheriv,Decipheriv,createCipheriv:(...args)=>new Cipheriv(...args),createDecipheriv:(...args)=>new Decipheriv(...args),getCiphers:()=>names.slice()};
}
