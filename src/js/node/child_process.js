function createChildProcess(native, process, path, fs) {
    const binding = native.childProcess, windows = native.platform === 'win32';
    const empty = new ArrayBuffer(0);
    const signalPairs = {...binding.signals};
    if (windows) signalPairs.SIGBREAK = [21,21];
    else signalPairs.SIGIOT = signalPairs.SIGABRT;
    function invalidValue(name) { return codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid value for ' + name); }
    function text(value, name, required = false) {
        if (required && typeof value !== 'string') throw invalidType(name,'a string');
        const result = `${value}`;
        if (result.includes('\0')) throw invalidValue(name);
        return Buffer.from(result).toString();
    }
    function object(value, name) {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidType(name,'an object');
        return value;
    }
    function flag(value, name) {
        if (value != null && typeof value !== 'boolean') throw invalidType(name,'a boolean');
        return !!value;
    }
    function span(value) { return [value.buffer,value.byteOffset,value.byteLength]; }
    function killSignal(value) {
        if (value == null) return signalPairs.SIGTERM[1];
        if (typeof value !== 'string' && typeof value !== 'number') throw invalidType('options.killSignal','a string or number');
        const pair = typeof value === 'string' ? signalPairs[value.toUpperCase()] :
            Object.values(signalPairs).find(pair=>pair[0]===value);
        if (!pair) throw codedError(TypeError,'ERR_UNKNOWN_SIGNAL','Unknown signal');
        return pair[1];
    }
    function signalName(value) {
        return Object.keys(binding.signals).find(name=>binding.signals[name][1]===value) ?? null;
    }
    function environment(source) {
        const values = source || process.env, entries = [], keys = [];
        for (const key in values) keys.push(key);
        if (windows) keys.sort();
        const seen = new Set();
        for (const key of keys) {
            const canonical = windows ? key.toUpperCase() : key;
            if (windows && seen.has(canonical)) continue;
            seen.add(canonical);
            const value = values[key];
            if (value === undefined) continue;
            if (windows && /^_(?:COSMO_(?:FDS(?:_V2)?|PID|PPID|STOP_CHURN|STOP_EVENT|RLIMIT)|MASK)$/i.test(key)) continue;
            entries.push([text(key,'options.env key'),text(value,'options.env value')]);
        }
        if (windows) for (const key of ['HOMEDRIVE','HOMEPATH','LOGONSERVER','PATH','SYSTEMDRIVE','SYSTEMROOT','TEMP','USERDOMAIN','USERNAME','USERPROFILE','WINDIR']) {
            if (!entries.some(entry=>entry[0].toUpperCase()===key) && process.env[key] !== undefined)
                entries.push([key,text(process.env[key],'environment')]);
        }
        return entries;
    }
    function candidates(file, cwd, env) {
        const pathEntry = env.find(entry=>windows ? entry[0].toUpperCase()==='PATH' : entry[0]==='PATH');
        if (!windows) {
            if (file.includes('/')) return [file];
            return (pathEntry?.[1] ?? '/usr/bin:/bin').split(':').map(directory=>directory ? directory.replace(/\/$/,'')+'/'+file : file);
        }
        const root = cwd === null ? process.cwd() : cwd.toString();
        const hasPath = /[\\/]/.test(file) || /^[A-Za-z]:/.test(file);
        const directories = hasPath ? [''] : ['',...(pathEntry?.[1] ?? '').split(';')];
        const name = path.win32.basename(file);
        const hasExtension = name.lastIndexOf('.') > -1;
        const suffixes = hasExtension ? ['', '.com', '.exe'] : ['.com','.exe'];
        const result = [];
        for (let directory of directories) {
            if (directory.startsWith('"') && directory.endsWith('"')) directory=directory.slice(1,-1);
            for (const suffix of suffixes) result.push(path.win32.resolve(root,directory,file+suffix));
        }
        return [...new Set(result)];
    }
    function stdio(value) {
        if (!value) value='pipe';
        if (typeof value === 'string') {
            if (!['pipe','ignore','inherit','overlapped'].includes(value)) throw invalidValue('stdio');
            value=[value,value,value];
        } else if (!Array.isArray(value)) throw invalidType('stdio','a string or Array');
        if (value.length>3) throw codedError(Error,'ERR_NOT_SUPPORTED','Extra child descriptors are not enabled');
        return [0,1,2].map(index=>{
            let mode=value[index] ?? 'pipe';
            if (mode==='ipc') throw codedError(Error,'ERR_IPC_SYNC_FORK','IPC cannot be used with synchronous child processes');
            if (mode==='pipe' || mode==='overlapped') return -1;
            if (mode==='ignore') return -2;
            if (mode==='inherit') return index;
            if (mode !== null && typeof mode==='object' && typeof mode.fd==='number') mode=mode.fd;
            if (Number.isInteger(mode) && mode>=0 && mode<=0x7fffffff) return mode;
            throw invalidValue('stdio['+index+']');
        });
    }
    function normalize(file, args, supplied) {
        file=text(file,'file',true);if (!file.length) throw invalidValue('file');
        if (Array.isArray(args)) args=args.slice();
        else if (args == null) args=[];
        else if (typeof args==='object') { supplied=args;args=[]; }
        else throw invalidType('args','an object');
        const options=supplied===undefined ? {} : {...object(supplied,'options')};
        args=args.map((value,index)=>text(value,'args['+index+']'));
        let cwd=null;
        if (options.cwd != null) {
            if (typeof options.cwd==='string') cwd=Buffer.from(text(options.cwd,'options.cwd'));
            else if (options.cwd instanceof Uint8Array) cwd=Buffer.from(options.cwd.buffer,options.cwd.byteOffset,options.cwd.byteLength);
            else throw invalidType('options.cwd','a string or Uint8Array');
            if (cwd.includes(0)) throw invalidValue('options.cwd');
            if (windows) cwd=Buffer.from(cwd.toString());
        }
        if (flag(options.detached,'options.detached')) throw codedError(Error,'ERR_NOT_SUPPORTED','Detached children are outside the synchronous subset');
        const ids=['uid','gid'].map(name=>{
            const value=options[name];if (value==null) return -1;
            if (!Number.isInteger(value) || value< -2147483648 || value>2147483647) throw invalidType('options.'+name,'int32');
            return value>>>0;
        });
        if (options.shell != null && typeof options.shell!=='boolean' && typeof options.shell!=='string') throw invalidType('options.shell','a boolean or string');
        let verbatim=flag(options.windowsVerbatimArguments,'options.windowsVerbatimArguments');
        const hide=flag(options.windowsHide,'options.windowsHide');
        let argv0=options.argv0;
        if (argv0 != null) argv0=text(argv0,'options.argv0',true);
        if (options.shell) {
            const command=[file,...args].join(' ');
            file=typeof options.shell==='string' ? text(options.shell,'options.shell') : windows ? process.env.comspec || 'cmd.exe' : '/bin/sh';
            if (windows && /^(?:.*[\\/])?cmd(?:\.exe)?$/i.test(file)) {args=['/d','/s','/c','"'+command+'"'];verbatim=true;}
            else args=['-c',command];
        }
        const argv=[argv0 ?? file,...args];
        const env=environment(options.env);
        const timeout=options.timeout==null ? 0 : options.timeout;
        if (!Number.isInteger(timeout) || timeout<0 || timeout>Number.MAX_SAFE_INTEGER) throw outOfRange('timeout');
        const maximum=Object.hasOwn(options,'maxBuffer') ? options.maxBuffer ?? 0 : 1024*1024;
        if (typeof maximum!=='number' || !(maximum>=0)) throw outOfRange('options.maxBuffer');
        const signal=killSignal(options.killSignal), io=stdio(options.stdio);
        let input=[empty,0,0];
        if (options.input) {
            let value=options.input;
            if (typeof value==='string') value=Buffer.from(value,options.encoding);
            if (!ArrayBuffer.isView(value)) throw invalidType('options.stdio[0]','a string or ArrayBufferView');
            input=span(value);
        }
        return {file,args,argv,options,cwd,env,io,input,values:[timeout,maximum,signal,+hide,+verbatim,...ids]};
    }
    function spawnSync(file, args, options) {
        const config=normalize(file,args,options);
        const result=binding.run(candidates(config.file,config.cwd,config.env),config.argv,
            config.env.map(entry=>entry.join('=')),config.cwd===null?null:span(config.cwd),config.io,config.input,config.values);
        result.signal=result.signal ? signalName(result.signal) : null;
        if (result.output) result.output=result.output.map(value=>{
            if (value===null) return null;
            const buffer=Buffer.from(value),encoding=config.options.encoding;
            return encoding && encoding!=='buffer' ? buffer.toString(encoding) : buffer;
        });
        result.stdout=result.output?.[1];result.stderr=result.output?.[2];
        if (result.error) {
            const details=result.error;
            result.error=codedError(Error,details.code,'spawnSync '+config.file+' '+details.code);
            Object.assign(result.error,{errno:details.errno,syscall:'spawnSync '+config.file,path:config.file,spawnargs:config.args});
        }
        return result;
    }
    function forwardStderr(value) {
        if (value==null) return;
        const buffer=typeof value==='string'?Buffer.from(value):value;
        let offset=0;while(offset<buffer.length) {const count=fs.writeSync(2,buffer,offset,buffer.length-offset);if (!count) break;offset+=count;}
    }
    function checked(result, label) {
        if (result.error) {Object.assign(result.error,result);throw result.error;}
        if (result.status!==0) throw Object.assign(new Error('Command failed: '+label+(result.stderr?.length?'\n'+result.stderr.toString():'')),result);
        return result.stdout;
    }
    function execFileSync(file, args, options) {
        if (args!=null && typeof args==='object' && !Array.isArray(args)) {options=args;args=[];}
        args ??=[];options ??={};
        const result=spawnSync(file,args,options);
        if (!options.stdio) forwardStderr(result.stderr);
        return checked(result,[options.argv0 || file,...args].join(' '));
    }
    function execSync(command, options) {
        command=text(command,'command',true);options=options==null?{}:{...object(options,'options')};
        const result=spawnSync(command,[],{...options,shell:typeof options.shell==='string'?options.shell:true});
        if (!options.stdio) forwardStderr(result.stderr);
        return checked(result,command);
    }
    return {spawnSync,execFileSync,execSync};
}
