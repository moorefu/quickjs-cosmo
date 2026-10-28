function installStdio(native,process,streams,fs){
    const binding=native.stdio,{Readable,Writable}=streams.api,cache={};
    function output(fd){
        const stream=new Writable({autoDestroy:false,emitClose:false,write(data,encoding,callback){try{let offset=0;while(offset<data.length){const count=binding.write(fd,data.buffer,data.byteOffset+offset,Math.min(65536,data.length-offset));if(!count)throw codedError(Error,'ERR_SYSTEM_ERROR','A stdio write made no progress');offset+=count;}process.nextTick(callback,null);}catch(e){callback(e);}},destroy(error,callback){callback(error);}});
        Object.defineProperty(stream,'fd',{value:fd,enumerable:true});stream.isTTY=binding.isTTY(fd)||undefined;streams.stdioSink(stream);return stream;
    }
    function input(){
        let referenced=true;
        const ready=()=>{try{const bytes=Buffer.allocUnsafe(65536),count=fs.readSync(0,bytes,0,bytes.length,null);if(!count){binding.watch(null);stream.push(null);}else if(!stream.push(bytes.subarray(0,count)))binding.watch(null);}catch(e){stream.destroy(e);}};
        const stream=new Readable({read(){try{binding.watch(ready,referenced);}catch(e){this.destroy(e);}},destroy(error,callback){binding.watch(null);callback(error);}});
        Object.defineProperty(stream,'fd',{value:0,enumerable:true});stream.isTTY=binding.isTTY(0)||undefined;
        stream.ref=function(){referenced=true;binding.ref(true);return this;};stream.unref=function(){referenced=false;binding.ref(false);return this;};return stream;
    }
    for(const [name,create]of [['stdin',input],['stdout',()=>output(1)],['stderr',()=>output(2)]])Object.defineProperty(process,name,{enumerable:true,configurable:true,get(){return cache[name]??=create();}});
}
