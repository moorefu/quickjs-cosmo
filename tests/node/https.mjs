import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {httpsService} from './fixtures/https-service.mjs';
const s=await httpsService();try{
    const env={...process.env,NODE_EXTRA_CA_CERTS:s.ca,NODE_COMPAT_HTTPS_PORT:String(s.port),NODE_COMPAT_HTTPS_BAD:String(s.bad),NODE_COMPAT_HTTPS_PLAIN:String(s.plain),NODE_COMPAT_HTTPS_SLOW:String(s.slow),NODE_COMPAT_HTTPS_CA:s.ca};
    const text=execFileSync(process.execPath,[fileURLToPath(new URL('./fixtures/https-client.mjs',import.meta.url))],{env,encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
    console.log(text.trim());
}finally{await s.close();}
