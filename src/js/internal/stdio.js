function installStdio(native,process,streams,fs){
    const binding=native.stdio,tty=native.tty,{Readable,Writable}=streams.api,cache={};
    let nextOwner=1;
    function owner(){if(nextOwner>0x7fffffff)throw codedError(Error,'ERR_TTY_RESOURCE_LIMIT','Terminal owner token budget exceeded');return nextOwner++;}
    function isatty(fd){return typeof fd==='number'&&Number.isInteger(fd)&&fd>=0&&fd<=0x7fffffff&&tty.isatty(fd);}
    function checkDescriptor(fd,allowed){
        if(typeof fd!=='number'||!Number.isInteger(fd)||fd<0||fd>0x7fffffff)throw codedError(RangeError,'ERR_INVALID_FD','Invalid terminal descriptor');
        if(!isatty(fd)){const error=codedError(Error,'ERR_TTY_INIT_FAILED','TTY initialization failed');error.name='SystemError';throw error;}
        if(!allowed.includes(fd))throw codedError(Error,'ERR_NOT_SUPPORTED','This TTY subset constructs process stdin, stdout and stderr only');
    }
    function output(fd,terminal=false){
        let resizeTimer=null,latest=terminal?tty.size(fd):null,notified=latest?.join(',');
        function stopResize(){if(resizeTimer!==null){clearInterval(resizeTimer);resizeTimer=null;}}
        const stream=new Writable({autoDestroy:false,emitClose:false,write(data,encoding,callback){
            try{let offset=0;while(offset<data.length){const count=binding.write(fd,data.buffer,data.byteOffset+offset,Math.min(65536,data.length-offset));if(!count)throw codedError(Error,'ERR_SYSTEM_ERROR','A stdio write made no progress');offset+=count;}process.nextTick(callback,null);}catch(e){callback(e);}
        },destroy(error,callback){stopResize();callback(error);}});
        Object.defineProperty(stream,'fd',{value:fd,enumerable:true});stream.isTTY=terminal||undefined;streams.stdioSink(stream);
        if(terminal){
            Object.setPrototypeOf(stream,WriteStream.prototype);
            function size(){const value=tty.size(fd);if(value)latest=value;return latest??[0,0];}
            Object.defineProperties(stream,{columns:{enumerable:true,get:()=>size()[0]},rows:{enumerable:true,get:()=>size()[1]}});
            stream.getWindowSize=()=>size().slice();
            stream.on('newListener',type=>{if(type==='resize'&&resizeTimer===null&&!stream.destroyed){
                resizeTimer=setInterval(()=>{const value=tty.size(fd);if(!value)return;latest=value;const key=value.join(',');if(key!==notified){notified=key;stream.emit('resize');}},100);resizeTimer.unref();
            }});
            stream.on('removeListener',type=>{if(type==='resize'&&!stream.listenerCount('resize'))stopResize();});
        }
        return stream;
    }
    function input(options={},terminal=false){
        const token=owner();let referenced=true;
        const unwatch=()=>binding.watch(null,referenced,token);
        const ready=()=>{try{const bytes=Buffer.allocUnsafe(65536),count=fs.readSync(0,bytes,0,bytes.length,null);if(!count){unwatch();stream.push(null);}else if(!stream.push(bytes.subarray(0,count)))unwatch();}catch(e){stream.destroy(e);}};
        const stream=new Readable({...options,read(){try{binding.watch(ready,referenced,token);}catch(e){this.destroy(e);}},destroy(error,callback){
            try{unwatch();if(terminal&&tty.isRaw(0,null,token))tty.raw(0,false,token);callback(error);}catch(e){callback(error??e);}
        }});
        Object.defineProperty(stream,'fd',{value:0,enumerable:true});stream.isTTY=terminal||undefined;
        const pause=stream.pause,resume=stream.resume,read=stream.read;
        stream.pause=function(){const value=pause.call(this);streams.stdioPause(this,true);unwatch();return value;};
        stream.resume=function(){streams.stdioPause(this,false);return resume.call(this);};
        stream.read=function(size){const value=read.call(this,size);streams.stdioPause(this,false);return value;};
        for(const method of ['on','addListener','once','prependListener','prependOnceListener']){
            const original=stream[method];stream[method]=function(type,...args){const value=original.call(this,type,...args);if(type==='data'||type==='readable')streams.stdioPause(this,false);return value;};
        }
        stream.ref=function(){referenced=true;binding.ref(true,token);return this;};stream.unref=function(){referenced=false;binding.ref(false,token);return this;};
        if(terminal){
            Object.setPrototypeOf(stream,ReadStream.prototype);
            Object.defineProperty(stream,'isRaw',{enumerable:true,get:()=>tty.isRaw(0,null,token)});
            stream.setRawMode=function(enabled){if(typeof enabled!=='boolean')throw invalidType('mode','a boolean');tty.raw(0,enabled,token);return this;};
        }
        return stream;
    }
    function ReadStream(fd,options={}){
        checkDescriptor(fd,[0]);if(options===null||typeof options!=='object'||Array.isArray(options))throw invalidType('options','an object');
        return input(options,true);
    }
    Object.setPrototypeOf(ReadStream.prototype,Readable.prototype);Object.setPrototypeOf(ReadStream,Readable);
    function WriteStream(fd){checkDescriptor(fd,[1,2]);return output(fd,true);}
    Object.setPrototypeOf(WriteStream.prototype,Writable.prototype);Object.setPrototypeOf(WriteStream,Writable);
    WriteStream.prototype.cursorTo=function(x,y,callback){return readlineCursorTo(this,x,y,callback);};
    WriteStream.prototype.moveCursor=function(dx,dy,callback){return readlineMoveCursor(this,dx,dy,callback);};
    WriteStream.prototype.clearLine=function(dir,callback){return readlineClearLine(this,dir,callback);};
    WriteStream.prototype.clearScreenDown=function(callback){return readlineClearScreenDown(this,callback);};
    for(const [name,create]of [['stdin',()=>input({},isatty(0))],['stdout',()=>output(1,isatty(1))],['stderr',()=>output(2,isatty(2))]])Object.defineProperty(process,name,{enumerable:true,configurable:true,get(){return cache[name]??=create();}});
    return {ReadStream,WriteStream,isatty};
}
