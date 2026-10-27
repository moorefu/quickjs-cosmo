function createFs(native, path) {
    const binding = native.fs, windows = native.platform === 'win32';
    const constants = Object.freeze({...binding.constants});
    const maxIO = 0x7fffffff, types = new WeakMap();
    function invalidValue(name) { return codedError(TypeError, 'ERR_INVALID_ARG_VALUE', 'Invalid ' + name); }
    function options(value, defaults = {}) {
        if (value == null) return {...defaults};
        if (typeof value === 'string') return {...defaults, encoding: value};
        if (typeof value !== 'object') throw invalidType('options', 'an object or encoding');
        return {...defaults, ...value};
    }
    function boolean(value, name) { if (typeof value !== 'boolean') throw invalidType(name, 'a boolean'); return value; }
    function encoding(value, fallback = null, allowBuffer = false) {
        if (value == null || value === '') return fallback;
        if (allowBuffer && value === 'buffer') return value;
        if (typeof value !== 'string' || !Buffer.isEncoding(value)) throw invalidValue('encoding');
        return value;
    }
    function fd(value) { return integer(value, 'fd', 0, 0x7fffffff); }
    function isFd(value) { return typeof value==='number' && (value|0)===value; }
    function mode(value, fallback) {
        if (value === undefined) return fallback;
        if (typeof value === 'string') {
            if (!/^[0-7]+$/.test(value)) throw invalidValue('mode');
            value = parseInt(value, 8);
        }
        return integer(value, 'mode', 0, 0xffffffff);
    }
    function flags(value) {
        if (typeof value === 'number') return integer(value, 'flags', -0x80000000, 0x7fffffff);
        if (value == null) return constants.O_RDONLY;
        const c = constants, sync = c.O_SYNC || 0;
        const table = {r:c.O_RDONLY, 'r+':c.O_RDWR, rs:c.O_RDONLY|sync, sr:c.O_RDONLY|sync,
            'rs+':c.O_RDWR|sync, 'sr+':c.O_RDWR|sync,
            w:c.O_TRUNC|c.O_CREAT|c.O_WRONLY, 'w+':c.O_TRUNC|c.O_CREAT|c.O_RDWR,
            wx:c.O_TRUNC|c.O_CREAT|c.O_WRONLY|c.O_EXCL, xw:c.O_TRUNC|c.O_CREAT|c.O_WRONLY|c.O_EXCL,
            'wx+':c.O_TRUNC|c.O_CREAT|c.O_RDWR|c.O_EXCL, 'xw+':c.O_TRUNC|c.O_CREAT|c.O_RDWR|c.O_EXCL,
            a:c.O_APPEND|c.O_CREAT|c.O_WRONLY, 'a+':c.O_APPEND|c.O_CREAT|c.O_RDWR,
            ax:c.O_APPEND|c.O_CREAT|c.O_WRONLY|c.O_EXCL, xa:c.O_APPEND|c.O_CREAT|c.O_WRONLY|c.O_EXCL,
            'ax+':c.O_APPEND|c.O_CREAT|c.O_RDWR|c.O_EXCL, 'xa+':c.O_APPEND|c.O_CREAT|c.O_RDWR|c.O_EXCL,
            as:c.O_APPEND|c.O_CREAT|c.O_WRONLY|sync, sa:c.O_APPEND|c.O_CREAT|c.O_WRONLY|sync,
            'as+':c.O_APPEND|c.O_CREAT|c.O_RDWR|sync, 'sa+':c.O_APPEND|c.O_CREAT|c.O_RDWR|sync};
        if (typeof value !== 'string' || !Object.hasOwn(table, value)) throw invalidValue('flags');
        return table[value];
    }
    function fileURL(value) {
        // A host-provided URL constructor is usable before the URL milestone.
        if (typeof globalThis.URL !== 'function' || !(value instanceof globalThis.URL)) return null;
        if (value.protocol !== 'file:') throw codedError(TypeError, 'ERR_INVALID_URL_SCHEME', 'Expected file URL');
        if (!windows && value.hostname && value.hostname !== 'localhost')
            throw codedError(TypeError, 'ERR_INVALID_FILE_URL_HOST', 'Unexpected file URL host');
        if (/%2f/i.test(value.pathname) || (windows && /%5c/i.test(value.pathname)))
            throw codedError(TypeError, 'ERR_INVALID_FILE_URL_PATH', 'Encoded path separator');
        let name = decodeURIComponent(value.pathname);
        if (windows) {
            if (value.hostname && value.hostname !== 'localhost') name = '\\\\' + value.hostname + name.replace(/\//g, '\\');
            else {
                if (!/^\/[A-Za-z]:/.test(name)) throw codedError(TypeError, 'ERR_INVALID_FILE_URL_PATH', 'Expected absolute drive');
                name = name.slice(1).replace(/\//g, '\\');
            }
        }
        return name;
    }
    function bytes(value, name = 'path') {
        const url = value && typeof value === 'object' ? fileURL(value) : null;
        if (url !== null) value = url;
        if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw invalidType(name, 'a string, Buffer or URL');
        let result = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value.buffer,value.byteOffset,value.byteLength);
        if (windows) result=Buffer.from(result.toString());
        if (result.includes(0)) throw invalidValue(name);
        return result;
    }
    function display(value) { return value.toString(); }
    function pathCall(fn, a, b, ...args) {
        try { return b === undefined ? fn(a, ...args) : fn(a, b, ...args); }
        catch (error) {
            if (error && typeof error === 'object' && typeof error.errno === 'number') {
                error.path = display(a); if (b !== undefined) error.dest = display(b);
            }
            throw error;
        }
    }
    function fail(code, syscall, a) { return pathCall(() => binding.error(code, syscall), a); }
    function join(a, b) { return Buffer.concat([a, Buffer.from(windows ? '\\' : '/'), b]); }
    function parent(a) {
        if (windows) return Buffer.from(path.dirname(display(a)));
        let end=a.length; while (end>1 && a[end-1]===47) end--;
        let index=end-1; while (index>=0 && a[index]!==47) index--;
        return index<0 ? Buffer.from('.') : a.subarray(0,index||1);
    }
    function view(value, name = 'buffer') {
        if (!ArrayBuffer.isView(value)) throw invalidType(name, 'a Buffer, TypedArray or DataView');
        if (value.byteLength===0) return value;
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    function position(value, length, big = true) {
        if (value == null) return -1;
        if (typeof value === 'bigint' && big) {
            if (value < -1n || value > (1n << 63n) - 1n - BigInt(length)) throw outOfRange('position');
            return value;
        }
        return integer(value, 'position', -1, Number.MAX_SAFE_INTEGER);
    }
    class StatBase {
        isFile() { return this._checkModeProperty(0x8000); }
        isDirectory() { return this._checkModeProperty(0x4000); }
        isBlockDevice() { return this._checkModeProperty(0x6000); }
        isCharacterDevice() { return this._checkModeProperty(0x2000); }
        isSymbolicLink() { return this._checkModeProperty(0xa000); }
        isFIFO() { return this._checkModeProperty(0x1000); }
        isSocket() { return this._checkModeProperty(0xc000); }
    }
    for (const name of ['atime','mtime','ctime','birthtime']) Object.defineProperty(StatBase.prototype,name,{
        configurable:true,enumerable:true,
        get() { const value=new Date(Math.round(Number(this[name+'Ms']))); Object.defineProperty(this,name,{value,writable:true,enumerable:true,configurable:true}); return value; },
        set(value) { Object.defineProperty(this,name,{value,writable:true,enumerable:true,configurable:true}); }
    });
    class Stats extends StatBase {
        constructor(...args) {
            super();
            ['dev','mode','nlink','uid','gid','rdev','blksize','ino','size','blocks','atimeMs','mtimeMs','ctimeMs','birthtimeMs'].forEach((key,i)=>this[key]=args[i]);
        }
        _checkModeProperty(type) { return windows&&[0x1000,0x6000,0xc000].includes(type)?false:(this.mode&0xf000)===type; }
    }
    class BigIntStats extends StatBase {
        _checkModeProperty(type) { return windows&&[0x1000,0x6000,0xc000].includes(type)?false:(this.mode&0xf000n)===BigInt(type); }
    }
    function makeStats(raw, big) {
        const value = Object.create(big ? BigIntStats.prototype : Stats.prototype);
        for (const name of ['dev','mode','nlink','uid','gid','rdev','blksize','ino','size','blocks'])
            value[name] = big ? raw[name] : Number(raw[name]);
        const timeNames=['atime','mtime','ctime','birthtime'];
        for (const name of timeNames) {
            const ns = raw[name][0] * 1000000000n + BigInt(raw[name][1]);
            value[name + 'Ms'] = big ? ns / 1000000n : Number(raw[name][0]) * 1000 + raw[name][1] / 1e6;


        }
        if (big) for (const name of timeNames) value[name+'Ns']=raw[name][0]*1000000000n+BigInt(raw[name][1]);
        return value;
    }
    class Dirent {
        constructor(name, type, parentPath) { this.name=name; this.parentPath=parentPath; types.set(this,type); }
        get path() { return this.parentPath; }
        isFile() { return types.get(this)===1; }
        isDirectory() { return types.get(this)===2; }
        isBlockDevice() { return types.get(this)===7; }
        isCharacterDevice() { return types.get(this)===6; }
        isSymbolicLink() { return types.get(this)===3; }
        isFIFO() { return types.get(this)===4; }
        isSocket() { return types.get(this)===5; }
    }
    function stat(pathValue, opts, kind) {
        if (opts === null) throw new TypeError('Cannot read stat options');
        opts = opts ?? {};
        const name = kind===2 ? fd(pathValue) : bytes(pathValue);
        try {
            const raw = kind===2 ? binding.stat(name,kind) : pathCall(binding.stat,name,undefined,kind);
            return makeStats(raw,Boolean(opts.bigint));
        } catch (error) { if (kind!==2 && opts.throwIfNoEntry===false && error.code==='ENOENT') return undefined; throw error; }
    }
    function openSync(name, flag, permissions) {
        return pathCall(binding.open,bytes(name),undefined,flags(flag),mode(permissions,0o666));
    }
    function closeSync(number) { binding.close(fd(number)); }
    function readSync(number, buffer, offsetOrOptions, length, where) {
        const data = view(buffer); let offset = offsetOrOptions;
        if (arguments.length<=3 || typeof offsetOrOptions==='object') {
            if (offsetOrOptions!=null && typeof offsetOrOptions!=='object') throw invalidType('options','an object');
            ({offset=0,length=data.byteLength-offset,position:where=null}=offsetOrOptions??{});
        }
        offset=offset===undefined?0:integer(offset,'offset',0,Number.MAX_SAFE_INTEGER);
        length|=0; where=position(where,length);
        if (!length) return 0;
        if (!data.byteLength) throw invalidValue('buffer');
        if (length<0 || offset+length>data.byteLength) throw outOfRange('length');
        return binding.read(fd(number),data.buffer,data.byteOffset+offset,length,where);
    }
    function writeSync(number, buffer, offsetOrOptions, length, where) {
        let data, offset=offsetOrOptions;
        if (typeof buffer==='string') {
            const enc=typeof length==='string'&&Buffer.isEncoding(length)?length:'utf8';
            if (enc.toLowerCase()==='hex' && buffer.length%2) throw invalidValue('encoding');
            data=Buffer.from(buffer,enc);
            where=typeof offset==='number'&&Number.isFinite(offset)?Math.trunc(offset):-1; offset=0; length=data.byteLength;
        } else {
            data=view(buffer);
            if (typeof offset==='object') ({offset=0,length=data.byteLength-offset,position:where=null}=offsetOrOptions??{});
            offset=offset==null?0:integer(offset,'offset',0,Number.MAX_SAFE_INTEGER);
            if (typeof length!=='number') length=data.byteLength-offset;
            if (offset>data.byteLength) throw outOfRange('offset');
            integer(length,'length',0,Math.min(maxIO,data.byteLength-offset));
            // writeBuffer accepts a numeric position; other values select the cursor.
            where=typeof where==='number'&&Number.isFinite(where)?Math.trunc(where):-1;
        }
        return binding.write(fd(number),data.buffer,data.byteOffset+offset,length,where);
    }
    function readFileSync(name, opts) {
        opts=options(opts,{flag:'r'}); const enc=encoding(opts.encoding);
        if (opts.buffer!==undefined && typeof opts.buffer!=='function' && !ArrayBuffer.isView(opts.buffer))
            throw invalidType('options.buffer','an ArrayBufferView or function');
        const fastUtf8=(enc==='utf8'||enc==='utf-8')&&opts.buffer===undefined;
        const owned=!isFd(name), number=owned?openSync(name,opts.flag):fastUtf8?name:fd(name);
        if (!owned && fastUtf8) flags(opts.flag);
        try {
            let s;
            try { s=fastUtf8?makeStats(binding.stat(number,2),false):stat(number,undefined,2); }
            catch (error) { if (!fastUtf8 || typeof error?.errno!=='number') throw error; }
            const size=fastUtf8?0:s.isFile()?s.size:0;
            if (s?.isDirectory()) binding.error('EISDIR','read');
            if (size>maxIO) throw codedError(RangeError,'ERR_FS_FILE_TOO_LARGE','File exceeds maximum read size');
            let storage=typeof opts.buffer==='function'?opts.buffer(size):opts.buffer;
            if (typeof opts.buffer==='function') view(storage,'options.buffer()');
            if (storage!==undefined) storage=Buffer.from(view(storage,'options.buffer').buffer,storage.byteOffset,storage.byteLength);
            if (storage && storage.byteLength<size) throw invalidValue('options.buffer.byteLength');
            const chunks=[]; let total=0;
            if (storage || size) {
                const target=storage??Buffer.allocUnsafe(size), limit=size||target.length;
                while (total<limit) { const n=readSync(number,target,total,limit-total); if (!n) break; total+=n; }
                if (storage && !size && total===target.length && readSync(number,Buffer.alloc(1),0,1)) throw invalidValue('options.buffer.byteLength');
                const answer=target.subarray(0,total); return enc?answer.toString(enc):answer;
            }
            for (;;) {
                const chunk=Buffer.allocUnsafe(Math.min(8192,maxIO-total));
                if (!chunk.length) {
                    const last=Buffer.alloc(1);
                    if (fastUtf8?binding.read(number,last.buffer,last.byteOffset,1,-1):readSync(number,last,0,1)) throw codedError(RangeError,'ERR_FS_FILE_TOO_LARGE','File exceeds maximum read size');
                    break;
                }
                const n=fastUtf8?binding.read(number,chunk.buffer,chunk.byteOffset,chunk.length,-1):readSync(number,chunk,0,chunk.length); if (!n) break;
                total+=n; chunks.push(chunk.subarray(0,n));
            }
            const answer=Buffer.concat(chunks,total); return enc?answer.toString(enc):answer;
        } finally { if (owned) closeSync(number); }
    }
    function writeFileSync(name, data, opts) {
        opts=options(opts,{encoding:'utf8',mode:0o666,flag:'w',flush:false});
        const enc=encoding(opts.encoding,'utf8'); boolean(opts.flush??false,'options.flush');
        const fastUtf8=typeof data==='string'&&(enc==='utf8'||enc==='utf-8');
        const buffer=typeof data==='string'?Buffer.from(data,enc):view(data,'data');
        const owned=!isFd(name), number=owned?openSync(name,opts.flag||'w',opts.mode):name;
        if (!owned && fastUtf8) { flags(opts.flag||'w'); mode(opts.mode,0o666); }
        try {
            let offset=0;
            while (offset<buffer.byteLength) {
                const count=fastUtf8?binding.write(number,buffer.buffer,buffer.byteOffset+offset,Math.min(maxIO,buffer.byteLength-offset),-1):
                    writeSync(number,buffer,offset,Math.min(maxIO,buffer.byteLength-offset));
                if (!count) binding.error('EIO','write'); offset+=count;
            }
            if (opts.flush) binding.sync(fd(number));
        } finally { if (owned) closeSync(number); }
    }
    function mkdirSync(name, opts) {
        const arg=bytes(name); let permissions=0o777, recursive=false;
        if (typeof opts==='number'||typeof opts==='string') permissions=mode(opts,permissions);
        else if (opts) { permissions=mode(opts.mode,permissions); if (opts.recursive!==undefined) recursive=boolean(opts.recursive,'options.recursive'); }
        if (!recursive) { pathCall(binding.mkdir,arg,undefined,permissions); return; }
        const pending=[]; let current=arg;
        for (;;) {
            try { pathCall(binding.mkdir,current,undefined,permissions); pending.push(current); break; }
            catch (error) {
                if (error.code==='EEXIST') { if (!stat(current).isDirectory()) throw error; break; }
                if (error.code!=='ENOENT') throw error;
                pending.push(current); const next=parent(current);
                if (Buffer.compare(current,next)===0) throw error;
                current=next;
            }
        }
        let first=pending.length?pending[pending.length-1]:undefined;
        // The final successful mkdir is already present; create its descendants.
        for (let i=pending.length-1;i>=0;i--) {
            if (Buffer.compare(pending[i],current)===0) continue;
            try { pathCall(binding.mkdir,pending[i],undefined,permissions); }
            catch (error) { if (error.code!=='EEXIST'||!stat(pending[i]).isDirectory()) throw error; }
        }
        return first===undefined?undefined:windows?path.toNamespacedPath(display(first)):display(first);
    }
    function readdirSync(name, opts) {
        opts=options(opts); const enc=encoding(opts.encoding,'utf8',true), base=bytes(name), bytePath=name instanceof Uint8Array;
        if (opts.recursive!=null) boolean(opts.recursive,'options.recursive');
        const list=[], queue=[base];
        for (let index=0;index<queue.length;index++) {
            const directory=queue[index];
            const entries=pathCall(binding.scan,directory).map(([data,type])=>[Buffer.from(data),type]);
            entries.sort((a,b)=>Buffer.compare(a[0],b[0]));
            for (let [raw,type] of entries) {
                const entryName=enc==='buffer'?raw:raw.toString(enc);
                const full=opts.recursive?Buffer.from(path.join(bytePath?name:display(directory),entryName)):join(directory,raw);
                if (!type && opts.withFileTypes) { const s=stat(full,undefined,1); type=(Number(s.mode)&0xf000)>>>12; }
                if (opts.withFileTypes) list.push(new Dirent(entryName,({0:0,8:1,4:2,10:3,1:4,12:5,2:6,6:7})[type],bytePath?directory:display(directory)));
                else if (opts.recursive) list.push(path.relative(display(base),display(full)));
                else list.push(entryName);
                if (opts.recursive) {
                    try { if (stat(full).isDirectory()) queue.push(full); } catch (error) { if (error.code!=='ENOENT'&&error.code!=='ENOTDIR') throw error; }
                }
            }
        }
        return list;
    }
    function remove(name, opts, expectDirectory=false) {
        const arg=bytes(name);
        if (opts!==undefined && (opts===null||typeof opts!=='object'||Array.isArray(opts))) throw invalidType('options','an object');
        opts={recursive:false,force:false,maxRetries:0,retryDelay:100,...opts};
        boolean(opts.recursive,'options.recursive'); boolean(opts.force,'options.force');
        integer(opts.maxRetries,'options.maxRetries',0,0xffffffff); integer(opts.retryDelay,'options.retryDelay',0,0xffffffff);
        function once(current, root) {
            const pending=[{current,root,post:false}];
            while (pending.length) {
                const item=pending.pop(); current=item.current;
                if (item.post) { pathCall(binding.rmdir,current); continue; }
                let s;
                try { s=stat(current,undefined,1); } catch (error) { if (error.code==='ENOENT'&&opts.force) continue; throw error; }
                if (item.root && expectDirectory && !s.isDirectory()) { pathCall(binding.rmdir,current); continue; }
                if (s.isDirectory()) {
                    if (!opts.recursive) {
                        if (expectDirectory) { pathCall(binding.rmdir,current); continue; }
                        try { fail('EISDIR','rm',current); } catch (error) { error.name='SystemError'; error.code='ERR_FS_EISDIR'; error.errno=21; throw error; }
                    }
                    pending.push({current,root:false,post:true});
                    const children=pathCall(binding.scan,current);
                    for (let i=children.length-1;i>=0;i--) pending.push({current:join(current,Buffer.from(children[i][0])),root:false,post:false});
                } else pathCall(binding.unlink,current);
            }
        }
        for (let attempt=0;;attempt++) {
            try { return once(arg,true); }
            catch (error) {
                if (opts.force&&error.code==='ENOENT') return;
                if (!opts.recursive||attempt>=opts.maxRetries||!['EBUSY','EMFILE','ENFILE','ENOTEMPTY','EPERM'].includes(error.code)) throw error;
                binding.pause(Math.min(0x7fffffff,(attempt+1)*opts.retryDelay));
            }
        }
    }
    function copyFileSync(source, destination, copyMode=0) {
        integer(copyMode,'mode',-0x80000000,0x7fffffff);
        if (copyMode&~7) throw outOfRange('mode');
        const a=bytes(source), b=bytes(destination); let input, output, failed=false;
        try {
            if (copyMode&4) binding.error('ENOTSUP','copyfile');
            input=openSync(a,'r'); const s=stat(input,undefined,2);
            if (s.isDirectory()) binding.error(windows?'EPERM':native.platform==='darwin'?'ENOTSUP':'EISDIR','copyfile');
            output=openSync(b,constants.O_WRONLY|constants.O_CREAT|(copyMode&1?constants.O_EXCL:0),Number(s.mode)&0o777);
            const dst=stat(output,undefined,2);
            if (s.dev===dst.dev && s.ino===dst.ino) return;
            binding.truncate(output,0);
            if (!windows) binding.chmod(output,Number(s.mode)&0o777);
            const buffer=Buffer.allocUnsafe(65536);
            for (;;) {
                const count=readSync(input,buffer,0,buffer.length); if (!count) break;
                let offset=0; while (offset<count) { const n=writeSync(output,buffer,offset,count-offset); if (!n) binding.error('EIO','copyfile'); offset+=n; }
            }
        } catch (error) { failed=true; error.syscall='copyfile'; error.path=display(a); error.dest=display(b); throw error; }
        finally {
            let closeError;
            for (const number of [output,input]) if (number!==undefined) {
                try { closeSync(number); } catch (error) { closeError??=error; }
            }
            if (failed && output!==undefined) { try { pathCall(binding.unlink,b); } catch {} }
            if (closeError && !failed) { closeError.syscall='copyfile'; closeError.path=display(a); closeError.dest=display(b); throw closeError; }
        }
    }
    function realpathSync(name, opts) {
        opts=options(opts); const enc=encoding(opts.encoding,'utf8',true);
        const value=Buffer.from(pathCall(binding.realpath,bytes(name)));
        return enc==='buffer'?value:value.toString(enc);
    }
    realpathSync.native=realpathSync;
    return {
        constants, Stats, Dirent, openSync, closeSync, readSync, writeSync, readFileSync, writeFileSync,
        appendFileSync(name,data,opts) { opts=options(opts,{flag:'a'}); if (!opts.flag||typeof name==='number') opts.flag='a'; return writeFileSync(name,data,opts); },
        existsSync(name) { try { pathCall(binding.stat,bytes(name),undefined,0); return true; } catch { return false; } },
        accessSync(name,accessMode=0) { integer(accessMode,'mode',-0x80000000,0x7fffffff); if (accessMode&~7) throw outOfRange('mode'); pathCall(binding.access,bytes(name),undefined,accessMode); },
        statSync:(name,opts)=>stat(name,opts,0), lstatSync:(name,opts)=>stat(name,opts,1), fstatSync:(number,opts)=>stat(number,opts,2),
        mkdirSync, readdirSync, copyFileSync, realpathSync,
        renameSync:(a,b)=>pathCall(binding.rename,bytes(a),bytes(b)), unlinkSync:name=>pathCall(binding.unlink,bytes(name)),
        rmdirSync:(name,opts)=>remove(name,opts,true), rmSync:(name,opts)=>remove(name,opts),
        mkdtempSync(prefix,opts) { opts=options(opts); const enc=encoding(opts.encoding,'utf8',true); const value=Buffer.from(pathCall(binding.mkdtemp,bytes(prefix,'prefix'))); return enc==='buffer'?value:value.toString(enc); },
        ftruncateSync(number,length=0) { number=fd(number); integer(length,'len',-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER); binding.truncate(number,Math.max(0,length)); },
        fsyncSync(number) { binding.sync(fd(number)); }
    };
}
