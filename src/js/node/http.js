/* HTTP/1.1 clients. Framing and stream ownership stay on the JS owner thread. */
function createHTTP(native,net,streams,process,url,transport={protocol:'http:',defaultPort:80,connect:options=>net.api.connect(options),ready:'connect'}) {
    const {Writable,Readable}=streams.api,key=Symbol('http.state'),agentKey=Symbol('http.agent');
    const tick=(fn,...args)=>process.nextTick(fn,...args),error=(code,message=code)=>codedError(Error,code,message);
    const token=/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
    const unique=new Set(['age','authorization','content-length','content-type','etag','expires','from','host','if-modified-since','if-unmodified-since','last-modified','location','max-forwards','proxy-authorization','referer','retry-after','server','user-agent']);
    function validateHeaderName(name){if(typeof name!=='string'||!token.test(name))throw codedError(TypeError,'ERR_INVALID_HTTP_TOKEN','Header name must be a valid HTTP token');}
    function validateHeaderValue(name,value){if(value===undefined)throw codedError(TypeError,'ERR_HTTP_INVALID_HEADER_VALUE','Invalid value for header '+name);if(/[^\t\x20-\x7e\x80-\xff]/.test(String(value)))throw codedError(TypeError,'ERR_INVALID_CHAR','Invalid character in header content');}
    function fields(pairs,join=false){const out=Object.create(null),distinct=Object.create(null);
        for(let i=0;i<pairs.length;i+=2){const name=pairs[i].toLowerCase(),value=pairs[i+1];(distinct[name]??=[]).push(value);
            if(name==='set-cookie')(out[name]??=[]).push(value);
            else if(out[name]===undefined)out[name]=value;
            else if(join||!unique.has(name))out[name]+=(name==='cookie'?'; ':', ')+value;
        }return {out,distinct};
    }
    function rawFields(lines){const pairs=[];for(const line of lines){if(!line)continue;const index=line.indexOf(':');if(index<1||!token.test(line.slice(0,index))||/[^\t\x20-\x7e\x80-\xff]/.test(line.slice(index+1)))throw error('HPE_INVALID_HEADER_TOKEN','Invalid response header');pairs.push(line.slice(0,index),line.slice(index+1).replace(/^[ \t]+|[ \t]+$/g,''));}return pairs;}
    function endpoint(args,raw=false){
        let value=args[0],options={},callback;
        if(typeof value==='string'||value instanceof url.URL){
            const scheme=typeof value==='string'?/^([A-Za-z][A-Za-z0-9+.-]*:)/.exec(value)?.[1].toLowerCase():value.protocol;if(scheme&&scheme!==transport.protocol)throw codedError(TypeError,'ERR_INVALID_PROTOCOL','Protocol '+scheme+' not supported. Expected '+transport.protocol);
            const u=value instanceof url.URL?value:new url.URL(value);options={protocol:u.protocol,hostname:u.hostname,path:u.pathname+u.search};if(u.port)options.port=u.port;if(u.username||u.password)options.auth=decodeURIComponent(u.username)+':'+decodeURIComponent(u.password);
            if(args[1]&&typeof args[1]==='object'){Object.assign(options,args[1]);callback=args[2];}else callback=args[1];
        }
        else {if(value!==undefined&&(value===null||typeof value!=='object'))throw invalidType('options','an object');options={...(value??{})};callback=args[1];}
        if(callback!==undefined&&typeof callback!=='function')throw invalidType('callback','a function');
        const protocol=options.protocol??transport.protocol;if(protocol!==transport.protocol)throw codedError(TypeError,'ERR_INVALID_PROTOCOL','Protocol '+protocol+' not supported. Expected '+transport.protocol);
        let hostname=options.hostname??options.host??'localhost';if(typeof hostname!=='string')throw invalidType('hostname','a string');if(hostname.startsWith('[')&&hostname.endsWith(']'))hostname=hostname.slice(1,-1);
        const port=Number(options.port??transport.defaultPort);if(!Number.isInteger(port)||port<0||port>65535)throw codedError(RangeError,'ERR_SOCKET_BAD_PORT','Invalid port');
        let method=options.method??'GET';if(typeof method!=='string'||!token.test(method))throw codedError(TypeError,'ERR_INVALID_HTTP_TOKEN','Invalid HTTP method');if(!raw)method=method.toUpperCase();
        const path=options.path??'/';if(typeof path!=='string'||/[^\x21-\xff]/.test(path))throw codedError(TypeError,'ERR_UNESCAPED_CHARACTERS','Request path contains unescaped characters');
        const limit=options.maxHeaderSize??16384;integer(limit,'maxHeaderSize',16,32767);
        if(options.socketPath!==undefined||options.insecureHTTPParser||method==='CONNECT')throw error('ERR_NOT_SUPPORTED','IPC, CONNECT and insecure parsing are not enabled');
        return {options:{...options,protocol,hostname,port,method,path,maxHeaderSize:limit},callback};
    }
    function Agent(options={}){
        if(!(this instanceof Agent))return new Agent(options);if(!options||typeof options!=='object')throw invalidType('options','an object');
        this.options={...options};this.keepAlive=options.keepAlive??false;this.maxSockets=options.maxSockets??Infinity;this.maxTotalSockets=options.maxTotalSockets??32;this.maxFreeSockets=options.maxFreeSockets??16;
        for(const [name,max] of [['maxSockets',Infinity],['maxTotalSockets',32],['maxFreeSockets',32]])if(typeof this[name]!=='number'||this[name]<1||this[name]>max||this[name]!==Infinity&&!Number.isInteger(this[name]))throw outOfRange(name);
        this.sockets=Object.create(null);this.freeSockets=Object.create(null);this.requests=Object.create(null);this.protocol=transport.protocol;this.defaultPort=transport.defaultPort;
        Object.defineProperty(this,agentKey,{value:{total:0,queue:[],destroyed:false}});
    }
    Agent.prototype.getName=function(options){return (options.hostname??options.host??'localhost')+':'+(options.port??this.defaultPort)+':'+(options.localAddress??'')+':'+(options.family??'');};
    Agent.prototype.createConnection=function(options,callback){const socket=transport.connect(options);if(callback)socket.once(transport.ready,()=>callback(null,socket));return socket;};
    Agent.prototype.addRequest=function(request,options,callback){const state=this[agentKey],name=this.getName(options);
        const queued={request,options,callback,name};request[key].queued=queued;request[key].agent=this;
        if(state.destroyed){tick(callback,error('ERR_HTTP_AGENT_DESTROYED'));return;}
        if(state.queue.length>=128){tick(callback,error('EAGAIN','HTTP request queue is full'));return;}
        state.queue.push(queued);(this.requests[name]??=[]).push(request);this._dispatch();
    };
    Agent.prototype._remove=function(item){const state=this[agentKey];state.queue=state.queue.filter(q=>q!==item);const list=this.requests[item.name];if(list){const i=list.indexOf(item.request);if(i>=0)list.splice(i,1);if(!list.length)delete this.requests[item.name];}item.request[key].queued=null;};
    Agent.prototype._dispatch=function(){const state=this[agentKey];if(state.destroyed)return;
        for(const item of state.queue.slice()){
            if(item.request.destroyed){this._remove(item);continue;}
            let socket;const free=this.freeSockets[item.name];while(free?.length&&!socket){const next=free.pop();if(!next.destroyed)socket=next;}if(free&&!free.length)delete this.freeSockets[item.name];
            if(!socket&&((this.sockets[item.name]?.length??0)>=this.maxSockets||state.total>=this.maxTotalSockets))continue;
            this._remove(item);
            if(socket){socket.removeListener('data',socket._httpIdleData);socket._httpIdleData=null;socket.ref();item.request.reusedSocket=true;}
            else {
                try{const connectionOptions={...item.options,...this.options,allowHalfOpen:true};connectionOptions.host=connectionOptions.hostname;delete connectionOptions.path;delete connectionOptions.signal;socket=this.createConnection(connectionOptions);if(!socket||typeof socket.on!=='function')throw invalidType('socket','a Socket');}catch(e){tick(item.callback,e);continue;}
                const poolName=item.name;state.total++;socket.once('close',()=>{state.total--;for(const map of [this.sockets,this.freeSockets]){const a=map[poolName];if(a){const i=a.indexOf(socket);if(i>=0)a.splice(i,1);if(!a.length)delete map[poolName];}}this._dispatch();});
                socket.on('end',()=>{if(this.freeSockets[poolName]?.includes(socket))socket.destroy();});socket.on('error',()=>{if(this.freeSockets[poolName]?.includes(socket))socket.destroy();});
            }
            (this.sockets[item.name]??=[]).push(socket);item.request[key].poolName=item.name;item.callback(null,socket);
        }
    };
    Agent.prototype._release=function(request,reusable){const s=request[key],socket=request.socket,name=s.poolName;if(!socket)return;
        const active=this.sockets[name];if(active){const i=active.indexOf(socket);if(i>=0)active.splice(i,1);if(!active.length)delete this.sockets[name];}
        if(!this[agentKey].destroyed&&this.keepAlive&&reusable&&!socket.destroyed&&!socket.readableEnded&&(this.freeSockets[name]?.length??0)<this.maxFreeSockets){
            (this.freeSockets[name]??=[]).push(socket);socket._httpIdleData=()=>socket.destroy();socket.on('data',socket._httpIdleData);socket.unref();socket.setTimeout(this.options.timeout??5000,()=>socket.destroy());
        }else socket.destroy();this._dispatch();
    };
    Agent.prototype.destroy=function(){const state=this[agentKey];if(state.destroyed)return;state.destroyed=true;for(const item of state.queue.slice()){this._remove(item);tick(item.callback,error('ECONNRESET','Agent destroyed'));}for(const map of [this.sockets,this.freeSockets])for(const list of Object.values(map))for(const socket of list.slice())socket.destroy();};
    Object.defineProperty(Agent.prototype,'totalSocketCount',{get(){return this[agentKey].total;}});
    function IncomingMessage(socket,request){Readable.call(this,{autoDestroy:true});this.socket=this.connection=socket;this.req=request;this.complete=false;this.aborted=false;this.headers=Object.create(null);this.headersDistinct=Object.create(null);this.rawHeaders=[];this.trailers=Object.create(null);this.trailersDistinct=Object.create(null);this.rawTrailers=[];}
    Object.setPrototypeOf(IncomingMessage.prototype,Readable.prototype);Object.setPrototypeOf(IncomingMessage,Readable);
    IncomingMessage.prototype._read=function(){const request=this.req;if(request){request[key].blocked=false;request._pump();if(!request[key].blocked&&!this.complete&&!this.socket.destroyed)this.socket.resume();}};
    IncomingMessage.prototype._destroy=function(failure,callback){const request=this.req;if(request){const s=request[key];if(!this.complete){this.aborted=true;this.emit('aborted');}request._release(this.complete&&this.readableEnded&&!failure);if(!request.destroyed){s.normal=true;request.destroy(s.parserError);}}callback(failure);};
    IncomingMessage.prototype.setTimeout=function(ms,callback){this.socket.setTimeout(ms,callback);return this;};
    function ClientRequest(...args){if(!(this instanceof ClientRequest))return new ClientRequest(...args);const {options,callback}=endpoint(args);
        initialize(this,options,callback);
    }
    function initialize(request,options,callback){
        Object.defineProperty(request,key,{value:{options,headers:new Map(),queued:null,agent:null,construct:null,normal:false,released:false,pending:Buffer.alloc(0),phase:'headers',remaining:0,blocked:false,pumping:false,information:0,written:0,expected:null,chunked:false,headersSent:false,bodyWritten:false}});
        request.method=options.method;request.path=options.path;request.host=options.hostname;request.protocol=options.protocol;request.socket=request.connection=null;request.reusedSocket=false;request.aborted=false;request.res=null;request.maxHeadersCount=2000;
        Writable.call(request,{autoDestroy:false,highWaterMark:options.highWaterMark,signal:options.signal});
        streams.httpOutgoing(request);
        if(callback)request.once('response',callback);
        if(options.headers!==undefined){if(Array.isArray(options.headers)){if(options.headers.length%2)throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid raw headers');for(let i=0;i<options.headers.length;i+=2)request.appendHeader(options.headers[i],options.headers[i+1]);}else if(options.headers&&typeof options.headers==='object'){for(const name of Object.keys(options.headers))request.setHeader(name,options.headers[name]);}else throw invalidType('headers','an object or array');}
        if(!request.hasHeader('host')&&options.setHost!==false)request.setHeader('Host',(net.api.isIPv6(options.hostname)?'['+options.hostname+']':options.hostname)+(options.port!==transport.defaultPort?':'+options.port:''));
        if(options.auth!==undefined&&!request.hasHeader('authorization'))request.setHeader('Authorization','Basic '+Buffer.from(String(options.auth)).toString('base64'));
    }
    Object.setPrototypeOf(ClientRequest.prototype,Writable.prototype);Object.setPrototypeOf(ClientRequest,Writable);
    ClientRequest.prototype._construct=function(callback){const s=this[key];let completed=false;const done=failure=>{if(completed)return;completed=true;s.construct=null;callback(failure);};s.construct=done;
        if(this.destroyed){done();return;}
        let agent=s.options.agent===false?new Agent({keepAlive:false}):s.options.agent??api.globalAgent;
        if(!(agent instanceof Agent))return done(invalidType('agent','an admitted HTTP Agent'));
        this.agent=agent;agent.addRequest(this,s.options,(failure,socket)=>{if(this.destroyed){socket?.destroy();done();return;}if(failure){done(failure);return;}
            this.socket=this.connection=socket;socket.setTimeout(0);socket.removeAllListeners('timeout');
            s.onData=data=>{s.pending=s.pending.length?Buffer.concat([s.pending,data]):data;this._pump();};
            s.onEnd=()=>{s.ended=true;this._pump();};
            s.onError=e=>this._fail(e);s.onClose=()=>{if(!s.released&&!this.res?.complete)this._fail(error('ECONNRESET','socket hang up'));};
            socket.on('data',s.onData);socket.on('end',s.onEnd);socket.on('error',s.onError);socket.on('close',s.onClose);
            if(s.options.timeout!==undefined)this.setTimeout(s.options.timeout);this.emit('socket',socket);done();
        });
    };
    ClientRequest.prototype.destroy=function(failure){const s=this[key];if(s.queued)s.agent._remove(s.queued);const result=Writable.prototype.destroy.call(this,failure);if(s.construct)s.construct();return result;};
    ClientRequest.prototype._fail=function(failure){const parser=failure.code?.startsWith('HPE_');if(this.res&&!this.res.destroyed){if(parser)this[key].parserError=failure;this.res.aborted=true;this.res.destroy(parser?error('ECONNRESET','aborted'):failure);}if(!this.destroyed)this.destroy(this.res?undefined:failure);};
    ClientRequest.prototype._release=function(reusable){const s=this[key];if(s.released)return;s.released=true;s.pending=Buffer.alloc(0);s.trailerLines=null;const socket=this.socket;
        if(socket){socket.removeListener('data',s.onData);socket.removeListener('end',s.onEnd);socket.removeListener('error',s.onError);socket.removeListener('close',s.onClose);if(s.onTimeout)socket.removeListener('timeout',s.onTimeout);socket.setTimeout(0);s.agent._release(this,reusable&&s.keepAlive&&this.writableFinished);}
    };
    ClientRequest.prototype._destroy=function(failure,callback){const s=this[key];if(s.queued)s.agent._remove(s.queued);if(s.construct){const done=s.construct;s.construct=null;done();}
        if(!s.normal&&this.res&&!this.res.destroyed)this.res.destroy(failure??error('ECONNRESET','aborted'));this._release(false);callback(failure);
    };
    ClientRequest.prototype.setHeader=function(name,value){validateHeaderName(name);if(this[key].headersSent)throw error('ERR_HTTP_HEADERS_SENT','Cannot set headers after they are sent');if(Array.isArray(value)){if(!value.length)throw codedError(TypeError,'ERR_HTTP_INVALID_HEADER_VALUE','Empty header array');for(const v of value)validateHeaderValue(name,v);}else validateHeaderValue(name,value);this[key].headers.set(name.toLowerCase(),{name,value});return this;};
    ClientRequest.prototype.appendHeader=function(name,value){validateHeaderName(name);const old=this[key].headers.get(name.toLowerCase());return this.setHeader(old?.name??name,old?[...(Array.isArray(old.value)?old.value:[old.value]),...(Array.isArray(value)?value:[value])]:value);};
    ClientRequest.prototype.getHeader=function(name){if(typeof name!=='string')throw invalidType('name','a string');return this[key].headers.get(name.toLowerCase())?.value;};
    ClientRequest.prototype.hasHeader=function(name){if(typeof name!=='string')throw invalidType('name','a string');return this[key].headers.has(name.toLowerCase());};
    ClientRequest.prototype.getHeaderNames=function(){return [...this[key].headers.keys()];};ClientRequest.prototype.getRawHeaderNames=function(){return [...this[key].headers.values()].map(x=>x.name);};
    ClientRequest.prototype.getHeaders=function(){const out=Object.create(null);for(const [name,{value}]of this[key].headers)out[name]=value;return out;};
    ClientRequest.prototype.removeHeader=function(name){if(typeof name!=='string')throw invalidType('name','a string');if(this[key].headersSent)throw error('ERR_HTTP_HEADERS_SENT');this[key].headers.delete(name.toLowerCase());};
    ClientRequest.prototype._headers=function(hasBody){const s=this[key];if(s.headersSent)return;
        if(this.hasHeader('content-length')&&this.hasHeader('transfer-encoding'))throw error('ERR_HTTP_CONTENT_LENGTH_MISMATCH','Content-Length and Transfer-Encoding conflict');
        if(!this.hasHeader('connection'))this.setHeader('Connection',s.agent.keepAlive?'keep-alive':'close');
        if(!this.hasHeader('content-length')&&!this.hasHeader('transfer-encoding')){if(hasBody)this.setHeader('Transfer-Encoding','chunked');else if(['POST','PUT','PATCH'].includes(this.method))this.setHeader('Content-Length',0);}
        const method=String(this.method),path=String(this.path);if(!token.test(method))throw codedError(TypeError,'ERR_INVALID_HTTP_TOKEN','Invalid HTTP method');if(/[^\x21-\xff]/.test(path))throw codedError(TypeError,'ERR_UNESCAPED_CHARACTERS','Invalid HTTP path');
        // Snapshot arrays before coercing values. Use the very same serialized
        // framing fields for accounting and the wire, including mutable values.
        const snapshot=[...s.headers.entries()].map(([key,{name,value}])=>({key,name,values:Array.isArray(value)?value.slice():[value]}));
        for(const h of snapshot)h.values=h.values.map(v=>{const text=String(v);validateHeaderValue(h.name,text);return text;});
        const cl=snapshot.find(h=>h.key==='content-length'),te=snapshot.find(h=>h.key==='transfer-encoding');if(cl&&te)throw error('ERR_HTTP_CONTENT_LENGTH_MISMATCH');
        if(cl){if(cl.values.length!==1||!/^\d+$/.test(cl.values[0])||!Number.isSafeInteger(Number(cl.values[0])))throw error('ERR_HTTP_CONTENT_LENGTH_MISMATCH','Invalid Content-Length');s.expected=Number(cl.values[0]);}
        if(te){if(te.values.length!==1||te.values[0].toLowerCase()!=='chunked')throw error('ERR_NOT_SUPPORTED','Only chunked request transfer coding is enabled');s.chunked=true;}
        s.sentConnection=snapshot.find(h=>h.key==='connection')?.values.join(', ')??'';
        let head=method+' '+path+' HTTP/1.1\r\n';for(const {key,name,values}of snapshot){if(key==='cookie')head+=name+': '+values.join('; ')+'\r\n';else for(const v of values)head+=name+': '+v+'\r\n';}
        s.headersSent=true;this.socket.write(head+'\r\n','latin1');
    };
    ClientRequest.prototype.flushHeaders=function(){const s=this[key];if(this.socket)this._headers(true);else this.once('socket',()=>{try{this._headers(true);}catch(e){this.destroy(e);}});};
    ClientRequest.prototype._write=function(data,encoding,callback){const s=this[key];try{this._headers(true);if(!data.length){callback();return;}s.bodyWritten=true;s.written+=data.length;if(s.expected!==null&&s.written>s.expected)throw error('ERR_HTTP_CONTENT_LENGTH_MISMATCH');const wire=s.chunked?Buffer.concat([Buffer.from(data.length.toString(16)+'\r\n'),data,Buffer.from('\r\n')]):data;this.socket.write(wire,callback);}catch(e){callback(e);}};
    ClientRequest.prototype._final=function(callback){const s=this[key];try{this._headers(false);if(s.expected!==null&&s.written!==s.expected)throw error('ERR_HTTP_CONTENT_LENGTH_MISMATCH');if(s.chunked)this.socket.write('0\r\n\r\n',callback);else callback();}catch(e){callback(e);}};
    ClientRequest.prototype.end=function(data,encoding,callback){const s=this[key];if(data!==undefined&&data!==null&&typeof data!=='function'&&!s.headersSent&&!s.bodyWritten&&!this.writableLength&&!this.hasHeader('content-length')&&!this.hasHeader('transfer-encoding'))this.setHeader('Content-Length',typeof data==='string'?Buffer.byteLength(data,typeof encoding==='string'?encoding:undefined):data.byteLength);return Writable.prototype.end.call(this,data,encoding,callback);};
    ClientRequest.prototype.abort=function(){if(this.aborted)return;this.aborted=true;tick(()=>this.emit('abort'));this.destroy();};
    ClientRequest.prototype.setTimeout=function(ms,callback){if(callback)this.once('timeout',callback);const s=this[key];s.onTimeout??=()=>this.emit('timeout');if(this.socket){this.socket.removeListener('timeout',s.onTimeout);this.socket.setTimeout(ms,s.onTimeout);}else this.once('socket',socket=>{socket.removeListener('timeout',s.onTimeout);socket.setTimeout(ms,s.onTimeout);});return this;};
    ClientRequest.prototype.setNoDelay=function(value=true){if(this.socket)this.socket.setNoDelay(value);else this.once('socket',s=>s.setNoDelay(value));};
    ClientRequest.prototype.setSocketKeepAlive=function(value=false,delay=0){if(this.socket)this.socket.setKeepAlive(value,delay);else this.once('socket',s=>s.setKeepAlive(value,delay));};
    Object.defineProperties(ClientRequest.prototype,{headersSent:{get(){return this[key].headersSent;}},finished:{get(){return this.writableEnded;}}});
    ClientRequest.prototype._complete=function(){const s=this[key];if(!this.res||this.res.complete)return;this.res.complete=true;s.phase='done';if(s.pending.length){s.keepAlive=false;this.socket.pause();}this.res.push(null);};
    ClientRequest.prototype._pump=function(){const s=this[key];if(s.pumping||s.blocked||this.destroyed)return;s.pumping=true;
        try{for(;;){if(s.blocked||this.destroyed)break;let p=s.pending;
            if(s.phase==='headers'){
                const parsed=native.http.parse(p.buffer,p.byteOffset,p.byteLength,s.options.maxHeaderSize);if(parsed===null)break;
                const text=p.subarray(0,parsed.length).toString('latin1');if(!text.endsWith('\r\n\r\n')||/[^\r]\n|\r[^\n]/.test(text))throw error('HPE_INVALID_HEADER_TOKEN','HTTP requires CRLF');
                const lines=text.slice(0,-4).split('\r\n'),statusLine=lines.shift(),match=/^HTTP\/(1)\.(0|1) ([0-9]{3})(?: (.*))?$/.exec(statusLine);if(!match)throw error('HPE_INVALID_CONSTANT','Invalid HTTP status line');
                const raw=rawFields(lines);if(raw.length/2>this.maxHeadersCount)throw error('HPE_HEADER_OVERFLOW');const headers=fields(raw,!!s.options.joinDuplicateHeaders);s.pending=p.subarray(parsed.length);
                if(parsed.status<200&&parsed.status!==101){if(++s.information>16)throw error('HPE_INVALID_STATUS');if(parsed.status===100)this.emit('continue');this.emit('information',{statusCode:parsed.status,statusMessage:match[4]??'',httpVersion:match[1]+'.'+match[2],httpVersionMajor:1,httpVersionMinor:Number(match[2]),headers:headers.out,rawHeaders:raw});continue;}
                if(parsed.status===101)throw error('ERR_NOT_SUPPORTED','HTTP protocol upgrades are not enabled');
                const cl=headers.distinct['content-length'],te=headers.out['transfer-encoding'];if(cl&&(cl.length!==1||!/^\d+$/.test(cl[0])||!Number.isSafeInteger(Number(cl[0]))))throw error('HPE_UNEXPECTED_CONTENT_LENGTH');if(cl&&te)throw error('HPE_UNEXPECTED_CONTENT_LENGTH');
                const tokens=te?te.toLowerCase().split(',').map(x=>x.trim()):null;if(tokens&&(tokens.filter(x=>x==='chunked').length>1||tokens.includes('chunked')&&tokens.at(-1)!=='chunked'))throw error('HPE_INVALID_TRANSFER_ENCODING');
                const res=this.res=new IncomingMessage(this.socket,this);Object.assign(res,{statusCode:parsed.status,statusMessage:match[4]??'',httpVersion:match[1]+'.'+match[2],httpVersionMajor:1,httpVersionMinor:Number(match[2]),headers:headers.out,headersDistinct:headers.distinct,rawHeaders:raw});
                s.keepAlive=this.agent.keepAlive&&!/\bclose\b/i.test(headers.out.connection??'')&&!/\bclose\b/i.test(s.sentConnection??'')&&(parsed.version===11||/\bkeep-alive\b/i.test(headers.out.connection??''));
                if(this.method==='HEAD'||[204,304].includes(parsed.status)){s.phase='none';}
                else if(te){s.phase=tokens.at(-1)==='chunked'?'chunk-size':'close';}
                else if(cl){s.remaining=Number(cl[0]);s.phase='length';}else s.phase='close';if(s.phase==='close')s.keepAlive=false;
                const observed=this.listenerCount('response')>0;this.emit('response',res);if(!observed)res.resume();continue;
            }
            if(s.phase==='none'||s.phase==='length'&&!s.remaining){this._complete();break;}
            if(s.phase==='done')break;
            if(s.phase==='chunk-size'){
                const end=p.indexOf('\r\n');if(end<0){if(p.length>16384)throw error('HPE_INVALID_CHUNK_SIZE');break;}
                if(end>16384)throw error('HPE_INVALID_CHUNK_SIZE');const line=p.subarray(0,end).toString('latin1');if(!/^[0-9a-f]+(?:;[^\x00-\x08\x0a-\x1f\x7f]*)?$/i.test(line))throw error('HPE_INVALID_CHUNK_SIZE');const number=BigInt('0x'+line.split(';',1)[0]);if(number>BigInt(Number.MAX_SAFE_INTEGER))throw error('HPE_INVALID_CHUNK_SIZE');s.remaining=Number(number);s.pending=p.subarray(end+2);s.phase=s.remaining?'chunk':'trailers';s.trailerLines=[];s.trailerBytes=0;continue;
            }
            if(s.phase==='chunk-crlf'){if(p.length<2)break;if(p[0]!==13||p[1]!==10)throw error('HPE_INVALID_CHUNK_SIZE');s.pending=p.subarray(2);s.phase='chunk-size';continue;}
            if(s.phase==='trailers'){
                const end=p.indexOf('\r\n');if(end<0){if(p.length+s.trailerBytes>16384)throw error('HPE_HEADER_OVERFLOW');break;}
                s.trailerBytes+=end+2;if(s.trailerBytes>16384)throw error('HPE_HEADER_OVERFLOW');s.pending=p.subarray(end+2);
                if(!end){const raw=this.res.rawTrailers=rawFields(s.trailerLines),values=fields(raw,!!s.options.joinDuplicateHeaders);this.res.trailers=values.out;this.res.trailersDistinct=values.distinct;this._complete();break;}
                s.trailerLines.push(p.subarray(0,end).toString('latin1'));continue;
            }
            if(!p.length)break;const count=s.phase==='close'?p.length:Math.min(p.length,s.remaining),data=p.subarray(0,count);s.pending=p.subarray(count);if(s.phase!=='close')s.remaining-=count;
            if(!this.res.push(data)){s.blocked=true;this.socket.pause();}if(s.phase==='chunk'&&!s.remaining)s.phase='chunk-crlf';
        }}catch(e){this._fail(e);}finally{s.pumping=false;}
        if(s.ended&&!s.blocked&&!this.destroyed&&!this.res?.complete){if(s.phase==='close'&&!s.pending.length)this._complete();else this._fail(error('ECONNRESET','aborted'));}
    };
    function request(...args){return new ClientRequest(...args);}function get(...args){const req=request(...args);req.end();return req;}
    const api={request,get,ClientRequest,IncomingMessage,Agent,globalAgent:new Agent(),maxHeaderSize:16384,validateHeaderName,validateHeaderValue};
    return {api,requestRaw(options,callback){const normalized=endpoint([options,callback],true),req=Object.create(ClientRequest.prototype);initialize(req,normalized.options,normalized.callback);return req;}};
}
