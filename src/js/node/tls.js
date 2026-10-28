function createTLS(net,dns,url) {
    const states=Symbol('tls.socket'),unsupported=name=>{throw codedError(Error,'ERR_NOT_SUPPORTED','TLS option '+name+' is not enabled');};
    function settings(options){
        if(!options||typeof options!=='object')throw invalidType('options','an object');
        for(const name of ['socket','secureContext','key','cert','pfx','pskCallback','session','checkServerIdentity','ALPNProtocols','ciphers','sigalgs','ecdhCurve','secureOptions','secureProtocol','crl','allowPartialTrustChain','requestOCSP','clientCertEngine','privateKeyEngine','privateKeyIdentifier'])if(options[name]!==undefined)unsupported(name);
        if(options.isServer)unsupported('isServer');
        if(options.rejectUnauthorized===false)unsupported('rejectUnauthorized=false');
        for(const name of ['minVersion','maxVersion'])if(options[name]!==undefined&&options[name]!=='TLSv1.2')unsupported(name);
        let host=options.host??'localhost',sni=options.servername??null;
        if(typeof host!=='string')throw invalidType('host','a string');
        if(sni!==null&&typeof sni!=='string')throw invalidType('servername','a string');
        if(sni){if(dns.isIP(sni))throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','servername must be a DNS name');sni=url.domainToASCII(sni);if(!sni)throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid servername');}
        let identity=sni||host;if(!dns.isIP(identity))identity=url.domainToASCII(identity);
        if(!identity||identity.length>253||identity.includes('\0'))throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid TLS identity');
        if(sni==='')sni=null;
        let ca=null;if(options.ca!==undefined){const values=Array.isArray(options.ca)?options.ca:[options.ca];ca=values.map(value=>{if(typeof value==='string')return value;if(value instanceof Uint8Array)return Buffer.from(value.buffer,value.byteOffset,value.byteLength).toString('utf8');throw invalidType('ca','a string, Buffer, or array');}).join('\n');if(!ca||ca.length>4*1024*1024||ca.includes('\0'))throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid TLS CA');}
        return [identity,sni,ca];
    }
    function TLSSocket(socket,options={}){
        if(!(this instanceof TLSSocket))return new TLSSocket(socket,options);
        if(socket!==undefined&&socket!==null)unsupported('socket');
        const config=settings(options);net.api.Socket.call(this,options);
        Object.defineProperty(this,states,{value:{secure:false,cipher:null,options:{...options}}});
        this.encrypted=true;this.authorized=false;this.authorizationError=null;this.alpnProtocol=false;this.servername=options.servername;
        this[states].onSecure=cipher=>{const s=this[states];s.secure=true;s.cipher=cipher;this.authorized=true;this.emit('secureConnect');};
        net.attachTLS(this,config,this[states].onSecure);
    }
    Object.setPrototypeOf(TLSSocket.prototype,net.api.Socket.prototype);Object.setPrototypeOf(TLSSocket,net.api.Socket);
    TLSSocket.prototype.connect=function(...args){
        let options,callback;if(args[0]&&typeof args[0]==='object'){options={...args[0]};callback=args[1];}
        else {options={port:args[0]};if(typeof args[1]==='string'){options.host=args[1];callback=args[2];}else callback=args[1];}
        const s=this[states];if(s.started)unsupported('repeated connect');
        options={...s.options,...options};net.attachTLS(this,settings(options),s.onSecure);this.servername=options.servername;
        const result=net.api.Socket.prototype.connect.call(this,options,callback);s.started=true;return result;
    };
    TLSSocket.prototype.destroy=function(failure){if(failure&&/^(CERT_|UNABLE_TO_|ERR_TLS_CERT_)/.test(failure.code??''))this.authorizationError=failure.code;return net.api.Socket.prototype.destroy.call(this,failure);};
    TLSSocket.prototype.getProtocol=function(){return !this.destroyed&&this[states].secure?'TLSv1.2':null;};
    TLSSocket.prototype.getCipher=function(){if(this.destroyed)return null;const name=this[states].cipher;if(!name)return undefined;const match=/^ECDHE-(RSA|ECDSA)-AES(128|256)-GCM-SHA(256|384)$/.exec(name);return {name,standardName:match?'TLS_ECDHE_'+match[1]+'_WITH_AES_'+match[2]+'_GCM_SHA'+match[3]:name,version:'TLSv1.2'};};
    TLSSocket.prototype.isSessionReused=function(){return false;};
    function connect(...args){let options,callback;
        if(args[0]&&typeof args[0]==='object'){options={...args[0]};callback=args[1];}
        else {options={port:args[0]};let i=1;if(typeof args[i]==='string')options.host=args[i++];if(args[i]&&typeof args[i]==='object')Object.assign(options,args[i++]);callback=args[i];}
        if(callback!==undefined&&typeof callback!=='function')throw invalidType('callback','a function');
        const socket=new TLSSocket(undefined,options);if(callback)socket.once('secureConnect',callback);return socket.connect(options);
    }
    return {connect,TLSSocket};
}
