function createDNS(native,process) {
    const binding=native.dns,constants=native.platform==='win32'||native.platform==='darwin'?
        {ADDRCONFIG:1024,ALL:256,V4MAPPED:2048}:{...binding.constants};let defaultOrder='verbatim';
    let normalizeHost=value=>value;
    const invalid=(name,value)=>codedError(TypeError,'ERR_INVALID_ARG_VALUE','Invalid '+name+': '+String(value));
    const orders=['verbatim','ipv4first','ipv6first'];
    function order(value){if(!orders.includes(value))throw invalid('order',value);return value;}
    function settings(value){
        if(value===undefined || value===null)value={};
        else if(typeof value==='number')value={family:value};
        else if(typeof value!=='object')throw invalidType('options','an object or integer');
        let family=value.family??0;
        if(family==='IPv4')family=4;else if(family==='IPv6')family=6;
        if(family!==0&&family!==4&&family!==6)throw invalid('family',family);
        const hints=value.hints??0;
        if(typeof hints!=='number')throw invalidType('hints','a number');
        if((hints|0)!==hints || hints<0 || (hints&~(constants.ALL|constants.ADDRCONFIG|constants.V4MAPPED)))throw invalid('hints',hints);
        if(value.all!==undefined && typeof value.all!=='boolean')throw invalidType('all','a boolean');
        if(value.verbatim!==undefined && typeof value.verbatim!=='boolean')throw invalidType('verbatim','a boolean');
        const selected=value.order!==undefined?order(value.order):value.verbatim===undefined?defaultOrder:value.verbatim?'verbatim':'ipv4first';
        return {family,hints:(hints&constants.ADDRCONFIG?32:0)|(hints&constants.V4MAPPED?8:0)|(hints&constants.ALL?16:0),all:!!value.all,order:selected};
    }
    function lookup(hostname,options,callback){
        if(typeof options==='function'){callback=options;options=undefined;}
        if(typeof callback!=='function')throw invalidType('callback','a function');
        if(hostname && typeof hostname!=='string')throw invalidType('hostname','a string');
        const opts=settings(options);
        if(hostname && hostname.includes('\0'))throw invalid('hostname',hostname);
        if(!hostname){process.nextTick(()=>opts.all?callback(null,[]):callback(null,null,opts.family===6?6:4));return;}
        const family=binding.isIP(hostname);
        if(family){process.nextTick(()=>opts.all?callback(null,[{address:hostname,family}]):callback(null,hostname,family));return;}
        const ascii=normalizeHost(hostname);
        if(!ascii){process.nextTick(callback,Object.assign(new Error('getaddrinfo ENOTFOUND '+hostname),{errno:-3008,code:'ENOTFOUND',syscall:'getaddrinfo',hostname}));return;}
        binding.lookup(ascii,opts.family,opts.hints).then(addresses=>{
            if(opts.order!=='verbatim')addresses.sort((a,b)=>opts.order==='ipv4first'?a.family-b.family:b.family-a.family);
            if(opts.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);
        },error=>{error.message='getaddrinfo '+error.code+' '+hostname;error.hostname=hostname;callback(error);});
    }
    const promises={lookup(hostname,options){return new Promise((resolve,reject)=>lookup(hostname,options,(error,address,family)=>error?reject(error):resolve(Array.isArray(address)?address:{address,family})));},
        getDefaultResultOrder:()=>defaultOrder,setDefaultResultOrder:value=>{defaultOrder=order(value);}};
    lookup[Symbol.for('nodejs.util.promisify.custom')]=promises.lookup;
    const api={lookup,promises,...constants,getDefaultResultOrder:promises.getDefaultResultOrder,setDefaultResultOrder:promises.setDefaultResultOrder};
    return {api,promises,isIP:value=>binding.isIP(value),setDomainNormalizer:value=>{normalizeHost=value;}};
}
