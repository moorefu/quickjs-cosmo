import https from 'node:https';import bare from 'https';import http from 'node:http';
const agent=new https.Agent({keepAlive:false,maxSockets:2,maxCachedSessions:0}),out={alias:https===bare,dynamic:(await import('node:https')).default===https,
    agent:agent instanceof http.Agent,protocol:agent.protocol,port:agent.defaultPort,keepAlive:agent.keepAlive,sockets:agent.maxSockets,sessions:agent.maxCachedSessions};
for(const [name,options]of [['protocol',{protocol:'http:'}],['port',{port:-1}],['path',{path:'/a b'}],['agent',{agent:new http.Agent()}]]){
    try{const request=https.request(options);request.on('error',()=>{});request.destroy();out[name]=null;}catch(e){out[name]=[e.name,e.code];}
}
agent.destroy();console.log('NODE_COMPAT_RESULT '+JSON.stringify(out));
