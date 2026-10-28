function createNet(native,dns,process,streams) {
    const binding=native.net,{Duplex,addAbortSignal}=streams.api,key=Symbol('net.socket');
    let defaultAuto=true,defaultAttemptTimeout=250;
    const state=socket=>{const s=socket?.[key];if(!s)throw invalidType('this','a Socket');return s;};
    const error=(code,message=code)=>codedError(Error,code,message);
    function port(value,name='Port'){
        if(typeof value!=='number' && typeof value!=='string' || typeof value==='string'&&!value.trim())throw codedError(RangeError,'ERR_SOCKET_BAD_PORT',name+' should be a valid port');
        const number=Number(value);if(!Number.isInteger(number)||number<0||number>65535)throw codedError(RangeError,'ERR_SOCKET_BAD_PORT',name+' should be >= 0 and < 65536');return number;
    }
    function systemError(code,syscall,address,port){
        const detail=binding.error(code),e=Object.assign(new Error(syscall+' '+detail.code+(address?' '+address+':'+port:'')),detail,{syscall});
        if(address){e.address=address;e.port=port;}return e;
    }
    function armTimeout(socket){
        const s=state(socket);if(s.timer)clearTimeout(s.timer);s.timer=null;
        if(s.timeout && !socket.destroyed){s.timer=setTimeout(()=>{s.timer=null;socket.emit('timeout');},s.timeout);s.timer.unref();}
    }
    function writeNext(socket){
        const s=state(socket),write=s.write;if(!write||!s.connected||!s.handle||write.sent)return;
        if(write.offset===write.data.length){s.write=null;s.written+=write.data.length;write.callback();return;}
        write.last=Math.min(65536,write.data.length-write.offset);write.sent=true;
        const code=binding.write(s.handle,write.data.buffer,write.data.byteOffset+write.offset,write.last);
        if(code){s.write=null;write.callback(systemError(code,'write'));}
    }
    function closeAttempt(s){if(s.attemptTimer)clearTimeout(s.attemptTimer);s.attemptTimer=null;const pending=s.handle?binding.close(s.handle):0;s.handle=null;s.connected=false;return pending;}
    function failedAttempt(socket,failure){
        const s=state(socket);closeAttempt(s);s.errors.push(failure);
        if(s.auto && s.addresses.length){socket.emit('connectionAttemptFailed',failure.address,s.port,s.currentFamily,failure);attempt(socket);return;}
        if(s.errors.length>1){const e=new AggregateError(s.errors,'');e.code=s.errors[0].code;socket.destroy(e);}else socket.destroy(failure);
    }
    function onEvent(socket,generation,type,data,code,operation){
        const s=state(socket);if(type===7){if(s.close&&generation===s.closingGeneration){const done=s.close;s.close=null;done();}return;}if(socket.destroyed||generation!==s.generation)return;
        if(type===0){
            if(s.attemptTimer)clearTimeout(s.attemptTimer);s.attemptTimer=null;s.connecting=false;s.connected=true;Object.assign(s,data);armTimeout(socket);
            if(s.noDelay!==undefined)socket.setNoDelay(s.noDelay);if(s.keepAlive!==undefined)socket.setKeepAlive(s.keepAlive,s.keepAliveDelay*1000);
            if(socket.destroyed)return;
            socket.emit('connect');socket.emit('ready');
            if(s.tls){s.connected=false;return;}
            if(s.construct){const done=s.construct;s.construct=null;done();}writeNext(socket);if(s.wantRead&&s.handle)binding.read(s.handle);
        }else if(type===1){s.read+=data.byteLength;armTimeout(socket);socket.push(Buffer.from(data));}
        else if(type===2)socket.push(null);
        else if(type===3){if(s.write){s.write.offset+=s.write.last;s.write.sent=false;armTimeout(socket);writeNext(socket);}}
        else if(type===4){if(s.final){const done=s.final;s.final=null;done();}}
        else if(type===5){const failure=typeof data==='string'?error(data,'TLS handshake or record validation failed'):systemError(code,['connect','read','write'][operation]??'read',operation===0?s.currentAddress:undefined,s.port);if(s.connecting)failedAttempt(socket,failure);else socket.destroy(failure);}
        else if(type===6){s.connected=true;s.tls.ready=true;s.tls.secure(data);if(socket.destroyed)return;if(s.construct){const done=s.construct;s.construct=null;done();}writeNext(socket);if(s.wantRead&&s.handle)binding.read(s.handle);}
    }
    function attempt(socket){
        const s=state(socket);if(socket.destroyed)return;
        const next=s.addresses.shift();s.currentAddress=next.address;s.currentFamily=next.family;s.generation++;
        socket.autoSelectFamilyAttemptedAddresses.push(next.address+':'+s.port);
        socket.emit('connectionAttempt',next.address,s.port,next.family);
        const generation=s.generation;
        let result;try{result=binding.start(next.address,s.port,next.family,s.bindAddress??null,s.bindPort??0,(...args)=>onEvent(socket,generation,...args),s.tls?.settings);}
        catch(e){socket.destroy(e);return;}
        if(result.error){process.nextTick(()=>failedAttempt(socket,systemError(result.error,'connect',next.address,s.port)));return;}
        s.handle=result.handle;if(!s.referenced)binding.ref(s.handle,0);
        if(s.auto&&s.addresses.length){s.attemptTimer=setTimeout(()=>{s.attemptTimer=null;socket.emit('connectionAttemptTimeout',next.address,s.port,next.family);failedAttempt(socket,Object.assign(error('ETIMEDOUT','connect ETIMEDOUT'),{address:next.address,port:s.port,syscall:'connect'}));},s.attemptTimeout);s.attemptTimer.unref();}
    }
    function Socket(options={}){
        if(!(this instanceof Socket))return new Socket(options);
        if(!options||typeof options!=='object')throw invalidType('options','an object');
        if(options.fd!==undefined)throw error('ERR_NOT_SUPPORTED','Adopting an external socket fd is not enabled');
        Object.defineProperty(this,key,{value:{handle:null,connecting:false,connected:false,referenced:true,generation:0,read:0,written:0,write:null,final:null,construct:null,wantRead:false,timer:null,timeout:undefined,attemptTimer:null,signal:options.signal}});
        Duplex.call(this,{...options,allowHalfOpen:options.allowHalfOpen??false,autoDestroy:true});
        this.autoSelectFamilyAttemptedAddresses=[];
        if(options.timeout!==undefined)this.setTimeout(options.timeout);
        if(options.noDelay!==undefined)this.setNoDelay(options.noDelay);
        if(options.keepAlive!==undefined)this.setKeepAlive(options.keepAlive,options.keepAliveInitialDelay);
    }
    Object.setPrototypeOf(Socket.prototype,Duplex.prototype);Object.setPrototypeOf(Socket,Duplex);
    Socket.prototype._construct=function(callback){const s=state(this);if(this.destroyed||!s.connecting&&!(s.tls&&!s.tls.ready&&s.handle))callback();else s.construct=callback;};
    Socket.prototype._read=function(){const s=state(this);s.wantRead=true;if(s.handle)binding.read(s.handle);};
    Socket.prototype._write=function(data,encoding,callback){const s=state(this);if(!s.connected&&!s.connecting&&!(s.tls&&!s.tls.ready&&s.handle)){callback(error('ERR_SOCKET_CLOSED','Socket is closed'));return;}s.write={data:Buffer.from(data.buffer,data.byteOffset,data.byteLength),offset:0,last:0,sent:false,callback};armTimeout(this);writeNext(this);};
    Socket.prototype._final=function(callback){const s=state(this);if(!s.handle){callback();return;}s.final=callback;const code=binding.end(s.handle);if(code){s.final=null;callback(systemError(code,'shutdown'));}};
    Socket.prototype._destroy=function(failure,callback){const s=state(this);s.connecting=false;s.closingGeneration=s.generation;s.generation++;const pending=closeAttempt(s);if(s.timer)clearTimeout(s.timer);s.timer=null;s.write=null;s.final=null;s.addresses=[];for(const name of ['localAddress','localPort','localFamily','remoteAddress','remotePort','remoteFamily'])delete s[name];if(pending)s.close=()=>callback(failure);else callback(failure);};
    Socket.prototype.destroy=function(failure){const s=state(this),value=Duplex.prototype.destroy.call(this,failure);if(s.construct){const done=s.construct;s.construct=null;done();}return value;};
    Socket.prototype.connect=function(...args){
        const s=state(this);if(s.connecting)throw error('ERR_SOCKET_CONNECTING');if(this.destroyed)throw error('ERR_SOCKET_CLOSED','Create a new Socket after close');
        let options,callback;if(args[0]&&typeof args[0]==='object'){options={...args[0]};callback=args[1];}
        else {options={port:args[0]};if(typeof args[1]==='string'){options.host=args[1];callback=args[2];}else callback=args[1];}
        if(options.path!==undefined)throw error('ERR_NOT_SUPPORTED','IPC sockets are not enabled');
        s.port=port(options.port);const host=options.host??'localhost';if(typeof host!=='string')throw invalidType('host','a string');
        if(host.includes('\0'))throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid host');
        s.bindAddress=options.localAddress;if(s.bindAddress!==undefined && !dns.isIP(s.bindAddress))throw error('ERR_INVALID_IP_ADDRESS','Invalid localAddress');
        s.bindPort=options.localPort===undefined?0:port(options.localPort,'localPort');
        if(callback!==undefined){if(typeof callback!=='function')throw invalidType('connectListener','a function');this.once('connect',callback);}
        if(options.signal!==undefined&&options.signal!==s.signal){addAbortSignal(options.signal,this);s.signal=options.signal;}
        if(options.timeout!==undefined)this.setTimeout(options.timeout);
        s.auto=options.autoSelectFamily??defaultAuto;if(typeof s.auto!=='boolean')throw invalidType('autoSelectFamily','a boolean');
        s.attemptTimeout=options.autoSelectFamilyAttemptTimeout??defaultAttemptTimeout;integer(s.attemptTimeout,'autoSelectFamilyAttemptTimeout',1,0x7fffffff);s.attemptTimeout=Math.max(10,s.attemptTimeout);
        const family=options.family??0;if(![0,4,6].includes(family))throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid family');
        streams.socketClose(this);s.errors=[];s.connecting=true;s.connected=false;armTimeout(this);const generation=++s.generation;
        const accept=(failure,addresses,addressFamily)=>{
            if(this.destroyed||generation!==s.generation)return;
            if(failure){this.emit('lookup',failure,undefined,undefined,host);this.destroy(failure);return;}
            if(!Array.isArray(addresses))addresses=[{address:addresses,family:addressFamily}];
            try{for(const a of addresses){if(typeof a.address!=='string'||!dns.isIP(a.address))throw error('ERR_INVALID_IP_ADDRESS','Invalid IP address');if(a.family!==4&&a.family!==6)throw codedError(TypeError,'ERR_INVALID_ADDRESS_FAMILY','Invalid address family');if(a.address.includes('%'))throw error('ERR_NOT_SUPPORTED','Scoped IPv6 sockets are not enabled');}}
            catch(e){this.destroy(e);return;}
            if(!addresses.length){this.destroy(error('ENOTFOUND','No addresses'));return;}
            if(!dns.isIP(host))for(const a of addresses)this.emit('lookup',null,a.address,a.family,host);
            s.addresses=s.auto?addresses.slice():addresses.slice(0,1);attempt(this);
        };
        if(dns.isIP(host))process.nextTick(accept,null,host,dns.isIP(host));
        else {
            const lookup=options.lookup??dns.api.lookup;if(typeof lookup!=='function')throw invalidType('lookup','a function');
            try{lookup(host,{family,hints:options.hints??0,all:s.auto},accept);}catch(e){this.destroy(e);}
        }
        return this;
    };
    Socket.prototype.setTimeout=function(value,callback){if(typeof value!=='number')throw invalidType('timeout','a number');if(!Number.isFinite(value)||value<0)throw outOfRange('timeout');const s=state(this);s.timeout=value;if(callback!==undefined){if(typeof callback!=='function')throw invalidType('callback','a function');this.once('timeout',callback);}armTimeout(this);return this;};
    Socket.prototype.setNoDelay=function(value=true){const s=state(this);s.noDelay=!!value;if(s.handle){const code=binding.noDelay(s.handle,+s.noDelay);if(code)this.destroy(systemError(code,'setsockopt'));}return this;};
    Socket.prototype.setKeepAlive=function(value=false,delay=0){const s=state(this);s.keepAliveDelay=Math.max(0,~~(Number(delay)/1000));s.keepAlive=!!value;if(s.handle){const code=binding.keepAlive(s.handle,+s.keepAlive,s.keepAliveDelay);if(code)this.destroy(systemError(code,'setsockopt'));}return this;};
    Socket.prototype.ref=function(){const s=state(this);s.referenced=true;if(s.handle)binding.ref(s.handle,1);return this;};
    Socket.prototype.unref=function(){const s=state(this);s.referenced=false;if(s.handle)binding.ref(s.handle,0);return this;};
    Socket.prototype.address=function(){const s=state(this);return s.localAddress===undefined?{}:{address:s.localAddress,family:s.localFamily,port:s.localPort};};
    Socket.prototype.destroySoon=function(){if(this.writableFinished)this.destroy();else {this.once('finish',()=>this.destroy());this.end();}return this;};
    Object.defineProperties(Socket.prototype,{
        connecting:{get(){return state(this).connecting;}},pending:{get(){return !state(this).handle||state(this).connecting;}},
        bytesRead:{get(){return state(this).read;}},bytesWritten:{get(){return state(this).written+this.writableLength;}},bufferSize:{get(){return this.writableLength;}},
        timeout:{get(){return state(this).timeout;}},readyState:{get(){return this.destroyed?'closed':state(this).connecting?'opening':this.readable?this.writable?'open':'readOnly':this.writable?'writeOnly':'closed';}},
        localAddress:{get(){return state(this).localAddress;}},localPort:{get(){return state(this).localPort;}},localFamily:{get(){return state(this).localFamily;}},
        remoteAddress:{get(){return state(this).remoteAddress;}},remotePort:{get(){return state(this).remotePort;}},remoteFamily:{get(){return state(this).remoteFamily;}}
    });
    function createConnection(...args){return new Socket(args[0]&&typeof args[0]==='object'?args[0]:{}).connect(...args);}
    const api={Socket,createConnection,connect:createConnection,isIP:dns.isIP,isIPv4:value=>dns.isIP(value)===4,isIPv6:value=>dns.isIP(value)===6,
        getDefaultAutoSelectFamily:()=>defaultAuto,setDefaultAutoSelectFamily(value){if(typeof value!=='boolean')throw invalidType('value','a boolean');defaultAuto=value;},
        getDefaultAutoSelectFamilyAttemptTimeout:()=>defaultAttemptTimeout,setDefaultAutoSelectFamilyAttemptTimeout(value){integer(value,'value',1,0x7fffffff);defaultAttemptTimeout=Math.max(10,value);}};
    return {api,attachTLS(socket,settings,secure){streams.socketClose(socket);state(socket).tls={settings,secure,ready:false};}};
}
