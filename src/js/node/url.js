function createURLModule(native,process,path,isIP) {
    const punycode=createPunycode(),urlKey=Symbol('url.state'),paramsKey=Symbol('url.params');
    const ports={http:'80',https:'443',ws:'80',wss:'443',ftp:'21',file:''};
    const special=scheme=>Object.prototype.hasOwnProperty.call(ports,scheme);
    function usv(value){if(typeof value==='symbol')throw new TypeError('Cannot convert a Symbol value to a string');return Buffer.from(String(value)).toString();}
    function invalid(input){const e=codedError(TypeError,'ERR_INVALID_URL','Invalid URL');e.input=input;return e;}
    function urlState(value){const s=value?.[urlKey];if(!s)throw codedError(TypeError,'ERR_INVALID_THIS','Value must be a URL');return s;}
    function paramState(value){const s=value?.[paramsKey];if(!s)throw codedError(TypeError,'ERR_INVALID_THIS','Value must be a URLSearchParams');return s;}
    function required(args,count){if(args.length<count)throw codedError(TypeError,'ERR_MISSING_ARGS','Missing required URL argument');}
    function encode(value,kind,isSpecial=false){
        let output='';
        for(const c of value){const code=c.codePointAt(0);let escape=code<0x20||code>0x7e;
            if(kind!=='opaque')escape||=c===' ';
            if(kind==='path')escape||='"#<>?`{}'.includes(c);
            else if(kind==='query')escape||='"#<>'.includes(c)||(isSpecial&&c==="'");
            else if(kind==='fragment')escape||='"<>`'.includes(c);
            else if(kind==='user')escape||='"#<>?`{}/:;=@[\\]^|'.includes(c);
            output+=escape?[...Buffer.from(c)].map(b=>'%'+b.toString(16).toUpperCase().padStart(2,'0')).join(''):c;
        }
        return output;
    }
    const formEncode=value=>encodeURIComponent(value).replace(/[!'()~]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g,'+');
    function formDecode(value){
        const bytes=Buffer.from(value.replace(/\+/g,' ')),output=[];
        for(let i=0;i<bytes.length;i++){
            if(bytes[i]===37&&i+2<bytes.length){const pair=String.fromCharCode(bytes[i+1],bytes[i+2]);if(/^[0-9a-f]{2}$/i.test(pair)){output.push(parseInt(pair,16));i+=2;continue;}}
            output.push(bytes[i]);
        }
        return Buffer.from(output).toString();
    }
    function formPairs(text){const list=[];for(const piece of text.replace(/^\?/,'').split('&'))if(piece){const equals=piece.indexOf('=');list.push([formDecode(equals<0?piece:piece.slice(0,equals)),formDecode(equals<0?'':piece.slice(equals+1))]);}return list;}
    function updateOwner(params){const p=paramState(params);if(p.owner){const s=urlState(p.owner);s.query=params.toString();s.queryPresent=!!s.query;}}
    class URLSearchParams {
        constructor(init=''){
            const list=[];Object.defineProperty(this,paramsKey,{value:{list,owner:null}});
            if(init==null)return;
            if(typeof init==='object'&&typeof init[Symbol.iterator]==='function'){
                for(const pair of init){if(pair===null||typeof pair!=='object'||typeof pair[Symbol.iterator]!=='function')throw codedError(TypeError,'ERR_INVALID_TUPLE','Expected name/value tuple');const values=Array.from(pair);if(values.length!==2)throw codedError(TypeError,'ERR_INVALID_TUPLE','Expected name/value tuple');list.push([usv(values[0]),usv(values[1])]);}
            }else if(typeof init==='object'){
                for(const name of Reflect.ownKeys(init))if(Object.prototype.propertyIsEnumerable.call(init,name))list.push([usv(name),usv(init[name])]);
            }else list.push(...formPairs(usv(init)));
        }
        get size(){return paramState(this).list.length;}
        append(name,value){required(arguments,2);paramState(this).list.push([usv(name),usv(value)]);updateOwner(this);}
        delete(name,value){required(arguments,1);name=usv(name);if(value!==undefined)value=usv(value);const s=paramState(this);s.list=s.list.filter(p=>p[0]!==name||value!==undefined&&p[1]!==value);updateOwner(this);}
        get(name){required(arguments,1);name=usv(name);return paramState(this).list.find(p=>p[0]===name)?.[1]??null;}
        getAll(name){required(arguments,1);name=usv(name);return paramState(this).list.filter(p=>p[0]===name).map(p=>p[1]);}
        has(name,value){required(arguments,1);name=usv(name);if(value!==undefined)value=usv(value);return paramState(this).list.some(p=>p[0]===name&&(value===undefined||p[1]===value));}
        set(name,value){required(arguments,2);name=usv(name);value=usv(value);const s=paramState(this),first=s.list.findIndex(p=>p[0]===name);if(first<0)s.list.push([name,value]);else {s.list[first][1]=value;s.list=s.list.filter((p,i)=>p[0]!==name||i===first);}updateOwner(this);}
        sort(){paramState(this).list.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);updateOwner(this);}
        *entries(){for(let i=0;i<paramState(this).list.length;i++)yield paramState(this).list[i].slice();}
        *keys(){for(const p of this.entries())yield p[0];}
        *values(){for(const p of this.entries())yield p[1];}
        forEach(callback,thisArg){if(typeof callback!=='function')throw invalidType('callback','a function');for(const [name,value] of this.entries())callback.call(thisArg,value,name,this);}
        toString(){return paramState(this).list.map(p=>formEncode(p[0])+'='+formEncode(p[1])).join('&');}
    }
    Object.defineProperty(URLSearchParams.prototype,Symbol.iterator,{value:URLSearchParams.prototype.entries,writable:true,configurable:true});
    Object.defineProperty(URLSearchParams.prototype,Symbol.toStringTag,{value:'URLSearchParams',configurable:true});
    function ipv4Number(value){
        let radix=10;if(/^0x/i.test(value)){radix=16;value=value.slice(2);}else if(value.length>1&&value[0]==='0'){radix=8;value=value.slice(1);}
        if(!value)return 0;if(!(radix===16?/^[0-9a-f]+$/i:radix===8?/^[0-7]+$/:/^[0-9]+$/).test(value))return null;return parseInt(value,radix);
    }
    function ipv4(host){
        const parts=host.split('.');if(parts[parts.length-1]==='')parts.pop();
        if(!parts.length)return host;const last=parts[parts.length-1];
        if(!/^[0-9]+$/.test(last)&&ipv4Number(last)===null)return host;
        if(parts.length>4)throw invalid(host);const numbers=parts.map(ipv4Number);
        if(numbers.some(n=>n===null)||numbers.slice(0,-1).some(n=>n>255)||numbers[numbers.length-1]>=256**(5-numbers.length))throw invalid(host);
        let value=numbers.pop();numbers.forEach((n,i)=>value+=n*256**(3-i));return [24,16,8,0].map(shift=>Math.floor(value/2**shift)%256).join('.');
    }
    function ipv6(host){
        if(isIP(host)!==6||host.includes('%'))throw invalid(host);
        if(host.includes('.')){const colon=host.lastIndexOf(':'),bytes=host.slice(colon+1).split('.').map(Number);host=host.slice(0,colon+1)+((bytes[0]<<8)|bytes[1]).toString(16)+':'+((bytes[2]<<8)|bytes[3]).toString(16);}
        const halves=host.split('::'),left=halves[0]?halves[0].split(':').map(x=>parseInt(x,16)):[],right=halves.length>1&&halves[1]?halves[1].split(':').map(x=>parseInt(x,16)):[];
        const values=halves.length>1?[...left,...Array(8-left.length-right.length).fill(0),...right]:left;
        let start=-1,size=1;for(let i=0;i<8;){if(values[i]!==0){i++;continue;}let end=i;while(end<8&&values[end]===0)end++;if(end-i>size){start=i;size=end-i;}i=end;}
        const list=values.map(x=>x.toString(16));return start<0?list.join(':'):list.slice(0,start).join(':')+'::'+list.slice(start+size).join(':');
    }
    function asciiHost(input){
        let host=decodeURIComponent(input).normalize('NFKC').toLowerCase().replace(/[\u3002\uff0e\uff61]/g,'.').replace(/[\u00ad\u034f\u061c\u180b-\u180d\u200b\u2060\ufe00-\ufe0f\ufeff]/g,'');
        if(/[\x00-\x20\x7f-\x9f#%/:<>?@[\\\]^|\ufffd\u200c\u200d]/.test(host))throw invalid(input);
        host=punycode.toASCII(host);
        for(const label of host.split('.'))if(label.startsWith('xn--')){const decoded=punycode.decode(label.slice(4));if(!decoded||/[\x00-\x20\x7f-\x9f\ufffd]/.test(decoded)||punycode.encode(decoded)!==label.slice(4))throw invalid(input);}
        return ipv4(host);
    }
    function hostParts(authority,scheme,input){
        let username='',password='',host=authority,port='';const at=host.lastIndexOf('@');
        if(at>=0){if(scheme==='file')throw invalid(input);const auth=host.slice(0,at),colon=auth.indexOf(':');username=encode(colon<0?auth:auth.slice(0,colon),'user');password=colon<0?'':encode(auth.slice(colon+1),'user');host=host.slice(at+1);}
        if(host.startsWith('[')){const end=host.indexOf(']');if(end<0)throw invalid(input);const tail=host.slice(end+1);if(tail&&!tail.startsWith(':'))throw invalid(input);port=tail.slice(1);host='['+ipv6(host.slice(1,end))+']';}
        else {const colon=host.lastIndexOf(':');if(colon>=0){port=host.slice(colon+1);host=host.slice(0,colon);}if(special(scheme))host=asciiHost(host);else {if(/[\x00-\x20#/:<>?@[\\\]^|]/.test(host))throw invalid(input);host=encode(host,'opaque');}}
        if(port){if(!/^\d+$/.test(port)||Number(port)>65535||scheme==='file')throw invalid(input);port=String(Number(port));if(port===ports[scheme])port='';}
        if(!host&&special(scheme)&&scheme!=='file')throw invalid(input);if(scheme==='file'&&host==='localhost')host='';
        return {hostname:host,port,username,password};
    }
    function normalizedPath(value,scheme,authority){
        if(special(scheme))value=value.replace(/\\/g,'/');if(authority&&value&&!value.startsWith('/'))value='/'+value;if(authority&&special(scheme)&&!value)value='/';
        const out=[],pieces=value.split('/');
        for(let i=0;i<pieces.length;i++){
            let piece=pieces[i];if(scheme==='file'&&out.length===1&&/^[a-z][|:]$/i.test(piece))piece=piece[0]+':';
            const dots=piece.replace(/%2e/ig,'.');
            if(dots==='.'||dots==='..'){if(dots==='..'&&out.length>1&&!(scheme==='file'&&out.length===2&&/^[a-z]:$/i.test(out[1])))out.pop();if(i===pieces.length-1)out.push('');}
            else out.push(encode(piece,'path'));
        }
        return out.join('/');
    }
    function tails(rest,scheme){const hash=rest.indexOf('#');let fragment='',fragmentPresent=hash>=0;if(fragmentPresent){fragment=encode(rest.slice(hash+1),'fragment');rest=rest.slice(0,hash);}const question=rest.indexOf('?');let query='',queryPresent=question>=0;if(queryPresent){query=encode(rest.slice(question+1),'query',special(scheme));rest=rest.slice(0,question);}return {rest,fragment,fragmentPresent,query,queryPresent};}
    function parse(input,base){
        let text=input.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g,'').replace(/[\t\r\n]/g,'');const match=/^([a-z][a-z0-9+.-]*):/i.exec(text);
        if(!match){
            if(!base)throw invalid(input);const s={...base,params:undefined};const tail=tails(text,s.scheme);Object.assign(s,{fragment:tail.fragment,fragmentPresent:tail.fragmentPresent});
            if(s.opaque){if(text.startsWith('#'))return s;throw invalid(input);}
            if(tail.rest.startsWith('//')||special(s.scheme)&&tail.rest.startsWith('\\\\'))return parse(s.scheme+':'+text,undefined);
            if(tail.rest){const resolved=tail.rest.startsWith('/')||special(s.scheme)&&tail.rest.startsWith('\\')?tail.rest:s.pathname.slice(0,s.pathname.lastIndexOf('/')+1)+tail.rest;s.pathname=normalizedPath(resolved,s.scheme,s.authority);s.query=tail.query;s.queryPresent=tail.queryPresent;}
            else if(tail.queryPresent){s.query=tail.query;s.queryPresent=true;}return s;
        }
        const scheme=match[1].toLowerCase();let rest=text.slice(match[0].length);
        if(base&&scheme===base.scheme&&special(scheme)&&scheme!=='file'&&!/^[\\/]{2}/.test(rest))return parse(rest,base);
        if(special(scheme))rest=rest.replace(/\\/g,'/');
        const tail=tails(rest,scheme);rest=tail.rest;let authority=rest.startsWith('//'),opaque=!special(scheme)&&!authority&&!rest.startsWith('/'),parts={hostname:'',port:'',username:'',password:''};
        if(special(scheme)&&scheme!=='file'){authority=true;rest='//'+rest.replace(/^\/+/,'');}
        if(authority){rest=rest.slice(2);const slash=rest.indexOf('/');let host=slash<0?rest:rest.slice(0,slash);rest=slash<0?'':rest.slice(slash);
            if(scheme==='file'&&/^[a-z][|:]$/i.test(host)){rest='/'+host+rest;host='';}parts=hostParts(host,scheme,input);}
        else if(scheme==='file'){authority=true;if(!rest.startsWith('/'))rest='/'+rest;}
        const pathname=opaque?encode(rest,'opaque'):normalizedPath(rest,scheme,authority);
        return {scheme,authority,opaque,...parts,pathname,...tail,rest:undefined,params:undefined};
    }
    function serialize(s){return s.scheme+':'+(s.authority?'//'+(s.username||s.password?s.username+(s.password?':'+s.password:'')+'@':'')+s.hostname+(s.port?':'+s.port:''):'')+s.pathname+(s.queryPresent?'?'+s.query:'')+(s.fragmentPresent?'#'+s.fragment:'');}
    function syncParams(s){if(s.params)paramState(s.params).list=formPairs(s.query);}
    class URL {
        constructor(input,base){input=usv(input);const parent=base===undefined?undefined:base instanceof URL?urlState(base):parse(usv(base));let s;try{s=parse(input,parent);}catch(e){throw invalid(input);}Object.defineProperty(this,urlKey,{value:s});s.params=new URLSearchParams(s.query);paramState(s.params).owner=this;}
        get href(){return serialize(urlState(this));}set href(value){const s=urlState(this),input=usv(value);let next;try{next=parse(input);}catch{throw invalid(input);}const params=s.params;Object.assign(s,next,{params});syncParams(s);}
        get protocol(){return urlState(this).scheme+':';}set protocol(value){const s=urlState(this),m=/^([a-z][a-z0-9+.-]*):?$/i.exec(usv(value));if(!m)return;const scheme=m[1].toLowerCase();if(special(scheme)!==special(s.scheme)||scheme==='file'&&(s.username||s.password||s.port)||s.scheme==='file'&&scheme!=='file'&&!s.hostname)return;s.scheme=scheme;if(s.port===ports[scheme])s.port='';}
        get hostname(){return urlState(this).hostname;}set hostname(value){const s=urlState(this);if(s.opaque)return;try{const next=hostParts(usv(value).replace(/[\t\r\n]/g,''),s.scheme,value);if(next.port)return;s.hostname=next.hostname;}catch{}}
        get host(){const s=urlState(this);return s.hostname+(s.port?':'+s.port:'');}set host(value){const s=urlState(this);if(s.opaque)return;try{const next=hostParts(usv(value).replace(/[\t\r\n]/g,''),s.scheme,value);s.hostname=next.hostname;s.port=next.port;}catch{}}
        get port(){return urlState(this).port;}set port(value){const s=urlState(this);if(s.opaque||s.scheme==='file'||!s.hostname)return;value=usv(value);if(!value){s.port='';return;}const match=/^\d+/.exec(value);if(!match||Number(match[0])>65535)return;const next=String(Number(match[0]));s.port=next===ports[s.scheme]?'':next;}
        get username(){return urlState(this).username;}set username(value){const s=urlState(this);if(!s.opaque&&s.scheme!=='file'&&s.hostname)s.username=encode(usv(value).replace(/[\t\r\n]/g,''),'user');}
        get password(){return urlState(this).password;}set password(value){const s=urlState(this);if(!s.opaque&&s.scheme!=='file'&&s.hostname)s.password=encode(usv(value).replace(/[\t\r\n]/g,''),'user');}
        get pathname(){return urlState(this).pathname;}set pathname(value){const s=urlState(this);if(!s.opaque)s.pathname=normalizedPath(usv(value).replace(/[\t\r\n]/g,''),s.scheme,s.authority);}
        get search(){const s=urlState(this);return s.query?'?'+s.query:'';}set search(value){const s=urlState(this);value=usv(value).replace(/[\t\r\n]/g,'');s.queryPresent=!!value;s.query=encode(value.replace(/^\?/,''),'query',special(s.scheme));syncParams(s);}
        get hash(){const s=urlState(this);return s.fragment?'#'+s.fragment:'';}set hash(value){const s=urlState(this);value=usv(value).replace(/[\t\r\n]/g,'');s.fragmentPresent=!!value;s.fragment=encode(value.replace(/^#/,''),'fragment');}
        get origin(){const s=urlState(this);if(s.scheme==='blob'){try{const inner=parse(s.pathname);return ['http','https','ftp'].includes(inner.scheme)?inner.scheme+'://'+inner.hostname+(inner.port?':'+inner.port:''):'null';}catch{return 'null';}}return !special(s.scheme)||s.scheme==='file'?'null':s.scheme+'://'+this.host;}
        get searchParams(){return urlState(this).params;}
        toString(){return this.href;}toJSON(){return this.href;}
        static canParse(input,base){required(arguments,1);input=usv(input);if(base!==undefined)base=usv(base);try{new URL(input,base);return true;}catch{return false;}}
        static parse(input,base){required(arguments,1);input=usv(input);if(base!==undefined)base=usv(base);try{return new URL(input,base);}catch{return null;}}
    }
    Object.defineProperty(URL.prototype,Symbol.toStringTag,{value:'URL',configurable:true});
    function fileURLToPath(value,options){
        if(typeof value!=='string'&&!(value instanceof URL))throw invalidType('path','a string or URL');
        const url=value instanceof URL?value:new URL(value),s=urlState(url),windows=options?.windows??native.platform==='win32';
        if(s.scheme!=='file')throw codedError(TypeError,'ERR_INVALID_URL_SCHEME','The URL must be of scheme file');
        if(/%2f/i.test(s.pathname)||windows&&/%5c/i.test(s.pathname))throw codedError(TypeError,'ERR_INVALID_FILE_URL_PATH','File URL path must not include encoded separators');
        if(!windows){if(s.hostname)throw codedError(TypeError,'ERR_INVALID_FILE_URL_HOST','File URL host must be localhost or empty');return decodeURIComponent(s.pathname);}
        const decoded=decodeURIComponent(s.pathname).replace(/\//g,'\\');
        if(s.hostname)return '\\\\'+punycode.toUnicode(s.hostname)+decoded;
        if(!/^\\[a-z]:/i.test(decoded))throw codedError(TypeError,'ERR_INVALID_FILE_URL_PATH','File URL path must be absolute');return decoded.slice(1);
    }
    function pathToFileURL(value,options){
        if(typeof value!=='string')throw invalidType('path','a string');const windows=options?.windows??native.platform==='win32',trailing=(windows?/[\\/]$/:/\/$/).test(value);
        let resolved=(windows?path.win32:path.posix).resolve(value),host='';
        if(windows){resolved=resolved.replace(/\\/g,'/');if(resolved.startsWith('//')){const end=resolved.indexOf('/',2);host=end<0?resolved.slice(2):resolved.slice(2,end);resolved=end<0?'/':resolved.slice(end);}else resolved='/'+resolved;}
        if(trailing&&!resolved.endsWith('/'))resolved+='/';
        resolved=resolved.split('/').map((part,i)=>windows&&i===1&&/^[a-z]:$/i.test(part)?part:encodeURI(usv(part)).replace(/[?#~]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())).join('/');
        return new URL('file://'+host+resolved);
    }
    function domainToASCII(value){required(arguments,1);value=usv(value);try{return value.startsWith('[')?'['+ipv6(value.slice(1,-1))+']':asciiHost(value);}catch{return '';}}
    function domainToUnicode(value){required(arguments,1);const host=domainToASCII(value);try{return punycode.toUnicode(host);}catch{return '';}}
    Object.defineProperty(globalThis,'URL',{value:URL,writable:true,configurable:true});Object.defineProperty(globalThis,'URLSearchParams',{value:URLSearchParams,writable:true,configurable:true});
    return {URL,URLSearchParams,fileURLToPath,pathToFileURL,domainToASCII,domainToUnicode};
}
