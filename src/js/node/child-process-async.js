function createAsyncChildProcess({binding,normalize,candidates,signalName,killSignal,text,object,process,streams,windows}) {
    const {Readable,Writable}=streams,states=new WeakMap();
    const tick=(fn,...args)=>process.nextTick(fn,...args);
    function systemError(code,syscall){const info=binding.error(code);return Object.assign(codedError(Error,info.code,syscall+' '+info.code),info,{syscall});}
    function abortError(signal){const e=codedError(Error,'ABORT_ERR','The operation was aborted');e.name='AbortError';e.cause=signal.reason;return e;}
    function signalOption(signal){if(signal!==undefined && (!signal || typeof signal.aborted!=='boolean' || typeof signal.addEventListener!=='function' || typeof signal.removeEventListener!=='function'))throw invalidType('options.signal','an AbortSignal');return signal;}
    class ChildProcess extends EventEmitter {
        constructor(){super();this.pid=undefined;this.spawnfile=undefined;this.spawnargs=[];this.exitCode=null;this.signalCode=null;this.killed=false;this.connected=false;this.stdin=null;this.stdout=null;this.stderr=null;this.stdio=[];states.set(this,{handle:null,nativeDone:false,exited:false,closed:false,write:null,inputClosed:false,inputDestroyed:false,endCallback:null,destroyCallback:null,timeout:null,signal:null,abort:null});}
        kill(value){
            const signal=value===0?0:killSignal(value),s=states.get(this);if(!s.handle)return false;
            const code=binding.kill(s.handle,signal);if(!code){this.killed=true;return true;}
            if(binding.error(code).code!=='ESRCH')this.emit('error',systemError(code,'kill'));return false;
        }
        ref(){const s=states.get(this);if(s.handle)binding.ref(s.handle,1);}
        unref(){const s=states.get(this);if(s.handle)binding.ref(s.handle,0);}
    }
    if(Symbol.dispose)ChildProcess.prototype[Symbol.dispose]=function(){if(!this.killed)this.kill();};
    function maybeClose(child) {
        const s=states.get(child);if(s.closed || !s.nativeDone || s.ioClosed?.some(closed=>!closed))return;
        s.closed=true;if(s.timeout)clearTimeout(s.timeout);s.signal?.removeEventListener('abort',s.abort);child.emit('close',child.exitCode,child.signalCode);
    }
    function writeNext(child) {
        const s=states.get(child),write=s.write;if(!write || s.inputDestroyed)return;
        if(write.offset>=write.data.byteLength && write.sent){s.write=null;write.callback();return;}
        const length=Math.min(65536,write.data.byteLength-write.offset);write.last=length;write.sent=true;
        const code=binding.write(s.handle,write.data.buffer,write.data.byteOffset+write.offset,length);
        if(code){s.write=null;write.callback(systemError(code,'write'));}
    }
    function setupIO(child,config) {
        const s=states.get(child);s.ioClosed=config.io.map(mode=>mode!==-1);
        child.stdio=config.io.map((mode,index)=>{
            if(mode!==-1)return null;
            let stream;
            if(!index)stream=new Writable({write(chunk,encoding,callback){const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);s.write={data,callback,offset:0,last:0,sent:false};writeNext(child);},final(callback){if(s.inputClosed){callback();return;}s.endCallback=callback;binding.end(s.handle);},destroy(error,callback){s.inputDestroyed=true;s.write=null;s.endCallback=null;if(!s.handle || s.inputClosed){callback(error);return;}s.destroyCallback=()=>callback(error);binding.dropInput(s.handle);}});
            else stream=new Readable({read(){if(s.handle)binding.read(s.handle,index);},destroy(error,callback){if(s.handle)binding.dropOutput(s.handle,index);callback(error);}});
            stream.ref=function(){if(s.handle)binding.refIO(s.handle,index,1);return this;};stream.unref=function(){if(s.handle)binding.refIO(s.handle,index,0);return this;};
            stream.once('close',()=>{s.ioClosed[index]=true;maybeClose(child);});return stream;
        });
        [child.stdin,child.stdout,child.stderr]=child.stdio;
    }
    function onEvent(child,type,index,value,code) {
        const s=states.get(child);
        if(type===0){const stream=child.stdio[index];if(stream && !stream.destroyed)stream.push(Buffer.from(value));}
        else if(type===1){const stream=child.stdio[index];if(stream && !stream.destroyed){if(code)stream.destroy(systemError(code,'read'));else stream.push(null);}}
        else if(type===2){const write=s.write;if(write && !s.inputDestroyed){if(code){s.write=null;write.callback(systemError(code,'write'));}else{write.offset+=write.last;writeNext(child);}}}
        else if(type===3){s.inputClosed=true;if(s.destroyCallback){const cb=s.destroyCallback;s.destroyCallback=null;cb();}else if(s.endCallback){const cb=s.endCallback;s.endCallback=null;cb();}}
        else if(type===4){
            s.exited=true;child.exitCode=code?null:value;child.signalCode=code?signalName(code):null;if(s.timeout){clearTimeout(s.timeout);s.timeout=null;}s.signal?.removeEventListener('abort',s.abort);
            child.stdin?.destroy();child.emit('exit',child.exitCode,child.signalCode);
            tick(()=>{for(const stream of [child.stdout,child.stderr])if(stream && !stream.destroyed)stream.resume();});
        } else if(type===5){s.nativeDone=true;s.handle=null;if(code)child.emit('error',systemError(code,'waitpid'));maybeClose(child);}
    }
    function spawn(file,args,options) {
        const config=normalize(file,args,options,true),signal=signalOption(config.options.signal),child=new ChildProcess(),s=states.get(child);
        child.spawnfile=config.file;child.spawnargs=config.argv.slice();setupIO(child,config);
        let result;
        try{result=binding.start(candidates(config.file,config.cwd,config.env),config.argv,config.env.map(entry=>entry.join('=')),config.cwd===null?null:[config.cwd.buffer,config.cwd.byteOffset,config.cwd.byteLength],config.io,config.input,config.values,(...args)=>onEvent(child,...args));}
        catch(error){for(const stream of child.stdio)stream?.destroy();throw error;}
        if(result.error){
            child.exitCode=result.error.errno;s.inputClosed=true;for(const stream of child.stdio)stream?.destroy();
            tick(()=>{const e=Object.assign(codedError(Error,result.error.code,'spawn '+config.file+' '+result.error.code),result.error,{syscall:'spawn '+config.file,path:config.file,spawnargs:config.args});child.emit('error',e);s.nativeDone=true;maybeClose(child);});return child;
        }
        s.handle=result.handle;child.pid=result.pid;tick(()=>child.emit('spawn'));
        if(config.options.timeout)s.timeout=setTimeout(()=>{if(!s.exited)child.kill(config.options.killSignal);},config.options.timeout);
        if(signal){s.signal=signal;s.abort=()=>{if(!s.exited){child.kill(config.options.killSignal);child.emit('error',abortError(signal));}};if(signal.aborted)tick(s.abort);else signal.addEventListener('abort',s.abort,{once:true});}
        return child;
    }
    function execFile(file,args,options,callback) {
        if(typeof args==='function'){callback=args;args=[];options={};}
        else if(typeof options==='function'){callback=options;options=undefined;}
        if(args!=null && typeof args==='object' && !Array.isArray(args)){options=args;args=[];}
        if(callback!==undefined && typeof callback!=='function')throw invalidType('callback','a function');
        options=options==null?{}:{...object(options,'options')};args??=[];
        const maximum=options.maxBuffer??1024*1024;if(typeof maximum!=='number' || !(maximum>=0))throw outOfRange('options.maxBuffer');
        const encoding=Object.hasOwn(options,'encoding')?options.encoding:'utf8',decoded=typeof encoding==='string' && Buffer.isEncoding(encoding),chunks=[[],[]],lengths=[0,0];let failure=null,called=false;
        const child=spawn(file,args,{...options,stdio:'pipe'});
        child.on('error',e=>{failure??=e;});
        for(const [index,stream] of [child.stdout,child.stderr].entries()) {
            if(decoded)stream.setEncoding(encoding);
            stream.on('data',chunk=>{
                if(failure)return;const size=typeof chunk==='string'?Buffer.byteLength(chunk,encoding):chunk.length;lengths[index]+=size;
                if(lengths[index]>maximum){const available=Math.max(0,maximum-(lengths[index]-size));chunks[index].push(chunk.slice(0,available));failure=codedError(RangeError,'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',(index?'stderr':'stdout')+' maxBuffer length exceeded');child.kill(options.killSignal);}
                else chunks[index].push(chunk);
            });
        }
        child.once('close',(code,signal)=>{
            if(called)return;called=true;const stdout=decoded?chunks[0].join(''):Buffer.concat(chunks[0]),stderr=decoded?chunks[1].join(''):Buffer.concat(chunks[1]);
            if(!failure && (code!==0 || signal))failure=Object.assign(new Error('Command failed: '+[file,...args].join(' ')+(stderr.length?'\n'+stderr.toString():'')),{code,signal,killed:child.killed});
            if(failure)failure.cmd=[file,...args].join(' ');
            callback?.(failure,stdout,stderr);
        });
        return child;
    }
    function exec(command,options,callback) {
        command=text(command,'command',true);if(typeof options==='function'){callback=options;options={};}options=options==null?{}:{...object(options,'options')};
        return execFile(command,[],{...options,shell:typeof options.shell==='string'?options.shell:true},callback);
    }
    for(const method of [exec,execFile])Object.defineProperty(method,promisifyCustom,{value:function(...args){let child;const promise=new Promise((resolve,reject)=>{child=method(...args,(e,stdout,stderr)=>{if(e){e.stdout=stdout;e.stderr=stderr;reject(e);}else resolve({stdout,stderr});});});promise.child=child;return promise;}});
    return {ChildProcess,spawn,execFile,exec};
}
