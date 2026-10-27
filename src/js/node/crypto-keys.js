function createKeys(binding) {
    const states=new WeakMap(),token=Symbol('KeyObject'),names=['secret','ed25519','x25519'],kinds=['secret','public','private'];
    const unsupported=message=>codedError(Error,'ERR_NOT_SUPPORTED',message);
    const invalidKey=()=>codedError(Error,'ERR_OSSL_UNSUPPORTED','Unsupported key encoding');
    const wrongType=(actual,expected)=>codedError(TypeError,'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE','Invalid key object type '+actual+', expected '+expected);
    function raw(value,name='key',encoding) {
        if(typeof value==='string')return Buffer.from(value,encoding);
        if(ArrayBuffer.isView(value))return Buffer.from(value.buffer,value.byteOffset,value.byteLength);
        if(isArrayBuffer(value))return Buffer.from(value);
        throw invalidType(name,'a string, ArrayBuffer or ArrayBufferView');
    }
    const span=value=>[value.buffer,value.byteOffset,value.byteLength];
    function state(value){const found=states.get(value);if(!found)throw invalidType('key','a KeyObject');return found;}
    class KeyObject {
        constructor(secret,value){if(secret!==token)throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid key type');states.set(this,value);}
        get type(){return kinds[state(this).kind];}
        get symmetricKeySize(){const s=state(this);return s.kind===0?s.length:undefined;}
        get asymmetricKeyType(){const s=state(this);return s.kind===0?undefined:names[s.algorithm];}
        get asymmetricKeyDetails(){return state(this).kind===0?undefined:{};}
        get [Symbol.toStringTag](){return 'KeyObject';}
        equals(other){
            const first=state(this),second=state(other);
            if(first.kind!==second.kind || first.algorithm!==second.algorithm || first.length!==second.length)return false;
            const a=Buffer.from(binding.keyExport(first.kind===2?binding.keyPublic(first.handle):first.handle));
            const b=Buffer.from(binding.keyExport(second.kind===2?binding.keyPublic(second.handle):second.handle));
            try{return binding.equal(...span(a),...span(b));}finally{a.fill(0);b.fill(0);}
        }
        export(options){
            const s=state(this);
            if(s.kind===0){if(options?.format==='jwk')throw unsupported('JWK export is not enabled');return Buffer.from(binding.keyExport(s.handle));}
            if(!options || typeof options!=='object')throw invalidType('options','an object');
            if(options.cipher!==undefined)throw unsupported('Encrypted private key export is not enabled');
            const type=s.kind===2?'pkcs8':'spki',format=options.format??'pem';
            if(format!=='der' && format!=='pem')throw unsupported('Only PKCS8/SPKI DER and PEM are enabled');
            if(options.type!==type)throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid key export type');
            const material=Buffer.from(binding.keyExport(s.handle));let der;
            try{der=Buffer.concat([prefix(s.algorithm,s.kind),material]);}finally{material.fill(0);}
            if(format==='der')return der;
            const label=s.kind===2?'PRIVATE KEY':'PUBLIC KEY';
            try{return '-----BEGIN '+label+'-----\n'+der.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END '+label+'-----\n';}
            finally{if(s.kind===2)der.fill(0);}
        }
    }
    class SecretKeyObject extends KeyObject {}
    class PublicKeyObject extends KeyObject {}
    class PrivateKeyObject extends KeyObject {}
    function wrap(handle,algorithm,kind,length=32){return new [SecretKeyObject,PublicKeyObject,PrivateKeyObject][kind](token,{handle,algorithm,kind,length});}
    function prefix(algorithm,kind){return Buffer.from((kind===2?'302e020100300506032b65':'302a300506032b65')+(algorithm===1?'70':'6e')+(kind===2?'04220420':'032100'),'hex');}
    function createSecretKey(key,encoding){
        const bytes=raw(key,'key',encoding);
        try{return wrap(binding.keyNew(0,0,...span(bytes)),0,0,bytes.length);}
        finally{if(typeof key==='string')bytes.fill(0);}
    }
    function encoded(input,privateOnly){
        let options;
        if(input!==null && typeof input==='object' && !ArrayBuffer.isView(input) && !isArrayBuffer(input) && !states.has(input))options=input;
        else options={key:input};
        const key=options.key;
        if(states.has(key)){
            if(privateOnly)throw invalidType('key','a string, ArrayBuffer or ArrayBufferView');
            const s=state(key);if(s.kind!==2)throw wrongType(kinds[s.kind],'private');
            return wrap(binding.keyPublic(s.handle),s.algorithm,1);
        }
        const format=options.format??'pem';let material=raw(key,'key',options.encoding),label;
        const original=material;let decoded;
        try{
        if(format==='pem'){
            const text=material.toString('utf8'),match=/^[ \t\r\n]*-----BEGIN (PRIVATE KEY|PUBLIC KEY)-----[ \t\r\n]+([A-Za-z0-9+/= \t\r\n]+)-----END \1-----[ \t\r\n]*$/.exec(text);
            if(!match)throw invalidKey();label=match[1];
            const body=match[2].replace(/[ \t\r\n]/g,'');
            if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body))throw invalidKey();
            material=decoded=Buffer.from(body,'base64');
        }else if(format==='der'){
            if(options.type!=='pkcs8' && options.type!=='spki')throw unsupported('Only PKCS8/SPKI are enabled');
            label=options.type==='pkcs8'?'PRIVATE KEY':'PUBLIC KEY';
        }else throw unsupported('Only PKCS8/SPKI DER and PEM are enabled');
        const kind=label==='PRIVATE KEY'?2:1;
        if(privateOnly && kind!==2)throw invalidKey();
        let algorithm=0;
        for(const id of [1,2]){const header=prefix(id,kind);if(material.length===header.length+32 && material.subarray(0,header.length).equals(header)){algorithm=id;break;}}
        if(!algorithm)throw invalidKey();
        const handle=binding.keyNew(algorithm,kind,...span(material.subarray(material.length-32)));
        return !privateOnly && kind===2?wrap(binding.keyPublic(handle),algorithm,1):wrap(handle,algorithm,kind);
        }finally{decoded?.fill(0);if(typeof key==='string')original.fill(0);}
    }
    function createPrivateKey(input){return encoded(input,true);}
    function createPublicKey(input){return encoded(input,false);}
    function generateKeyPairSync(type,options){
        if(typeof type!=='string')throw invalidType('type','a string');
        const algorithm=names.indexOf(type);if(algorithm<1)throw unsupported('Only ed25519 and x25519 key generation are enabled');
        if(options!==undefined && (!options || typeof options!=='object'))throw invalidType('options','an object');
        const pair=binding.keyGenerate(algorithm),publicKey=wrap(pair.publicKey,algorithm,1),privateKey=wrap(pair.privateKey,algorithm,2);
        return {publicKey:options?.publicKeyEncoding?publicKey.export(options.publicKeyEncoding):publicKey,privateKey:options?.privateKeyEncoding?privateKey.export(options.privateKeyEncoding):privateKey};
    }
    function resolve(key,privateOnly){
        const value=states.has(key)?key:states.has(key?.key)?key.key:null;
        if(value){const s=state(value);if(privateOnly){if(s.kind!==2)throw wrongType(kinds[s.kind],'private');return value;}if(s.kind===0)throw wrongType('secret','public');return s.kind===2?wrap(binding.keyPublic(s.handle),s.algorithm,1):value;}
        return privateOnly?createPrivateKey(key):createPublicKey(key);
    }
    function digest(value){
        if(value===null || value===undefined)return;
        if(typeof value!=='string')throw invalidType('algorithm','a string');
        throw codedError(Error,'ERR_OSSL_INVALID_DIGEST','Invalid digest for Ed25519');
    }
    function sign(algorithm,data,key,callback){
        digest(algorithm);const bytes=raw(data,'data'),resolved=state(resolve(key,true));
        if(resolved.algorithm!==1)throw codedError(Error,'ERR_OSSL_EVP_OPERATION_NOT_SUPPORTED_FOR_THIS_KEYTYPE','Signing requires Ed25519');
        if(callback!==undefined){if(typeof callback!=='function')throw invalidType('callback','a function');binding.async.keySign(resolved.handle,...span(bytes)).then(value=>callback(null,Buffer.from(value)),error=>callback(error));return;}
        return Buffer.from(binding.keySign(resolved.handle,...span(bytes)));
    }
    function verify(algorithm,data,key,signature,callback){
        digest(algorithm);const bytes=raw(data,'data'),resolved=state(resolve(key,false)),sig=raw(signature,'signature');
        if(resolved.algorithm!==1)throw codedError(Error,'ERR_OSSL_EVP_OPERATION_NOT_SUPPORTED_FOR_THIS_KEYTYPE','Verification requires Ed25519');
        if(callback!==undefined){if(typeof callback!=='function')throw invalidType('callback','a function');binding.async.keyVerify(resolved.handle,...span(bytes),...span(sig)).then(value=>callback(null,value),error=>callback(error));return;}
        return binding.keyVerify(resolved.handle,...span(bytes),...span(sig));
    }
    function diffieHellman(options,callback){
        if(!options || typeof options!=='object')throw invalidType('options','an object');
        const first=state(options.privateKey),second=state(options.publicKey);
        if(first.kind!==2)throw wrongType(kinds[first.kind],'private');if(second.kind!==1)throw wrongType(kinds[second.kind],'public');
        if(first.algorithm!==2 || second.algorithm!==2)throw codedError(Error,'ERR_CRYPTO_INCOMPATIBLE_KEY','Keys must be X25519');
        if(callback!==undefined){if(typeof callback!=='function')throw invalidType('callback','a function');binding.async.keyDerive(first.handle,second.handle).then(value=>callback(null,Buffer.from(value)),error=>callback(error));return;}
        return Buffer.from(binding.keyDerive(first.handle,second.handle));
    }
    function secretSpan(value){const s=state(value);if(s.kind!==0)throw wrongType(kinds[s.kind],'secret');return [s.handle,0,s.length];}
    return {api:{KeyObject,createSecretKey,createPrivateKey,createPublicKey,generateKeyPairSync,sign,verify,diffieHellman},has:value=>states.has(value),secretSpan,raw,span};
}
