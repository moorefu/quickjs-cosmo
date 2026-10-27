function createFsAsync(native, path, helpers, sync) {
    const binding=native.fs.async, windows=native.platform==='win32';
    const {options,encoding,fd,isFd,mode,flags,bytes,display,join,parent,view,position,makeStats,Dirent,boolean}=helpers;
    const constants=sync.constants, maxIO=0x7fffffff, handles=new WeakMap();
    function abortError(signal) {
        const error=codedError(Error,'ABORT_ERR','The operation was aborted');error.name='AbortError';error.cause=signal.reason;return error;
    }
    function signalOption(signal) {
        if(signal!==undefined && (signal===null || typeof signal!=='object' || typeof signal.aborted!=='boolean' || typeof signal.addEventListener!=='function'))throw invalidType('options.signal','an AbortSignal');
        return signal;
    }
    function start(name,args,signal) {
        if(signal?.aborted)return Promise.reject(abortError(signal));
        let job;
        try{job=binding[name](...args);}catch(error){return Promise.reject(error);}
        const cancel=()=>binding.cancel(job.id);
        try{signal?.addEventListener('abort',cancel,{once:true});}
        catch(error){binding.cancel(job.id);return job.promise.catch(()=>{}).then(()=>{throw error;});}
        return job.promise.catch(error=>{if(signal?.aborted)throw abortError(signal);throw error;}).finally(()=>signal?.removeEventListener('abort',cancel));
    }
    async function pathCall(name,a,b,rest=[],signal) {
        try{return await start(name,b===undefined?[a,...rest]:[a,b,...rest],signal);}
        catch(error){if(typeof error?.errno==='number'){error.path=display(a);if(b!==undefined)error.dest=display(b);}throw error;}
    }
    function openGuard(name,flag,permissions) {const a=bytes(name),f=flags(flag),m=mode(permissions,0o666);return pathCall('open',a,undefined,[f,m]);}
    function open(name,flag,permissions) {return openGuard(name,flag,permissions).then(value=>binding.takeHandle(value));}
    function closeGuard(guard) {
        try{return binding.closeHandle(guard).promise;}
        catch(error){try{binding.dropHandle(guard);}catch{}return Promise.reject(error);}
    }
    function close(number){return start('close',[fd(number)]);}
    function read(number,buffer,offsetOrOptions,length,where) {
        number=fd(number);
        if(!ArrayBuffer.isView(buffer)) {
            const opts=buffer??{};if(typeof opts!=='object')throw invalidType('options','an object');
            buffer=opts.buffer??Buffer.alloc(16384);offsetOrOptions=opts;
        }
        const original=buffer,data=view(buffer);let offset=offsetOrOptions;
        if(offsetOrOptions===undefined || offsetOrOptions===null || typeof offsetOrOptions==='object') {
            ({offset=0,length=data.byteLength-offset,position:where=null}=offsetOrOptions??{});
        }
        offset=integer(offset??0,'offset',0,data.byteLength);
        length=integer(length??data.byteLength-offset,'length',0,data.byteLength-offset);where=position(where,length);
        return start('read',[number,data.buffer,data.byteOffset+offset,length,where]).then(result=>{
            if(result.count)new Uint8Array(data.buffer,data.byteOffset+offset,result.count).set(new Uint8Array(result.buffer));
            return {bytesRead:result.count,buffer:original};
        });
    }
    function write(number,buffer,offsetOrOptions,length,where) {
        number=fd(number);const original=buffer;let data,offset=offsetOrOptions;
        if(typeof buffer==='string') {
            const enc=encoding(typeof length==='string'?length:undefined,'utf8');
            data=Buffer.from(buffer,enc);where=offset==null?-1:position(offset,data.byteLength,false);offset=0;length=data.byteLength;
        } else {
            data=view(buffer);
            if(typeof offset==='object')({offset=0,length=data.byteLength-offset,position:where=null}=offsetOrOptions??{});
            offset=integer(offset??0,'offset',0,data.byteLength);
            length=integer(length??data.byteLength-offset,'length',0,data.byteLength-offset);where=position(where,length,false);
        }
        return start('write',[number,data.buffer,data.byteOffset+offset,length,where]).then(bytesWritten=>({bytesWritten,buffer:original}));
    }
    function stat(name,opts,kind=0) {
        if(opts===null || opts!==undefined && typeof opts!=='object')throw invalidType('options','an object');
        const a=kind===2?fd(name):bytes(name),big=!!opts?.bigint;
        return (kind===2?start('stat',[a,kind]):pathCall('stat',a,undefined,[kind])).then(raw=>makeStats(raw,big));
    }
    function readFile(name,supplied) {
        const opts=options(supplied,{flag:'r'}),enc=encoding(opts.encoding),signal=signalOption(opts.signal);
        const owned=!isFd(name),a=owned?bytes(name):fd(name),f=flags(opts.flag);
        return (async()=>{
            if(signal?.aborted)throw abortError(signal);
            const guard=owned?await pathCall('open',a,undefined,[f,0o666],signal):null;
            const number=owned?binding.handleFd(guard):a;
            try {
                const s=await stat(number,undefined,2);
                if(s.isDirectory())native.fs.error('EISDIR','read');
                if(s.size>maxIO)throw codedError(RangeError,'ERR_FS_FILE_TOO_LARGE','File exceeds maximum read size');
                const chunks=[];let total=0;
                for(;;) {
                    const size=Math.min(65536,maxIO-total||1),buffer=Buffer.allocUnsafe(size);
                    const r=await start('read',[number,buffer.buffer,buffer.byteOffset,size,-1],signal);
                    if(!r.count)break;
                    if(total+r.count>maxIO)throw codedError(RangeError,'ERR_FS_FILE_TOO_LARGE','File exceeds maximum read size');
                    chunks.push(Buffer.from(r.buffer));total+=r.count;
                }
                const result=Buffer.concat(chunks,total);return enc?result.toString(enc):result;
            } finally {if(owned)await closeGuard(guard);}
        })();
    }
    function writeFile(name,data,supplied) {
        const opts=options(supplied,{encoding:'utf8',mode:0o666,flag:'w',flush:false}),enc=encoding(opts.encoding,'utf8');
        boolean(opts.flush??false,'options.flush');const signal=signalOption(opts.signal);
        const buffer=typeof data==='string'?Buffer.from(data,enc):Buffer.from(view(data,'data'));
        const owned=!isFd(name),a=owned?bytes(name):fd(name),f=flags(opts.flag||'w'),permissions=mode(opts.mode,0o666);
        return (async()=>{
            if(signal?.aborted)throw abortError(signal);
            const guard=owned?await pathCall('open',a,undefined,[f,permissions],signal):null;
            const number=owned?binding.handleFd(guard):a;
            try {
                let offset=0;
                while(offset<buffer.byteLength) {
                    const count=await start('write',[number,buffer.buffer,buffer.byteOffset+offset,Math.min(65536,buffer.byteLength-offset),-1],signal);
                    if(!count)native.fs.error('EIO','write');offset+=count;
                }
                if(opts.flush)await start('sync',[number],signal);
            } finally {if(owned)await closeGuard(guard);}
        })();
    }
    function appendFile(name,data,opts){opts=options(opts,{flag:'a'});if(!opts.flag || isFd(name))opts.flag='a';return writeFile(name,data,opts);}
    function mkdir(name,supplied) {
        const a=bytes(name);let permissions=0o777,recursive=false;
        if(typeof supplied==='number' || typeof supplied==='string')permissions=mode(supplied,permissions);
        else if(supplied){permissions=mode(supplied.mode,permissions);if(supplied.recursive!==undefined)recursive=boolean(supplied.recursive,'options.recursive');}
        return (async()=>{
            if(!recursive)return pathCall('mkdir',a,undefined,[permissions]);
            const pending=[];let current=a;
            for(;;) {
                try{await pathCall('mkdir',current,undefined,[permissions]);pending.push(current);break;}
                catch(error){
                    if(error.code==='EEXIST'){if(!(await stat(current)).isDirectory())throw error;break;}
                    if(error.code!=='ENOENT')throw error;
                    pending.push(current);const next=parent(current);if(Buffer.compare(next,current)===0)throw error;current=next;
                }
            }
            const first=pending.length?pending[pending.length-1]:undefined;
            for(let i=pending.length-1;i>=0;i--) {
                if(Buffer.compare(pending[i],current)===0)continue;
                try{await pathCall('mkdir',pending[i],undefined,[permissions]);}
                catch(error){if(error.code!=='EEXIST' || !(await stat(pending[i])).isDirectory())throw error;}
            }
            return first===undefined?undefined:windows?path.toNamespacedPath(display(first)):display(first);
        })();
    }
    function readdir(name,supplied) {
        const opts=options(supplied),enc=encoding(opts.encoding,'utf8',true),base=bytes(name),bytePath=name instanceof Uint8Array;
        if(opts.recursive!=null)boolean(opts.recursive,'options.recursive');
        return (async()=>{
            const result=[],queue=[base];
            for(let index=0;index<queue.length;index++) {
                const directory=queue[index],entries=(await pathCall('scan',directory)).map(([data,type])=>[Buffer.from(data),type]);
                entries.sort((a,b)=>Buffer.compare(a[0],b[0]));
                for(let [raw,type] of entries) {
                    const entryName=enc==='buffer'?raw:raw.toString(enc),full=join(directory,raw);
                    if(!type && opts.withFileTypes)type=(Number((await stat(full,undefined,1)).mode)&0xf000)>>>12;
                    if(opts.withFileTypes)result.push(new Dirent(entryName,({0:0,8:1,4:2,10:3,1:4,12:5,2:6,6:7})[type],bytePath?directory:display(directory)));
                    else result.push(opts.recursive?path.relative(display(base),display(full)):entryName);
                    if(opts.recursive)try{if((await stat(full)).isDirectory())queue.push(full);}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;}
                }
            }
            return result;
        })();
    }
    function remove(name,supplied,expectDirectory=false) {
        const a=bytes(name);
        if(supplied!==undefined && (supplied===null || typeof supplied!=='object' || Array.isArray(supplied)))throw invalidType('options','an object');
        const opts={recursive:false,force:false,maxRetries:0,retryDelay:100,...supplied};
        boolean(opts.recursive,'options.recursive');boolean(opts.force,'options.force');integer(opts.maxRetries,'options.maxRetries',0,0xffffffff);integer(opts.retryDelay,'options.retryDelay',0,0xffffffff);
        async function once() {
            const pending=[{current:a,root:true,post:false}];
            while(pending.length) {
                const {current,root,post}=pending.pop();if(post){await pathCall('rmdir',current);continue;}
                let s;try{s=await stat(current,undefined,1);}catch(error){if(opts.force && error.code==='ENOENT')continue;throw error;}
                if(root && expectDirectory && !s.isDirectory()){await pathCall('rmdir',current);continue;}
                if(s.isDirectory()) {
                    if(!opts.recursive) {
                        if(expectDirectory){await pathCall('rmdir',current);continue;}
                        try{native.fs.error('EISDIR','rm');}catch(error){error.path=display(current);error.name='SystemError';error.code='ERR_FS_EISDIR';error.errno=21;throw error;}
                    }
                    pending.push({current,root:false,post:true});
                    const entries=await pathCall('scan',current);
                    for(let i=entries.length-1;i>=0;i--)pending.push({current:join(current,Buffer.from(entries[i][0])),root:false,post:false});
                } else await pathCall('unlink',current);
            }
        }
        return (async()=>{
            for(let attempt=0;;attempt++)try{return await once();}catch(error){
                if(opts.force && error.code==='ENOENT')return;
                if(!opts.recursive || attempt>=opts.maxRetries || !['EBUSY','EMFILE','ENFILE','ENOTEMPTY','EPERM'].includes(error.code))throw error;
                await new Promise(resolve=>setTimeout(resolve,Math.min(0x7fffffff,(attempt+1)*opts.retryDelay)));
            }
        })();
    }
    function copyFile(source,destination,copyMode=0) {
        integer(copyMode,'mode',-0x80000000,0x7fffffff);if(copyMode&~7)throw outOfRange('mode');
        const a=bytes(source),b=bytes(destination);
        return (async()=>{
            let input,output,inputGuard,outputGuard,failed=false;
            try {
                if(copyMode&4)native.fs.error('ENOTSUP','copyfile');
                inputGuard=await openGuard(a,'r');input=binding.handleFd(inputGuard);const s=await stat(input,undefined,2);
                if(s.isDirectory())native.fs.error(windows?'EPERM':native.platform==='darwin'?'ENOTSUP':'EISDIR','copyfile');
                outputGuard=await openGuard(b,constants.O_WRONLY|constants.O_CREAT|(copyMode&1?constants.O_EXCL:0),Number(s.mode)&0o777);output=binding.handleFd(outputGuard);
                const dest=await stat(output,undefined,2);if(s.dev===dest.dev && s.ino===dest.ino)return;
                await start('truncate',[output,0]);if(!windows)await start('chmod',[output,Number(s.mode)&0o777]);
                const buffer=Buffer.allocUnsafe(65536);
                for(;;){const {bytesRead}=await read(input,buffer,0,buffer.length);if(!bytesRead)break;let offset=0;while(offset<bytesRead){const {bytesWritten}=await write(output,buffer,offset,bytesRead-offset);if(!bytesWritten)native.fs.error('EIO','copyfile');offset+=bytesWritten;}}
            }catch(error){failed=true;error.syscall='copyfile';error.path=display(a);error.dest=display(b);throw error;}
            finally {
                let closeError;for(const guard of [outputGuard,inputGuard])if(guard!==undefined)try{await closeGuard(guard);}catch(error){closeError??=error;}
                if(failed && output!==undefined)try{await pathCall('unlink',b);}catch{}
                if(closeError && !failed){closeError.syscall='copyfile';closeError.path=display(a);closeError.dest=display(b);throw closeError;}
            }
        })();
    }
    function realpath(name,supplied){const opts=options(supplied),enc=encoding(opts.encoding,'utf8',true),a=bytes(name);return pathCall('realpath',a).then(raw=>{const value=Buffer.from(raw);return enc==='buffer'?value:value.toString(enc);});}
    function mkdtemp(prefix,supplied){const opts=options(supplied),enc=encoding(opts.encoding,'utf8',true),a=bytes(prefix,'prefix');return pathCall('mkdtemp',a).then(raw=>{const value=Buffer.from(raw);return enc==='buffer'?value:value.toString(enc);});}
    function access(name,accessMode=0){const a=bytes(name);integer(accessMode,'mode',-0x80000000,0x7fffffff);if(accessMode&~7)throw outOfRange('mode');return pathCall('access',a,undefined,[accessMode]);}
    function truncate(number,length=0){number=fd(number);integer(length,'len',-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER);return start('truncate',[number,Math.max(0,length)]);}
    const operations={readFile,writeFile,appendFile,access,mkdir,readdir,stat,lstat:(name,opts)=>stat(name,opts,1),fstat:(number,opts)=>stat(number,opts,2),
        rename:(a,b)=>pathCall('rename',bytes(a),bytes(b)),unlink:name=>pathCall('unlink',bytes(name)),rmdir:(name,opts)=>remove(name,opts,true),rm:remove,
        realpath,copyFile,mkdtemp,open,close,read,write,ftruncate:truncate,fsync:number=>start('sync',[fd(number)])};
    const api={},multi={read:'bytesRead',write:'bytesWritten'};
    for(const [name,operation] of Object.entries(operations)) {
        const fn=api[name]={[name](...args){
            const callback=args.pop();if(typeof callback!=='function')throw invalidType('cb','a function');
            const promise=operation(...args);
            promise.then(result=>multi[name]?callback(null,result[multi[name]],result.buffer):name==='stat'||name==='lstat'||name==='fstat'||['readFile','readdir','mkdir','realpath','mkdtemp','open'].includes(name)?callback(null,result):callback(null),error=>callback(error));
        }}[name];
        if(multi[name])Object.defineProperty(fn,promisifyCustom,{value:async function(...args){return operation(...args);}});
    }
    api.realpath.native=api.realpath;
    function closedError(syscall){const e=codedError(Error,'EBADF','file closed');e.syscall=syscall;return e;}
    class FileHandle {
        constructor(guard){handles.set(this,{fd:binding.handleFd(guard),guard,pending:new Set(),closing:false,closePromise:null});}
        get fd(){return binding.handleFd(handles.get(this).guard);}
        _run(name,args){
            const state=handles.get(this);if(state.closing || state.fd<0)return Promise.reject(closedError(name));
            let release;const ticket=new Promise(resolve=>release=resolve);state.pending.add(ticket);
            let operation;try{operation=operations[name](state.fd,...args);}catch(error){operation=Promise.reject(error);}
            return Promise.resolve(operation).finally(()=>{state.pending.delete(ticket);release();});
        }
        read(...args){return this._run('read',args);}
        write(...args){return this._run('write',args);}
        readFile(...args){return this._run('readFile',args);}
        writeFile(...args){return this._run('writeFile',args);}
        appendFile(...args){return this._run('appendFile',args);}
        stat(...args){return this._run('fstat',args);}
        truncate(...args){return this._run('ftruncate',args);}
        sync(){return this._run('fsync',[]);}
        close(){
            const state=handles.get(this);if(state.closePromise)return state.closePromise;state.closing=true;
            const finish=()=>closeGuard(state.guard);
            const pending=[...state.pending];
            return state.closePromise=(pending.length?Promise.all(pending).then(finish):finish()).finally(()=>{state.fd=-1;});
        }
    }
    if(Symbol.asyncDispose)FileHandle.prototype[Symbol.asyncDispose]=FileHandle.prototype.close;
    const promises={constants};
    for(const [name,operation] of Object.entries(operations))if(!['close','read','write','fstat','ftruncate','fsync'].includes(name))promises[name]=async function(...args){
        if(name==='open') {
            const guard=await openGuard(...args);
            try{return new FileHandle(guard);}catch(error){try{binding.dropHandle(guard);}catch{}throw error;}
        }
        if(['readFile','writeFile','appendFile'].includes(name) && handles.has(args[0]))return args[0][name](...args.slice(1));
        if(['readFile','writeFile','appendFile'].includes(name) && typeof args[0]==='number')bytes(args[0]);
        return operation(...args);
    };
    api.promises=promises;
    return api;
}
