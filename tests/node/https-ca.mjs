import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import {dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';import {httpsService} from './fixtures/https-service.mjs';
const service=await httpsService(),out={};try{
    const folder=dirname(service.ca),invalid=join(folder,'invalid.pem');writeFileSync(invalid,'-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----\n');
    for(const [name,ca]of [['valid',service.ca],['missing',join(folder,'missing.pem')],['invalid',invalid],['default',null]]){
        const env={...process.env,NODE_COMPAT_HTTPS_PORT:String(service.port)};if(ca===null)delete env.NODE_EXTRA_CA_CERTS;else env.NODE_EXTRA_CA_CERTS=ca;
        const run=spawnSync(process.execPath,[fileURLToPath(new URL('./fixtures/https-ca-child.mjs',import.meta.url))],{env,encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
        if(run.error||run.status!==0)throw Error('CA child failed '+name+': '+run.stderr);
        const lines=run.stdout.split(/\r?\n/).filter(x=>x.startsWith('NODE_COMPAT_RESULT '));if(lines.length!==1)throw Error('Missing CA result');
        out[name]={result:JSON.parse(lines[0].slice('NODE_COMPAT_RESULT '.length)),warning:run.stderr.includes('Ignoring extra cert')};
    }
    console.log('NODE_COMPAT_RESULT '+JSON.stringify(out));
}finally{await service.close();}
