/* Default-reader Web streams for Fetch; no BYOB or writable/transform streams. */
function createWebStreams() {
    const streamKey=Symbol('web.stream'),readerKey=Symbol('web.reader'),controllerKey=Symbol('web.controller');
    const invalid=message=>codedError(TypeError,'ERR_INVALID_STATE',message);
    const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
    function state(stream){const s=stream?.[streamKey];if(!s)throw invalidType('this','a ReadableStream');return s;}
    function settleClosed(s){if(s.reader){const r=s.reader[readerKey];if(s.status==='closed')r.closed.resolve();else if(s.status==='errored')r.closed.reject(s.failure);}}
    function close(s){if(s.status!=='readable')return;s.status='closed';s.abortCleanup?.();s.abortCleanup=null;for(const r of s.reads.splice(0))r.resolve({value:undefined,done:true});settleClosed(s);}
    function fail(s,reason){if(s.status!=='readable')return;s.status='errored';s.failure=reason;s.abortCleanup?.();s.abortCleanup=null;s.queue=[];s.total=0;for(const r of s.reads.splice(0))r.reject(reason);settleClosed(s);}
    function followAbort(stream,signal){
        const s=state(stream);s.abortSignal=signal;const reference=new WeakRef(s);
        function abort(event){const current=reference.deref();if(!current||current.status!=='readable')return;const reason=event.target.reason;fail(current,reason);try{Promise.resolve(current.source.cancel?.(reason)).catch(()=>{});}catch{}}
        s.abortCleanup=()=>signal.removeEventListener('abort',abort);
        if(signal.aborted)abort({target:signal});else if(s.status==='readable')signal.addEventListener('abort',abort,{once:true});else {s.abortCleanup();s.abortCleanup=null;}
        return stream;
    }
    function shouldPull(s){return s.started&&s.status==='readable'&&!s.closeRequested&&(s.reads.length>0||s.hwm-s.total>0);}
    function pull(s){if(!shouldPull(s)||typeof s.source.pull!=='function')return;if(s.pulling){s.pullAgain=true;return;}s.pulling=true;
        let result;try{result=s.source.pull(s.controller);}catch(e){s.pulling=false;fail(s,e);return;}
        Promise.resolve(result).then(()=>{s.pulling=false;if(s.pullAgain){s.pullAgain=false;pull(s);}},e=>{s.pulling=false;fail(s,e);});
    }
    class ReadableStreamDefaultController {
        get desiredSize(){const s=this[controllerKey];if(!s)throw invalidType('this','a controller');return s.status==='errored'?null:s.status==='closed'?0:s.hwm-s.total;}
        enqueue(value){const s=this[controllerKey];if(!s)throw invalidType('this','a controller');if(s.closeRequested||s.status!=='readable')throw invalid('Controller is already closed');
            if(s.reads.length)s.reads.shift().resolve({value,done:false});
            else {let size;try{size=Number(Reflect.apply(s.size,undefined,[value]));if(!Number.isFinite(size)||size<0)throw codedError(RangeError,'ERR_INVALID_ARG_VALUE','Invalid chunk size');}catch(e){fail(s,e);throw e;}s.queue.push({value,size});s.total+=size;}
            pull(s);
        }
        close(){const s=this[controllerKey];if(!s)throw invalidType('this','a controller');if(s.closeRequested||s.status!=='readable')throw invalid('Controller is already closed');s.closeRequested=true;if(!s.queue.length)close(s);}
        error(reason){const s=this[controllerKey];if(!s)throw invalidType('this','a controller');fail(s,reason);}
    }
    function cancel(s,reason){s.disturbed=true;if(s.status==='closed')return Promise.resolve();if(s.status==='errored')return Promise.reject(s.failure);s.queue=[];s.total=0;close(s);try{return Promise.resolve(s.source.cancel?.(reason)).then(()=>undefined);}catch(e){return Promise.reject(e);}}
    class ReadableStream {
        constructor(source={},strategy={}){
            if(source===null||typeof source!=='object')throw invalidType('underlyingSource','an object');if(strategy===null||typeof strategy!=='object')throw invalidType('strategy','an object');
            if(source.type!==undefined)throw codedError(TypeError,'ERR_NOT_SUPPORTED','Byte/BYOB streams are not enabled');
            const hwm=Number(strategy.highWaterMark??1);if(Number.isNaN(hwm)||hwm<0)throw codedError(RangeError,'ERR_INVALID_ARG_VALUE','Invalid highWaterMark');if(strategy.size!==undefined&&typeof strategy.size!=='function')throw invalidType('size','a function');
            for(const name of ['start','pull','cancel'])if(source[name]!==undefined&&typeof source[name]!=='function')throw invalidType(name,'a function');
            const algorithms={pull:source.pull?.bind(source),cancel:source.cancel?.bind(source)};
            const s={source:algorithms,hwm,size:strategy.size??(()=>1),status:'readable',queue:[],total:0,reads:[],reader:null,disturbed:false,started:false,pulling:false,pullAgain:false,closeRequested:false};
            Object.defineProperty(this,streamKey,{value:s});const controller=Object.create(ReadableStreamDefaultController.prototype);Object.defineProperty(controller,controllerKey,{value:s});s.controller=controller;
            const result=source.start?.(controller);Promise.resolve(result).then(()=>{s.started=true;pull(s);},e=>fail(s,e));
        }
        get locked(){return !!state(this).reader;}
        getReader(options={}){if(options?.mode!==undefined)throw codedError(TypeError,'ERR_NOT_SUPPORTED','BYOB readers are not enabled');return new ReadableStreamDefaultReader(this);}
        cancel(reason){const s=state(this);return s.reader?Promise.reject(invalid('ReadableStream is locked')):cancel(s,reason);}
        values({preventCancel=false}={}){const reader=this.getReader();let done=false;
            return {[Symbol.asyncIterator](){return this;},async next(){if(done)return {value:undefined,done:true};try{const value=await reader.read();if(value.done){done=true;reader.releaseLock();}return value;}catch(e){done=true;reader.releaseLock();throw e;}},async return(value){if(!done){done=true;try{if(!preventCancel)await reader.cancel(value);}finally{reader.releaseLock();}}return {value,done:true};}};
        }
        [Symbol.asyncIterator](){return this.values();}
        tee(){return tee(this,false);}
    }
    class ReadableStreamDefaultReader {
        constructor(stream){const s=state(stream);if(s.reader)throw invalid('ReadableStream is locked');const closed=deferred();closed.promise.catch(()=>{});Object.defineProperty(this,readerKey,{value:{stream,s,closed}});s.reader=this;settleClosed(s);}
        get closed(){const r=this[readerKey];if(!r)throw invalidType('this','a reader');return r.closed.promise;}
        read(){const r=this[readerKey];if(!r?.stream)return Promise.reject(invalid('Reader has been released'));const s=r.s;s.disturbed=true;
            if(s.queue.length){const chunk=s.queue.shift();s.total-=chunk.size;if(s.closeRequested&&!s.queue.length)close(s);else pull(s);return Promise.resolve({value:chunk.value,done:false});}
            if(s.status==='closed')return Promise.resolve({value:undefined,done:true});if(s.status==='errored')return Promise.reject(s.failure);
            const request=deferred();s.reads.push(request);pull(s);return request.promise;
        }
        cancel(reason){const r=this[readerKey];return r?.stream?cancel(r.s,reason):Promise.reject(invalid('Reader has been released'));}
        releaseLock(){const r=this[readerKey];if(!r)throw invalidType('this','a reader');if(!r.stream)return;const s=r.s,e=invalid('Reader has been released');for(const p of s.reads.splice(0))p.reject(e);r.closed.reject(e);if(s.status!=='readable'){r.closed=deferred();r.closed.promise.catch(()=>{});r.closed.reject(e);}s.reader=null;r.stream=null;}
    }
    Object.defineProperty(ReadableStream.prototype,Symbol.toStringTag,{value:'ReadableStream'});Object.defineProperty(ReadableStreamDefaultReader.prototype,Symbol.toStringTag,{value:'ReadableStreamDefaultReader'});Object.defineProperty(ReadableStreamDefaultController.prototype,Symbol.toStringTag,{value:'ReadableStreamDefaultController'});
    function tee(stream,clone){const reader=stream.getReader(),controllers=[],cancelled=[false,false],reasons=[],finished=deferred();let reading=false,again=false,ended=false;finished.promise.catch(()=>{});
        async function read(){if(ended)return;if(reading){again=true;return;}reading=true;try{const result=await reader.read();if(ended)return;if(result.done){ended=true;for(let i=0;i<2;i++)if(!cancelled[i])controllers[i].close();finished.resolve();}
            else for(let i=0;i<2;i++)if(!cancelled[i])controllers[i].enqueue(clone&&i===1&&result.value instanceof Uint8Array?new Uint8Array(result.value):result.value);
        }catch(e){ended=true;for(let i=0;i<2;i++)if(!cancelled[i])controllers[i].error(e);finished.resolve();}finally{reading=false;if(again&&!ended){again=false;read();}}}
        const branches=[0,1].map(i=>new ReadableStream({start(c){controllers[i]=c;},pull:read,cancel(reason){cancelled[i]=true;reasons[i]=reason;if(cancelled[0]&&cancelled[1]){ended=true;Promise.resolve(reader.cancel(reasons)).then(finished.resolve,finished.reject);}return finished.promise;}}));if(state(stream).abortSignal)for(const branch of branches)followAbort(branch,state(stream).abortSignal);return branches;
    }
    function fromNode(node,mapError=e=>e,onCancel,signal){const stream=new ReadableStream({start(c){node.pause();node.on('data',data=>{node.pause();try{c.enqueue(new Uint8Array(data));}catch{}});node.on('end',()=>{try{c.close();}catch{}});node.on('error',e=>c.error(mapError(e)));},pull(){node.resume();},cancel(reason){node.destroy();return onCancel?.(reason);}},{highWaterMark:0});return signal?followAbort(stream,signal):stream;}
    return {api:{ReadableStream,ReadableStreamDefaultReader},disturbed:stream=>state(stream).disturbed,markDisturbed:stream=>{state(stream).disturbed=true;},tee:stream=>tee(stream,true),fromNode};
}
