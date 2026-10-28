/* Share HTTP message classes and framing; each Agent snapshots TLS policy. */
function createHTTPS(http,tls,dns){
    function snapshot(options){
        const copy={...options};copy.host=copy.hostname??copy.host??'localhost';
        if(copy.servername===undefined)copy.servername=dns.isIP(copy.host)?'':copy.host;
        const [identity,servername,ca]=tls.settings(copy);
        copy.servername=servername??'';if(ca!==null)copy.ca=ca;
        return copy;
    }
    return http.forTransport({protocol:'https:',defaultPort:443,ready:'secureConnect',
        connect:options=>tls.api.connect(options),snapshot,validate:snapshot,
        initializeAgent(agent,options){if(options.maxCachedSessions!==undefined&&options.maxCachedSessions!==0)throw codedError(Error,'ERR_NOT_SUPPORTED','TLS session caching is not enabled');agent.maxCachedSessions=0;},
        poolName(options,base){const copy=snapshot(options);return JSON.stringify([base,...tls.settings(copy)]);}});
}
