function createFetch(transports,web,url,compression,streams) {
    const headerKey=Symbol('fetch.headers'),bodyKey=Symbol('fetch.body'),requestKey=Symbol('fetch.request'),responseKey=Symbol('fetch.response');
    const {ReadableStream}=web.api,limit=32*1024*1024,token=/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
    const typeError=message=>new TypeError(message),fetchError=cause=>{const e=new TypeError('fetch failed');e.cause=cause;return e;};
    function byteString(value){if(typeof value==='symbol')throw typeError('Cannot convert a Symbol to a ByteString');const text=String(value);for(let i=0;i<text.length;i++)if(text.charCodeAt(i)>255)throw typeError('Value is not a ByteString');return text;}
    function name(value){const text=byteString(value).toLowerCase();if(!token.test(text))throw typeError('Invalid header name');return text;}
    function value(input){const text=byteString(input);if(/[^\t\x20-\x7e\x80-\xff]/.test(text))throw typeError('Invalid header value');return text.replace(/^[ \t]+|[ \t]+$/g,'');}
    function headersState(headers){const s=headers?.[headerKey];if(!s)throw typeError('Invalid Headers receiver');return s;}
    class Headers {
        constructor(init=undefined){Object.defineProperty(this,headerKey,{value:{list:[],immutable:false}});if(init===undefined)return;
            if(init===null||typeof init!=='object')throw typeError('Invalid Headers initializer');
            if(typeof init[Symbol.iterator]==='function'){for(const pair of init){if(pair===null||typeof pair!=='object'||typeof pair[Symbol.iterator]!=='function')throw typeError('Invalid header pair');const p=[...pair];if(p.length!==2)throw typeError('Invalid header pair');this.append(p[0],p[1]);}}
            else for(const key of Object.keys(init))this.append(key,init[key]);
        }
        append(key,input){const s=headersState(this);if(s.immutable)throw typeError('immutable');s.list.push([name(key),value(input)]);}
        set(key,input){const s=headersState(this);if(s.immutable)throw typeError('immutable');key=name(key);input=value(input);const index=s.list.findIndex(p=>p[0]===key);s.list=s.list.filter(p=>p[0]!==key);s.list.splice(index<0?s.list.length:index,0,[key,input]);}
        delete(key){const s=headersState(this);if(s.immutable)throw typeError('immutable');key=name(key);s.list=s.list.filter(p=>p[0]!==key);}
        get(key){key=name(key);const values=headersState(this).list.filter(p=>p[0]===key).map(p=>p[1]);return values.length?values.join(', '):null;}
        has(key){key=name(key);return headersState(this).list.some(p=>p[0]===key);}
        getSetCookie(){return headersState(this).list.filter(p=>p[0]==='set-cookie').map(p=>p[1]);}
        *entries(){let index=0;for(;;){const s=headersState(this),names=[...new Set(s.list.map(p=>p[0]))].sort(),pairs=[];for(const key of names){if(key==='set-cookie')for(const v of this.getSetCookie())pairs.push([key,v]);else pairs.push([key,this.get(key)]);}if(index>=pairs.length)return;yield pairs[index++];}}
        *keys(){for(const [key]of this)yield key;}*values(){for(const [,v]of this)yield v;}
        forEach(callback,self=undefined){if(typeof callback!=='function')throw typeError('Callback must be a function');for(const [key,v]of this)callback.call(self,v,key,this);}
        [Symbol.iterator](){return this.entries();}
    }
    Object.defineProperty(Headers.prototype,Symbol.toStringTag,{value:'Headers'});
    function extract(input){
        if(input===undefined||input===null)return {stream:null,bytes:null,type:null,streaming:false};
        if(input instanceof ReadableStream){if(input.locked||web.disturbed(input))throw typeError('Body is unusable');return {stream:input,bytes:null,type:null,streaming:true};}
        if(input&&typeof input[Symbol.asyncIterator]==='function'){
            const iterator=input[Symbol.asyncIterator]();return {stream:new ReadableStream({async pull(c){const item=await iterator.next();if(item.done)c.close();else if(typeof item.value==='string')c.enqueue(new Uint8Array(Buffer.from(item.value)));else if(item.value instanceof Uint8Array)c.enqueue(new Uint8Array(item.value));else c.error(typeError('Stream body must contain bytes'));},cancel:reason=>iterator.return?.(reason)},{highWaterMark:0}),bytes:null,type:null,streaming:true};
        }
        let bytes,type=null;if(input instanceof ArrayBuffer)bytes=new Uint8Array(input.slice(0));
        else if(ArrayBuffer.isView(input))bytes=new Uint8Array(new Uint8Array(input.buffer,input.byteOffset,input.byteLength));
        else {if(typeof input==='symbol')throw typeError('Invalid body');if(input instanceof url.URLSearchParams)type='application/x-www-form-urlencoded;charset=UTF-8';else type='text/plain;charset=UTF-8';bytes=new Uint8Array(Buffer.from(String(input)));}
        const stream=new ReadableStream({start(c){c.enqueue(bytes);c.close();}});return {stream,bytes,type,streaming:false};
    }
    function bodyState(object){const s=object?.[bodyKey];if(!s)throw typeError('Invalid body receiver');return s;}
    function attachBody(object,body){Object.defineProperty(object,bodyKey,{value:body});}
    async function consume(object){const s=bodyState(object);if(s.stream===null)return new Uint8Array();if(s.stream.locked||web.disturbed(s.stream))throw typeError('Body is unusable: Body has already been read');
        const reader=s.stream.getReader(),chunks=[];let count=0;try{for(;;){const item=await reader.read();if(item.done)break;if(!(item.value instanceof Uint8Array))throw typeError('Body stream contains a non-byte chunk');count+=item.value.byteLength;if(count>limit){await reader.cancel();throw codedError(RangeError,'ERR_BODY_TOO_LARGE','Buffered body exceeds 32 MiB');}chunks.push(item.value);}const result=new Uint8Array(count);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;}finally{s.bytes=null;reader.releaseLock();}
    }
    const bodyDescriptors={body:{get(){return bodyState(this).stream;}},bodyUsed:{get(){const s=bodyState(this);return s.stream!==null&&web.disturbed(s.stream);}},arrayBuffer:{value:async function(){const bytes=await consume(this);return bytes.buffer;}},bytes:{value:async function(){return consume(this);}},text:{value:async function(){return new TextDecoder().decode(await consume(this));}},json:{value:async function(){return JSON.parse(await this.text());}}};
    function cloneBody(object){const s=bodyState(object);if(s.stream&&(s.stream.locked||web.disturbed(s.stream)))throw typeError('Body is unusable');if(!s.stream)return {...s};const branches=web.tee(s.stream);s.stream=branches[0];return {...s,stream:branches[1],bytes:s.bytes?new Uint8Array(s.bytes):null};}
    function dependentSignal(signal){if(signal===undefined||signal===null)return new AbortController().signal;if(typeof signal!=='object'||typeof signal.addEventListener!=='function'||typeof signal.aborted!=='boolean')throw typeError('Invalid AbortSignal');return AbortSignal.any([signal]);}
    const enums={redirect:['follow','error','manual'],mode:['navigate','same-origin','no-cors','cors'],credentials:['omit','same-origin','include'],cache:['default','no-store','reload','no-cache','force-cache','only-if-cached'],referrerPolicy:['','no-referrer','no-referrer-when-downgrade','same-origin','origin','strict-origin','origin-when-cross-origin','strict-origin-when-cross-origin','unsafe-url']};
    class Request {
        constructor(input,init={}){
            if(arguments.length===0)throw typeError('Request URL is required');if(init===null)init={};if(typeof init!=='object')throw typeError('Invalid Request initializer');
            const original=input instanceof Request?input:null,old=original?.[requestKey];let address;try{address=new url.URL(old?.url??String(input));}catch{throw typeError('Failed to parse URL');}if(address.username||address.password)throw typeError('Request URL contains credentials');
            let method=byteString(init.method??old?.method??'GET');if(!token.test(method))throw typeError('Invalid HTTP method');if(['CONNECT','TRACE','TRACK'].includes(method.toUpperCase()))throw typeError('Forbidden HTTP method');if(['DELETE','GET','HEAD','OPTIONS','POST','PUT'].includes(method.toUpperCase()))method=method.toUpperCase();
            const properties={url:address.href,method,headers:new Headers(init.headers??old?.headers),signal:dependentSignal(init.signal===undefined?old?.signal:init.signal),integrity:String(init.integrity??old?.integrity??''),keepalive:!!(init.keepalive??old?.keepalive??false),duplex:'half',destination:'',referrer:String(init.referrer??old?.referrer??'about:client')};
            for(const [key,allowed]of Object.entries(enums)){const v=String(init[key]??old?.[key]??({redirect:'follow',mode:'cors',credentials:'same-origin',cache:'default',referrerPolicy:''}[key]));if(!allowed.includes(v)||key==='mode'&&v==='navigate')throw typeError('Invalid '+key);properties[key]=v;}
            if(properties.cache==='only-if-cached'&&properties.mode!=='same-origin')throw typeError('only-if-cached requires same-origin mode');if(init.duplex!==undefined&&init.duplex!=='half')throw typeError('Invalid duplex');
            const inherited=init.body==null&&original?.body!==null&&original!==null;let body;
            if(inherited){const oldBody=bodyState(original);if(oldBody.stream.locked||web.disturbed(oldBody.stream))throw typeError('Body is unusable');if(method==='GET'||method==='HEAD')throw typeError('GET/HEAD requests cannot have a body');body={...oldBody};
                const reader=oldBody.stream.getReader();web.markDisturbed(oldBody.stream);oldBody.bytes=null;body.stream=new ReadableStream({async pull(c){try{const item=await reader.read();if(item.done)c.close();else c.enqueue(item.value);}catch(e){c.error(e);}},cancel:reason=>reader.cancel(reason)},{highWaterMark:0});
            }else body=extract(init.body);
            if(body.stream&&(method==='GET'||method==='HEAD'))throw typeError('GET/HEAD requests cannot have a body');if(body.streaming&&init.duplex===undefined&&!inherited)throw typeError('duplex option is required for streaming request bodies');if(body.streaming&&properties.keepalive)throw typeError('keepalive cannot be used with a stream body');
            if(body.type&&!properties.headers.has('content-type'))properties.headers.set('content-type',body.type);Object.defineProperty(this,requestKey,{value:properties});attachBody(this,body);
        }
        clone(){const properties=this[requestKey];if(!properties)throw typeError('Invalid Request receiver');const body=cloneBody(this),copy=Object.create(Request.prototype);Object.defineProperty(copy,requestKey,{value:{...properties,headers:new Headers(properties.headers),signal:dependentSignal(properties.signal)}});attachBody(copy,body);return copy;}
    }
    for(const key of ['url','method','headers','signal','redirect','mode','credentials','cache','referrer','referrerPolicy','integrity','keepalive','duplex','destination'])Object.defineProperty(Request.prototype,key,{get(){const s=this[requestKey];if(!s)throw typeError('Invalid Request receiver');return s[key];}});
    Object.defineProperties(Request.prototype,bodyDescriptors);Object.defineProperty(Request.prototype,Symbol.toStringTag,{value:'Request'});
    class Response {
        constructor(input=null,init={}){if(init===null)init={};if(typeof init!=='object')throw typeError('Invalid Response initializer');let status=Number(init.status??200);status=status>>>0;if(status<200||status>599)throw new RangeError('Invalid response status');const statusText=byteString(init.statusText??'');if(/[^\t\x20-\x7e\x80-\xff]/.test(statusText))throw typeError('Invalid statusText');const body=extract(input);if(body.stream&&[204,205,304].includes(status))throw typeError('Null body status cannot have a body');const headers=new Headers(init.headers);if(body.type&&!headers.has('content-type'))headers.set('content-type',body.type);Object.defineProperty(this,responseKey,{value:{status,statusText,headers,url:'',redirected:false,type:'default'}});attachBody(this,body);}
        get ok(){const status=this.status;return status>=200&&status<=299;}
        clone(){const properties=this[responseKey];if(!properties)throw typeError('Invalid Response receiver');const copy=Object.create(Response.prototype),headers=new Headers(properties.headers);headersState(headers).immutable=headersState(properties.headers).immutable;Object.defineProperty(copy,responseKey,{value:{...properties,headers}});attachBody(copy,cloneBody(this));return copy;}
        static error(){const response=new Response();Object.assign(response[responseKey],{status:0,statusText:'',type:'error'});headersState(response.headers).immutable=true;return response;}
        static redirect(input,status=302){status=Number(status)>>>0;if(![301,302,303,307,308].includes(status))throw new RangeError('Invalid redirect status');let address;try{address=new url.URL(String(input));}catch{throw typeError('Invalid redirect URL');}const response=new Response(null,{status,headers:{location:address.href}});headersState(response.headers).immutable=true;return response;}
        static json(data,init={}){const serialized=JSON.stringify(data);if(serialized===undefined)throw typeError('Value is not JSON serializable');const headers=new Headers(init?.headers);if(!headers.has('content-type'))headers.set('content-type','application/json');return new Response(serialized,{...init,headers});}
    }
    for(const key of ['status','statusText','headers','url','redirected','type'])Object.defineProperty(Response.prototype,key,{get(){const s=this[responseKey];if(!s)throw typeError('Invalid Response receiver');return s[key];}});
    Object.defineProperties(Response.prototype,bodyDescriptors);Object.defineProperty(Response.prototype,Symbol.toStringTag,{value:'Response'});
    function abortBody(){return new DOMException('The operation was aborted.','AbortError');}
    function deflateDecoder(){let decoder;const {Transform}=streams.api;
        const output=new Transform({transform(chunk,encoding,callback){if(!chunk.length){callback();return;}if(!decoder){decoder=(chunk[0]&15)===8?compression.api.createInflate():compression.api.createInflateRaw();decoder.on('data',data=>{if(!this.push(data))decoder.pause();});decoder.on('error',e=>this.destroy(e));}decoder.write(chunk,callback);},flush(callback){if(!decoder){callback();return;}decoder.once('end',callback);decoder.end();},destroy(e,callback){decoder?.destroy();callback(e);}});
        const read=output._read;output._read=function(...args){decoder?.resume();return read.apply(this,args);};return output;
    }
    function decode(source,encoding){let current=source;for(const coding of encoding.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).reverse()){
            let decoder;if(coding==='gzip'||coding==='x-gzip')decoder=compression.api.createGunzip();else if(coding==='deflate')decoder=deflateDecoder();else if(coding==='identity')continue;else throw codedError(Error,'ERR_NOT_SUPPORTED','Unsupported response content encoding: '+coding);
            const previous=current;previous.on('error',e=>decoder.destroy(e));decoder.on('error',()=>source.destroy());current=previous.pipe(decoder);
        }return current;
    }
    async function fetch(input,init=undefined){let request;try{request=new Request(input,init);}catch(e){return Promise.reject(e);}let current=new url.URL(request.url),method=request.method,headers=new Headers(request.headers),body=bodyState(request),redirects=0;
        const signal=request.signal;if(signal.aborted)throw signal.reason;
        for(;;){if(signal.aborted)throw signal.reason;const module=transports[current.protocol];if(!module)throw fetchError(codedError(Error,'ERR_NOT_SUPPORTED','Unsupported Fetch protocol'));
            if(current.username||current.password)throw typeError('Request URL contains credentials');const wireHeaders=new Headers(headers);
            if(!wireHeaders.has('accept'))wireHeaders.set('accept','*/*');if(!wireHeaders.has('accept-language'))wireHeaders.set('accept-language','*');if(!wireHeaders.has('accept-encoding'))wireHeaders.set('accept-encoding','gzip, deflate');if(!wireHeaders.has('user-agent'))wireHeaders.set('user-agent','quickjs-cosmo');if(!wireHeaders.has('sec-fetch-mode'))wireHeaders.set('sec-fetch-mode',request.mode);
            if(body.bytes!==null&&!wireHeaders.has('content-length'))wireHeaders.set('content-length',String(body.bytes.length));
            const result=await new Promise((resolve,reject)=>{let settled=false,req;const raw=[];for(const [key,v]of wireHeaders)raw.push(key,v);
                try{req=module.requestRaw({protocol:current.protocol,hostname:current.hostname,port:current.port||undefined,path:current.pathname+current.search,method,headers:raw,signal},res=>{settled=true;resolve({req,res});});}catch(e){reject(fetchError(e));return;}
                req.on('error',e=>{if(!settled)reject(signal.aborted?signal.reason:fetchError(e));});
                (async()=>{try{if(body.stream!==null){if(body.stream.locked||web.disturbed(body.stream))throw typeError('Body is unusable');const reader=body.stream.getReader(),abort=()=>reader.cancel(signal.reason).catch(()=>{});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();try{for(;;){const item=await reader.read();if(item.done)break;if(!(item.value instanceof Uint8Array))throw typeError('Request body must contain bytes');await new Promise((done,fail)=>req.write(item.value,e=>e?fail(e):done()));}}catch(e){await reader.cancel(e).catch(()=>{});throw e;}finally{signal.removeEventListener('abort',abort);reader.releaseLock();}}req.end();}catch(e){req.destroy(e);if(!settled)reject(signal.aborted?signal.reason:fetchError(e));}})();
            });
            const {req,res}=result,status=res.statusCode,responseHeaders=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)responseHeaders.append(res.rawHeaders[i],res.rawHeaders[i+1]);headersState(responseHeaders).immutable=true;
            const location=responseHeaders.get('location');
            if([301,302,303,307,308].includes(status)&&location!==null&&request.redirect!=='manual'){
                const closed=new Promise(resolve=>{if(res.socket.closed)resolve();else res.socket.once('close',resolve);});res.destroy();await closed;
                if(request.redirect==='error')throw fetchError(typeError('Unexpected redirect'));if(++redirects>20)throw fetchError(typeError('Redirect count exceeded'));
                let next;try{next=new url.URL(location,current);}catch(e){throw fetchError(e);}if(!transports[next.protocol]||next.username||next.password)throw fetchError(typeError('Invalid redirect URL'));
                if(status===303&&method!=='GET'&&method!=='HEAD'||[301,302].includes(status)&&method==='POST'){method='GET';body={stream:null,bytes:null,type:null,streaming:false};for(const key of ['content-encoding','content-language','content-location','content-type','content-length'])headers.delete(key);}
                else if(body.stream!==null){if(body.bytes===null)throw fetchError(typeError('Cannot replay a streaming body'));body=extract(body.bytes);}
                if(next.origin!==current.origin)for(const key of ['authorization','cookie','proxy-authorization'])headers.delete(key);current=next;continue;
            }
            let node=res;const nullBody=method==='HEAD'||[204,205,304].includes(status);try{if(!nullBody&&responseHeaders.has('content-encoding'))node=decode(res,responseHeaders.get('content-encoding'));}catch(e){res.destroy();throw fetchError(e);}
            const response=Object.create(Response.prototype),address=new url.URL(current);address.hash='';Object.defineProperty(response,responseKey,{value:{status,statusText:res.statusMessage,headers:responseHeaders,url:address.href,redirected:redirects>0,type:'basic'}});
            attachBody(response,{stream:nullBody?null:web.fromNode(node,e=>{if(signal.aborted)return signal.reason;const failure=new TypeError('terminated');failure.cause=e;return failure;},()=>{node.destroy();res.destroy();if(!req.destroyed)req.destroy();},signal),bytes:null,type:null,streaming:true});if(nullBody)res.resume();return response;
        }
    }
    return {api:{fetch,Headers,Request,Response}};
}
