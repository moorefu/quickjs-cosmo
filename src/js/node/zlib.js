function createCompression(native, streams) {
    const binding = native.compression;
    const versions = binding.versions();
    const empty = new ArrayBuffer(0);
    const constants = Object.freeze({...compressionConstants, ZLIB_VERNUM: versions.zlibVernum});
    const codes = {};
    for (const name of ['Z_OK','Z_STREAM_END','Z_NEED_DICT','Z_ERRNO','Z_STREAM_ERROR','Z_DATA_ERROR','Z_MEM_ERROR','Z_BUF_ERROR','Z_VERSION_ERROR']) {
        codes[name] = constants[name]; codes[constants[name]] = name;
    }
    Object.freeze(codes);
    function bytes(input, name = 'buffer', strings = true) {
        if (typeof input === 'string' && strings) input = Buffer.from(input);
        if (ArrayBuffer.isView(input)) return [input.buffer, input.byteOffset, input.byteLength];
        if (isArrayBuffer(input)) return [input, 0, input.byteLength];
        throw invalidType(name, strings ? 'a string or byte buffer' : 'an ArrayBuffer or ArrayBufferView');
    }
    function range(value, name, min, max, fallback) {
        if (value === undefined || typeof value === 'number' && Number.isNaN(value)) return fallback;
        if (typeof value !== 'number') throw invalidType(name, 'a number');
        if (!Number.isFinite(value) || value < min || value > max) throw outOfRange(name);
        return Math.trunc(value);
    }
    function boolean(value, name, fallback) {
        if (value === undefined) return fallback;
        if (typeof value !== 'boolean') throw invalidType(name, 'a boolean');
        return value;
    }
    function optionsObject(value) {
        if (value === undefined || value === null || !value) return {};
        /* Node's zlib constructors read options by property access. */
        return value;
    }
    function perform(mode, input, supplied, asynchronous=false, preparing=false) {
        const options = optionsObject(supplied);
        const zstd = mode === 7 || mode === 8, extension = mode >= 9;
        let window = 15, level = -1, memory = 8, strategy = 0;
        let dictionary = [empty, 0, 0], params = [], pledged;
        if (mode <= 6) {
            const suppliedWindow = options.windowBits;
            window = (mode === 1 || mode === 3 || mode === 6) && (suppliedWindow == null || suppliedWindow === 0) ? 0 :
                range(suppliedWindow, 'options.windowBits', mode === 2 ? 9 : 8, 15, 15);
            level = range(options.level, 'options.level', -1, 9, -1);
            memory = range(options.memLevel, 'options.memLevel', 1, 9, 8);
            strategy = range(options.strategy, 'options.strategy', 0, 4, 0);
            if (options.dictionary !== undefined) dictionary = bytes(options.dictionary, 'options.dictionary', false);
        } else if (zstd) {
            const max = mode === 7 ? 402 : 100;
            if (options.params) {
                const seen = new Set();
                for (const key of Object.keys(options.params)) {
                    const index = +key;
                    if (!Number.isInteger(index) || index < 0 || index > max || seen.has(index))
                        throw codedError(RangeError, 'ERR_ZSTD_INVALID_PARAM', 'Invalid Zstd parameter');
                    const value = options.params[key];
                    if (typeof value !== 'number' && typeof value !== 'boolean') throw invalidType('options.params[key]', 'a number');
                    const coerced = value | 0;
                    if (coerced !== -1) seen.add(index);
                    if (mode === 7 && index === 400 && coerced !== 0 && coerced !== -1)
                        throw codedError(Error, 'ERR_NOT_SUPPORTED', 'Zstd native worker threads are not enabled');
                    if (coerced !== -1) params.push(index, coerced);
                }
            }
            if (options.dictionary !== undefined && (ArrayBuffer.isView(options.dictionary) || isArrayBuffer(options.dictionary)))
                dictionary = bytes(options.dictionary, 'options.dictionary', false);
            if (options.pledgedSrcSize !== undefined) pledged = integer(options.pledgedSrcSize, 'options.pledgedSrcSize', 0, Number.MAX_SAFE_INTEGER);
        } else {
            if (options.dictionary !== undefined) throw codedError(Error, 'ERR_NOT_SUPPORTED', 'Extension dictionaries are not enabled');
            for (const name of ['params','flush','finishFlush']) if (options[name] !== undefined)
                throw codedError(Error, 'ERR_NOT_SUPPORTED', 'Extension option is not enabled: ' + name);
            if (mode >= 11 && (options.checksum !== undefined || options.blockSize !== undefined))
                throw codedError(Error, 'ERR_NOT_SUPPORTED', 'bzip2 always uses its own block/checksum format');
            if (mode < 11 && options.small !== undefined) throw codedError(Error, 'ERR_NOT_SUPPORTED', 'small applies only to bzip2');
            level = range(options.level, 'options.level', mode < 11 ? 0 : 1, mode < 11 ? 12 : 9, mode < 11 ? 0 : 9);
        }
        const chunk = range(options.chunkSize, 'options.chunkSize', 64, 0x7fffffff, 16384);
        range(options.flush, 'options.flush', 0, zstd ? 2 : 5, 0);
        const finish = range(options.finishFlush, 'options.finishFlush', 0, zstd ? 2 : 5, zstd ? 2 : 4);
        const maximum = range(options.maxOutputLength, 'options.maxOutputLength', 1, 0x7fffffff, 0x7fffffff);
        const reject = boolean(options.rejectGarbageAfterEnd, 'options.rejectGarbageAfterEnd', false);
        const checksum = mode === 9 || mode === 10 ? boolean(options.checksum, 'options.checksum', false) : false;
        const blockSize = mode === 9 || mode === 10 ? integer(options.blockSize ?? 0, 'options.blockSize', 0, 7) : 0;
        if (extension && blockSize !== 0 && blockSize < 4) throw outOfRange('options.blockSize');
        const small = mode >= 11 ? boolean(options.small, 'options.small', false) : false;
        const data = bytes(input);
        const args=[mode,...data,[maximum,chunk,window,level,memory,strategy,finish,+reject,+checksum,blockSize,+small],...dictionary,params,pledged];
        if(preparing)return args;
        const complete=value=>{
            const buffer=Buffer.from(value);
            if(!options.info)return buffer;
            if(mode>=9)throw codedError(Error,'ERR_NOT_SUPPORTED','Extension engine objects are not enabled');
            const engine=new constructors[mode]({...options,info:false});engine.bytesWritten=data[2];engine.destroy();
            return {buffer,engine};
        };
        if(!asynchronous)return complete(binding.run(...args));
        const signal=options.signal;
        if(signal!==undefined && (signal===null || typeof signal!=='object' || typeof signal.aborted!=='boolean' || typeof signal.addEventListener!=='function'))throw invalidType('options.signal','an AbortSignal');
        const aborted=()=>{const e=codedError(Error,'ABORT_ERR','The operation was aborted');e.name='AbortError';e.cause=signal.reason;return e;};
        if(signal?.aborted)return Promise.reject(aborted());
        const job=binding.runAsync(...args),cancel=()=>binding.cancel(job.id);
        signal?.addEventListener('abort',cancel,{once:true});
        return job.promise.then(complete,error=>{if(signal?.aborted)throw aborted();throw error;}).finally(()=>signal?.removeEventListener('abort',cancel));
    }
    const api = {constants, codes};
    const names = ['deflateSync','inflateSync','gzipSync','gunzipSync','deflateRawSync','inflateRawSync','unzipSync',
        'zstdCompressSync','zstdDecompressSync','lz4CompressSync','lz4DecompressSync','bzip2CompressSync','bzip2DecompressSync'];
    const extensions = {};
    const streamStates=new WeakMap(),markers=new WeakMap(),constructors=[];
    const constructorNames=['Deflate','Inflate','Gzip','Gunzip','DeflateRaw','InflateRaw','Unzip','ZstdCompress','ZstdDecompress'];
    function Codec() {}
    Object.setPrototypeOf(Codec.prototype,streams.Transform.prototype);Object.setPrototypeOf(Codec,streams.Transform);
    Codec.prototype._read=function(size){
        const state=streamStates.get(this),resume=state?.resume;
        if(resume){state.resume=null;resume();}
        streams.Transform.prototype._read.call(this,size);
    };
    async function processBlock(stream,data,flush,parameters) {
        const state=streamStates.get(stream);let offset=0,more=true,first=true;
        while(more && !stream.destroyed){
            const take=data.subarray(offset,offset+65536);
            const result=await binding.streamStep(state.handle,...bytes(take),state.chunk,offset+take.length<data.length?state.flush:flush,
                first&&parameters?parameters[0]:-100,first&&parameters?parameters[1]:0);
            first=false;offset+=result.consumed;stream.bytesWritten+=result.consumed;
            const output=Buffer.from(result.buffer);
            if(output.length && !stream.destroyed && !stream.push(output))await new Promise(resolve=>{state.resume=resolve;});
            if(!result.consumed && !output.length)break;
            more=offset<data.length || output.length===state.chunk && !result.ended;
        }
    }
    Codec.prototype._transform=function(data,encoding,callback){
        const state=streamStates.get(this),marker=markers.get(data.buffer);
        state.active=processBlock(this,data,marker?.flush??state.flush);
        if(marker?.params)state.active=state.active.then(()=>processBlock(this,Buffer.alloc(0),constants.Z_NO_FLUSH,marker.params));
        state.active.then(()=>{state.active=null;callback();},error=>{state.active=null;callback(error);});
    };
    Codec.prototype._flush=function(callback){
        const state=streamStates.get(this);state.active=processBlock(this,Buffer.alloc(0),state.finish);
        state.active.then(()=>{state.active=null;callback();},error=>{state.active=null;callback(error);});
    };
    Codec.prototype._destroy=function(error,callback){
        const state=streamStates.get(this);
        if(!state){callback(error);return;}
        if(state.resume){const resume=state.resume;state.resume=null;resume();}
        const close=()=>{binding.streamClose(state.handle);callback(error);};
        if(state.active)state.active.then(close,close);else close();
    };
    Codec.prototype.flush=function(kind,callback){
        const state=streamStates.get(this);
        if(typeof kind==='function'){callback=kind;kind=undefined;}
        kind=range(kind,'kind',0,state.mode<7?5:2,state.mode<7?3:1);
        if(callback!==undefined && typeof callback!=='function')throw invalidType('callback','a function');
        if(this.writableFinished){if(callback)queueMicrotask(callback);return;}
        const marker=Buffer.alloc(0);markers.set(marker.buffer,{flush:kind});this.write(marker,callback);
    };
    Codec.prototype.close=function(callback){
        if(callback!==undefined && typeof callback!=='function')throw invalidType('callback','a function');
        if(callback){if(this.closed)queueMicrotask(callback);else this.once('close',callback);}this.destroy();
    };
    Codec.prototype.reset=function(){const state=streamStates.get(this);binding.streamReset(state.handle);};
    Codec.prototype.params=function(level,strategy,callback){
        const state=streamStates.get(this);
        if(![0,2,4].includes(state.mode))throw codedError(Error,'ERR_NOT_SUPPORTED','params applies to deflate streams');
        level=range(level,'level',-1,9,-1);strategy=range(strategy,'strategy',0,4,0);
        if(typeof callback!=='function')throw invalidType('callback','a function');
        const marker=Buffer.alloc(0);markers.set(marker.buffer,{flush:constants.Z_SYNC_FLUSH,params:[level,strategy]});this.write(marker,callback);
    };
    for(let mode=0;mode<9;mode++){
        const name=constructorNames[mode];
        const Constructor={[name]:function(options){
            if(!(this instanceof Constructor))return new Constructor(options);
            const opts=optionsObject(options),args=perform(mode,Buffer.alloc(0),opts,false,true);
            const streamOptions={...opts};delete streamOptions.flush;
            streams.Transform.call(this,streamOptions);
            const handle=binding.streamCreate(...args);
            streamStates.set(this,{mode,handle,chunk:Math.min(65536,args[4][1]),flush:range(opts.flush,'options.flush',0,mode<7?5:2,0),finish:args[4][6],active:null,resume:null});
            this.bytesWritten=0;
        }}[name];
        Object.setPrototypeOf(Constructor.prototype,Codec.prototype);Object.setPrototypeOf(Constructor,Codec);
        constructors.push(Constructor);api[name]=Constructor;api['create'+name]=options=>new Constructor(options);
    }
    for (let mode=0;mode<names.length;mode++) {
        const name = names[mode];
        const fn = {[name](input, options) { return perform(mode, input, options); }}[name];
        (mode<9 ? api : extensions)[name] = fn;
        const short=name.slice(0,-4);
        (mode<9?api:extensions)[short]={[short](input,options,callback){
            if(typeof options==='function'){callback=options;options=undefined;}
            if(typeof callback!=='function')throw invalidType('callback','a function');
            perform(mode,input,options,true).then(value=>callback(null,value),error=>callback(error));
        }}[short];
    }
    api.crc32 = function crc32(data, value = 0) {
        if (typeof data !== 'string' && !ArrayBuffer.isView(data)) throw invalidType('data', 'a string or ArrayBufferView');
        integer(value, 'value', 0, 0xffffffff);
        return binding.checksum(0, ...bytes(data), value);
    };
    extensions.crc32c = function crc32c(data, value = 0) {
        integer(value, 'value', 0, 0xffffffff); return binding.checksum(1, ...bytes(data), value);
    };
    extensions.adler32 = function adler32(data, value = 1) {
        integer(value, 'value', 0, 0xffffffff); return binding.checksum(2, ...bytes(data), value);
    };
    extensions.codecInfo = function codecInfo(name) {
        const records = [
            {name:'zlib',format:'zlib/gzip/raw-deflate',backend:'Cosmopolitan zlib',version:versions.zlib},
            {name:'zstd',format:'Zstandard frame',backend:'Cosmopolitan Zstd',version:versions.zstd},
            {name:'lz4',format:'LZ4 Frame',backend:'Cosmopolitan LZ4',version:versions.lz4},
            {name:'bzip2',format:'bzip2 stream',backend:'Cosmopolitan bzip2',version:versions.bzip2}
        ];
        if (name === undefined) return records;
        if (typeof name !== 'string') throw invalidType('name', 'a string');
        const found = records.find(record => record.name === name);
        if (!found) throw codedError(TypeError, 'ERR_INVALID_ARG_VALUE', 'Unknown codec');
        return found;
    };
    return {api, extensions};
}
