function readlineOutput(stream){if(!stream||typeof stream.write!=='function')throw invalidType('stream','a Writable');return stream;}
function readlineClearLine(stream,dir,callback){
    readlineOutput(stream);if(![-1,0,1].includes(dir))throw codedError(TypeError,'ERR_INVALID_ARG_VALUE','dir must be -1, 0 or 1');
    return stream.write('\x1b['+(dir<0?'1':dir>0?'0':'2')+'K',callback);
}
function readlineClearScreenDown(stream,callback){return readlineOutput(stream).write('\x1b[0J',callback);}
function readlineCursorTo(stream,x,y,callback){
    readlineOutput(stream);if(typeof y==='function'){callback=y;y=undefined;}
    integer(x,'x',0,0x7fffffff);if(y!==undefined)integer(y,'y',0,0x7fffffff);
    return stream.write('\x1b['+(y===undefined?(x+1)+'G':(y+1)+';'+(x+1)+'H'),callback);
}
function readlineMoveCursor(stream,dx,dy,callback){
    readlineOutput(stream);integer(dx,'dx',-0x7fffffff,0x7fffffff);integer(dy,'dy',-0x7fffffff,0x7fffffff);
    let text='';if(dx)text+='\x1b['+Math.abs(dx)+(dx<0?'D':'C');if(dy)text+='\x1b['+Math.abs(dy)+(dy<0?'A':'B');
    return stream.write(text,callback);
}
function createReadline(process,streams){
    const LINE_LIMIT=65536,QUEUE_LIMIT=64,HISTORY_LIMIT=1000;
    const states=instanceState('readline.interface'),keyState=Symbol('readline.keys'),terminalOwner=Symbol('readline.terminalOwner');
    const now=()=>Number(process.hrtime.bigint()/1000000n);
    const abortError=signal=>{const error=codedError(Error,'ABORT_ERR','The operation was aborted');error.name='AbortError';error.cause=signal.reason;return error;};
    function state(iface){const s=states.get(iface);if(!s)throw invalidType('this','a readline Interface');return s;}
    function signalOption(signal){if(signal!==undefined&&(!signal||typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))throw invalidType('options.signal','an AbortSignal');return signal;}
    function simpleKey(character,meta=false,sequence=character){
        const code=character.codePointAt(0),key={sequence,name:undefined,ctrl:false,meta,shift:false};
        const names={13:'return',10:'enter',9:'tab',127:'backspace',8:'backspace',32:'space'};
        if(names[code])key.name=names[code];
        else if(code<=26){key.name=String.fromCharCode(code+96);key.ctrl=true;}
        else if(code>=28&&code<=31){key.name=String.fromCharCode(code+64).toLowerCase();key.ctrl=true;}
        else if(/^[a-zA-Z0-9]$/.test(character)){key.name=character.toLowerCase();key.shift=character!==key.name;}
        return [meta?undefined:character,key];
    }
    function escapeKey(sequence){
        const key={sequence,name:undefined,ctrl:false,meta:false,shift:false,code:sequence.slice(1)};
        if(sequence==='\x1b'){key.name='escape';key.meta=true;return [undefined,key];}
        const letters={A:'up',B:'down',C:'right',D:'left',H:'home',F:'end',P:'f1',Q:'f2',R:'f3',S:'f4',Z:'tab'};
        const numbers={1:'home',2:'insert',3:'delete',4:'end',5:'pageup',6:'pagedown',7:'home',8:'end',11:'f1',12:'f2',13:'f3',14:'f4',15:'f5',17:'f6',18:'f7',19:'f8',20:'f9',21:'f10',23:'f11',24:'f12'};
        const linux=/^\x1b\[\[([A-E])$/.exec(sequence);
        if(linux)key.name='f'+(linux[1].charCodeAt(0)-64);
        else {
            const match=/^\x1b(?:\[|O)(?:(\d+)(?:;(\d+))?)?([A-Za-z~])$/.exec(sequence);
            if(match){
                key.name=match[3]==='~'?numbers[match[1]]:letters[match[3]];
                const modifier=(Number(match[2]??1)-1);key.shift=!!(modifier&1)||match[3]==='Z';key.meta=!!(modifier&2);key.ctrl=!!(modifier&4);
            }
        }
        return [undefined,key];
    }
    function emitKeypressEvents(input,iface){
        if(!input||typeof input.on!=='function'||typeof input.removeListener!=='function')throw invalidType('stream','a Readable');
        if(input[keyState])return;
        const delay=iface?state(iface).escapeCodeTimeout:500;
        const k={active:false,pending:'',timer:null,decoder:streams.decoder('utf8')};
        Object.defineProperty(input,keyState,{value:k});
        function cancel(){if(k.timer!==null){clearTimeout(k.timer);k.timer=null;}}
        function emit(value){input.emit('keypress',...value);}
        function flush(){cancel();const pending=k.pending;k.pending='';if(pending)emit(escapeKey(pending));}
        function schedule(){cancel();k.timer=setTimeout(flush,delay);k.timer.unref();}
        function text(value){
            for(const character of value){
                if(!input.listenerCount('keypress'))break;
                if(!k.pending){if(character==='\x1b'){k.pending=character;schedule();}else emit(simpleKey(character));continue;}
                if(k.pending==='\x1b'){
                    if(character==='['||character==='O'){k.pending+=character;schedule();continue;}
                    if(character==='\x1b'){flush();k.pending=character;schedule();continue;}
                    const sequence=k.pending+character;k.pending='';cancel();emit(simpleKey(character,true,sequence));continue;
                }
                k.pending+=character;
                if(k.pending.length>64){k.pending='';cancel();throw codedError(Error,'ERR_READLINE_INPUT_LIMIT','Escape sequence exceeds 64 characters');}
                if(/[A-Za-z~]/.test(character)){const sequence=k.pending;k.pending='';cancel();emit(escapeKey(sequence));}else schedule();
            }
        }
        const data=chunk=>text(typeof chunk==='string'?chunk:k.decoder.write(chunk));
        function stop(){cancel();k.pending='';if(k.active){k.active=false;input.removeListener('data',data);}if(!input.listenerCount('data'))input.pause?.();}
        input.on('newListener',type=>{if(type==='keypress'&&!k.active){k.active=true;input.on('data',data);}});
        input.on('removeListener',type=>{if(type==='keypress'&&!input.listenerCount('keypress'))stop();});
        input.on('end',()=>{text(k.decoder.end());flush();stop();});
        if(input.listenerCount('keypress')){k.active=true;input.on('data',data);}
    }
    function options(input,output,completer,terminal){
        const opts=input&&typeof input==='object'&&('input'in input||typeof input.on!=='function')?input:{input,output,completer,terminal};
        if(!opts||!opts.input||typeof opts.input.on!=='function'||typeof opts.input.pause!=='function'||typeof opts.input.resume!=='function')throw invalidType('input','a Readable');
        if(opts.output!==undefined)readlineOutput(opts.output);
        if(opts.completer!=null)throw codedError(Error,'ERR_NOT_SUPPORTED','Completion is outside the declared readline subset');
        return opts;
    }
    function pendingDone(s){const pending=s.question;if(pending){s.question=null;pending.signal?.removeEventListener('abort',pending.abort);s.prompt=pending.prompt;}return pending;}
    function question(iface,query,opts,callback,reject){
        const s=state(iface);if(s.closed)throw codedError(Error,'ERR_USE_AFTER_CLOSE','readline was closed');
        if(typeof query!=='string')throw invalidType('query','a string');if(typeof callback!=='function')throw invalidType('callback','a function');
        if(opts===undefined)opts={};if(opts===null||typeof opts!=='object')throw invalidType('options','an object');
        const signal=signalOption(opts.signal);if(signal?.aborted){if(reject)reject(abortError(signal));return;}
        if(s.question)throw codedError(Error,'ERR_READLINE_QUESTION_ACTIVE','Only one question may be pending');
        const pending={callback,reject,signal,prompt:s.prompt,abort:null};s.question=pending;
        pending.abort=()=>{if(s.question!==pending)return;pendingDone(s);s.line='';s.cursor=0;if(s.terminal)s.output?.write('\r\n');if(reject)reject(abortError(signal));};
        signal?.addEventListener('abort',pending.abort,{once:true});
        if(s.terminal){s.prompt=query;iface._render();}else s.output?.write(query);
        iface.resume();
    }
    class Interface extends EventEmitter {
        constructor(input,output,completer,terminal){
            super();const opts=options(input,output,completer,terminal),historySize=opts.historySize??30;
            integer(historySize,'historySize',0,HISTORY_LIMIT);
            const escapeCodeTimeout=opts.escapeCodeTimeout??500;integer(escapeCodeTimeout,'escapeCodeTimeout',0,5000);
            const crlfDelay=opts.crlfDelay===Infinity?Infinity:Math.max(100,opts.crlfDelay??100);
            if(!(crlfDelay>=100))throw outOfRange('crlfDelay');
            const prompt=opts.prompt??'> ';if(typeof prompt!=='string')throw invalidType('prompt','a string');
            const history=opts.history??[];if(!Array.isArray(history)||history.some(x=>typeof x!=='string'))throw invalidType('history','an array of strings');
            const s={input:opts.input,output:opts.output,terminal:opts.terminal??!!opts.output?.isTTY,closed:false,paused:false,ended:false,line:'',cursor:0,
                prompt,question:null,history:history.slice(0,historySize),historySize,historyIndex:-1,savedLine:'',removeDuplicates:!!opts.removeHistoryDuplicates,
                decoder:streams.decoder('utf8'),partial:'',skipLF:false,lastCR:0,crlfDelay,escapeCodeTimeout,rawWas:false,rawSet:false,
                iterator:false,iteratorPaused:false,queue:[],waiters:[],error:null,renderPending:false,renderScheduled:false};
            if(s.terminal&&!s.output)throw invalidType('output','a Writable for terminal mode');
            if(s.terminal&&s.input[terminalOwner])throw codedError(Error,'ERR_READLINE_BUSY','Only one terminal interface may own an input');
            states.set(this,s);
            Object.defineProperties(this,{input:{value:s.input},output:{value:s.output},terminal:{value:s.terminal,enumerable:true},
                closed:{enumerable:true,get:()=>s.closed},line:{enumerable:true,get:()=>s.line,set:value=>{if(typeof value!=='string')throw invalidType('line','a string');this._limit(value.length);s.line=value;s.cursor=Math.min(s.cursor,value.length);}},
                cursor:{enumerable:true,get:()=>s.cursor,set:value=>{integer(value,'cursor',0,s.line.length);s.cursor=value;}},
                history:{enumerable:true,get:()=>s.history}});
            s.onData=chunk=>{if(s.closed)return;const text=typeof chunk==='string'?chunk:s.decoder.write(chunk);s.partial+=text;this._pump();};
            s.onEnd=()=>{if(s.closed)return;s.ended=true;if(!s.terminal)s.partial+=s.decoder.end();this._pump();};
            s.onError=error=>{s.error=error;this.close();for(const waiter of s.waiters.splice(0))waiter.reject(error);this.emit('error',error);};
            s.onKey=(character,key)=>{if(!s.closed)this._key(character,key);};s.onResize=()=>this._requestRender();
            try{
                s.input.on('error',s.onError);s.input.on('end',s.onEnd);
                if(s.terminal){
                    Object.defineProperty(s.input,terminalOwner,{value:this,writable:true,configurable:true});
                    if(typeof s.input.setRawMode==='function'){s.rawWas=!!s.input.isRaw;s.input.setRawMode(true);s.rawSet=true;}
                    emitKeypressEvents(s.input,this);s.input.on('keypress',s.onKey);s.output.on?.('resize',s.onResize);
                }else s.input.on('data',s.onData);
                s.input.resume();
            }catch(error){this.close();throw error;}
        }
        _limit(length){if(length>LINE_LIMIT)throw codedError(Error,'ERR_READLINE_INPUT_LIMIT','Line exceeds 64 KiB characters');}
        _line(line){
            const s=state(this);if(s.closed)return;this._limit(line.length);s.line='';s.cursor=0;s.historyIndex=-1;s.savedLine='';
            if(s.terminal&&s.historySize&&line.trim()&&s.history[0]!==line){if(s.removeDuplicates)s.history=s.history.filter(x=>x!==line);s.history.unshift(line);s.history.length=Math.min(s.history.length,s.historySize);this.emit('history',s.history);}
            const pending=pendingDone(s);if(pending){pending.callback(line);return;}
            if(s.iterator){if(s.waiters.length)s.waiters.shift().resolve({value:line,done:false});else{s.queue.push(line);if(s.queue.length>=QUEUE_LIMIT){s.iteratorPaused=true;s.input.pause();}}}
            this.emit('line',line);
        }
        _pump(){
            const s=state(this);if(s.closed||s.paused||s.iteratorPaused)return;
            if(!s.terminal){
                while(s.partial.length&&!s.closed&&!s.paused&&!s.iteratorPaused){
                    if(s.skipLF){s.skipLF=false;if(s.partial[0]==='\n'&&now()-s.lastCR<=s.crlfDelay){s.partial=s.partial.slice(1);continue;}}
                    const boundary=s.partial.search(/[\r\n]/);
                    if(boundary<0){this._limit(s.line.length+s.partial.length);s.line+=s.partial;s.cursor=s.line.length;s.partial='';break;}
                    this._limit(s.line.length+boundary);const line=s.line+s.partial.slice(0,boundary),separator=s.partial[boundary];s.partial=s.partial.slice(boundary+1);
                    if(separator==='\r'){s.skipLF=true;s.lastCR=now();}
                    this._line(line);
                }
            }
            if(s.ended&&!s.closed&&!s.iteratorPaused&&!s.paused){if(s.line.length)this._line(s.line);if(!s.iteratorPaused)this.close();}
        }
        _requestRender(){
            const s=state(this);if(!s.terminal||s.closed)return;s.renderPending=true;if(s.renderScheduled)return;s.renderScheduled=true;
            process.nextTick(()=>{s.renderScheduled=false;if(!s.closed&&s.renderPending){s.renderPending=false;this._render();}});
        }
        _render(){
            const s=state(this);if(!s.terminal||!s.output||s.closed)return;s.renderPending=false;
            readlineCursorTo(s.output,0);readlineClearLine(s.output,0);s.output.write(s.prompt+s.line);readlineCursorTo(s.output,s.prompt.length+s.cursor);
        }
        _key(character,key={}){
            const s=state(this);if(s.closed)return;
            if(s.skipLF){s.skipLF=false;if(key.name==='enter'&&now()-s.lastCR<=s.crlfDelay)return;}
            if(key.ctrl&&key.name==='c'){if(this.listenerCount('SIGINT'))this.emit('SIGINT');else this.close();return;}
            if(key.ctrl&&key.name==='d'){
                if(!s.line.length){this.close();return;}
                if(s.cursor<s.line.length)s.line=s.line.slice(0,s.cursor)+s.line.slice(s.cursor+1);this._requestRender();return;
            }
            if(key.name==='return'||key.name==='enter'){
                if(key.name==='return'){s.skipLF=true;s.lastCR=now();}
                this._render();s.output?.write('\r\n');this._line(s.line);return;
            }
            if(key.ctrl){
                if(key.name==='a')s.cursor=0;else if(key.name==='e')s.cursor=s.line.length;
                else if(key.name==='u'){s.line=s.line.slice(s.cursor);s.cursor=0;}
                else if(key.name==='k')s.line=s.line.slice(0,s.cursor);
                else if(key.name==='w'){const before=s.line.slice(0,s.cursor),start=before.replace(/\s*\S+\s*$/,'').length;s.line=s.line.slice(0,start)+s.line.slice(s.cursor);s.cursor=start;}
                else return;
            }else if(key.name==='left')s.cursor=Math.max(0,s.cursor-1);
            else if(key.name==='right')s.cursor=Math.min(s.line.length,s.cursor+1);
            else if(key.name==='home')s.cursor=0;else if(key.name==='end')s.cursor=s.line.length;
            else if(key.name==='backspace'){if(s.cursor){s.line=s.line.slice(0,s.cursor-1)+s.line.slice(s.cursor);s.cursor--;}}
            else if(key.name==='delete'){if(s.cursor<s.line.length)s.line=s.line.slice(0,s.cursor)+s.line.slice(s.cursor+1);}
            else if(key.name==='up'||key.name==='down'){
                if(key.name==='up'){if(s.historyIndex<0)s.savedLine=s.line;s.historyIndex=Math.min(s.history.length-1,s.historyIndex+1);}
                else s.historyIndex=Math.max(-1,s.historyIndex-1);
                s.line=s.historyIndex<0?s.savedLine:s.history[s.historyIndex]??'';this._limit(s.line.length);s.cursor=s.line.length;
            }else if(character&&!key.meta&&character>=' '&&character!=='\x7f'){
                this._limit(s.line.length+character.length);s.line=s.line.slice(0,s.cursor)+character+s.line.slice(s.cursor);s.cursor+=character.length;
            }else return;
            this._requestRender();
        }
        setPrompt(prompt){if(typeof prompt!=='string')throw invalidType('prompt','a string');state(this).prompt=prompt;}
        getPrompt(){return state(this).prompt;}
        prompt(preserveCursor=false){const s=state(this);if(s.closed)return;if(!preserveCursor)s.cursor=0;this.resume();if(s.terminal)this._render();else s.output?.write(s.prompt);}
        pause(){const s=state(this);if(!s.paused&&!s.closed){s.paused=true;s.input.pause();this.emit('pause');}return this;}
        resume(){const s=state(this);if(s.closed)return this;if(s.paused){s.paused=false;this.emit('resume');}this._pump();if(!s.closed&&!s.iteratorPaused)s.input.resume();return this;}
        write(data,key){const s=state(this);if(s.closed)return;this.resume();if(s.closed)return;if(key&&s.terminal)this._key(data,key);else if(data!==null&&data!==undefined){if(typeof data!=='string'&&!Buffer.isBuffer(data))throw invalidType('data','a string or Buffer');if(s.terminal){const text=typeof data==='string'?data:data.toString('utf8');for(const character of text)this._key(...simpleKey(character));}else s.onData(data);} }
        question(query,opts,callback){if(typeof opts==='function'){callback=opts;opts=undefined;}question(this,query,opts,callback);}
        close(){
            const s=state(this);if(s.closed||s.closing)return;s.closing=true;this.pause();s.closed=true;s.renderPending=false;
            s.input.removeListener('data',s.onData);s.input.removeListener('keypress',s.onKey);s.input.removeListener('end',s.onEnd);s.input.removeListener('error',s.onError);
            s.output?.removeListener?.('resize',s.onResize);s.input.pause();
            let failure;
            if(s.terminal){if(s.input[terminalOwner]===this)delete s.input[terminalOwner];if(s.rawSet)try{s.input.setRawMode(s.rawWas);}catch(error){failure=error;}}
            const pending=pendingDone(s);if(pending?.reject)pending.reject(codedError(Error,'ERR_USE_AFTER_CLOSE','readline was closed'));
            for(const waiter of s.waiters.splice(0)){if(s.error)waiter.reject(s.error);else waiter.resolve({value:undefined,done:true});}
            s.partial='';this.emit('close');if(failure)this.emit('error',failure);
        }
        [Symbol.asyncIterator](){
            const iface=this,s=state(this);s.iterator=true;
            if(s.iteratorObject)return s.iteratorObject;
            return s.iteratorObject={
                [Symbol.asyncIterator](){return this;},
                next(){
                    if(s.error)return Promise.reject(s.error);
                    if(s.queue.length){const value=s.queue.shift();if(s.iteratorPaused&&s.queue.length<QUEUE_LIMIT/2){s.iteratorPaused=false;iface._pump();if(!s.closed&&!s.paused&&!s.iteratorPaused)s.input.resume();}return Promise.resolve({value,done:false});}
                    if(s.closed)return Promise.resolve({value:undefined,done:true});
                    if(s.waiters.length>=QUEUE_LIMIT)return Promise.reject(codedError(Error,'ERR_READLINE_INPUT_LIMIT','Too many pending line requests'));
                    return new Promise((resolve,reject)=>s.waiters.push({resolve,reject}));
                },
                return(){iface.close();return Promise.resolve({value:undefined,done:true});},
                throw(error){iface.close();return Promise.reject(error);}
            };
        }
    }
    if(Symbol.dispose)Interface.prototype[Symbol.dispose]=Interface.prototype.close;
    class PromiseInterface extends Interface {
        question(query,opts){return new Promise((resolve,reject)=>question(this,query,opts,resolve,reject));}
    }
    const promises={Interface:PromiseInterface,createInterface:(...args)=>new PromiseInterface(...args)};
    const api={Interface,createInterface:(...args)=>new Interface(...args),emitKeypressEvents,cursorTo:readlineCursorTo,moveCursor:readlineMoveCursor,clearLine:readlineClearLine,clearScreenDown:readlineClearScreenDown,promises};
    return {api,promises};
}
