// Test-only certificates signed with the pinned Node oracle. No OpenSSL CLI or
// third-party Python certificate package is required by the matrix.
import {generateKeyPairSync,sign,randomBytes,X509Certificate} from 'node:crypto';
import {writeFileSync} from 'node:fs';import {join} from 'node:path';
const folder=process.argv[2];if(!folder)throw Error('fixture directory required');
const cat=(...values)=>Buffer.concat(values.map(v=>Buffer.from(v)));
function der(tag,...values){const body=cat(...values),length=body.length<128?Buffer.from([body.length]):(()=>{let n=body.length,a=[];while(n){a.unshift(n&255);n>>>=8;}return Buffer.from([128|a.length,...a]);})();return cat([tag],length,body);}
const seq=(...v)=>der(0x30,...v),oid=hex=>der(6,Buffer.from(hex,'hex'));
const algorithm=seq(oid('2a864886f70d01010b'),der(5));
const name=value=>seq(der(0x31,seq(oid('550403'),der(12,Buffer.from(value)))));
const integer=value=>der(2,Buffer.from([value]));
const extension=(id,value,critical=false)=>seq(oid(id),...(critical?[der(1,[255])]:[]),der(4,value));
const root=generateKeyPairSync('rsa',{modulusLength:2048});let serial=1;
function certificate(label,key,{cn='localhost',san=[['dns','localhost'],['ip',[127,0,0,1]],['ip',[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]]],before=-1,after=7,basic=seq(),ca=false,signer=root,weakHash=false}={}){
    const time=days=>{const value=new Date(Date.now()+days*86400000).toISOString().replace(/[-:T]/g,'').replace(/\.\d{3}Z$/,'Z');return der(0x18,Buffer.from(value));};
    const extensions=[extension('551d13',basic,true),extension('551d0f',der(3,ca?[1,6]:[5,160]),true)];
    if(!ca)extensions.push(extension('551d25',seq(oid('2b06010505070301'))));
    if(san)extensions.push(extension('551d11',seq(...san.map(([kind,value])=>der(kind==='dns'?0x82:0x87,typeof value==='string'?Buffer.from(value):value)))));
    const signatureAlgorithm=weakHash?seq(oid('2a864886f70d010105'),der(5)):signer.privateKey.asymmetricKeyType==='ec'?seq(oid('2a8648ce3d040304')):algorithm;
    const tbs=seq(der(0xa0,integer(2)),integer(serial++),signatureAlgorithm,name('QuickJS offline audit CA'),seq(time(before),time(after)),name(cn),key.publicKey.export({type:'spki',format:'der'}),der(0xa3,seq(...extensions)));
    const bytes=seq(tbs,signatureAlgorithm,der(3,[0],sign(weakHash?'RSA-SHA1':signer.privateKey.asymmetricKeyType==='ec'?'SHA512':'RSA-SHA256',tbs,signer.privateKey)));
    const pem='-----BEGIN CERTIFICATE-----\n'+bytes.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE-----\n';
    writeFileSync(join(folder,label+'.pem'),pem);writeFileSync(join(folder,label+'.key'),key.privateKey.export({type:'pkcs8',format:'pem'}));
    return {pem,bytes};
}
certificate('ca',root,{cn:'QuickJS offline audit CA',ca:true,san:null,basic:seq(der(1,[255]))});
const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),ec=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
new X509Certificate(certificate('rsa',rsa).pem);new X509Certificate(certificate('ecdsa',ec).pem);
certificate('wrong-ip',rsa,{san:[['ip',[127,0,0,2]]]});certificate('dns-ip',rsa,{san:[['dns','127.0.0.1']]});
certificate('cn-ip',rsa,{cn:'127.0.0.1',san:null});certificate('wrong-dns',rsa,{san:[['dns','wrong.invalid']]});
certificate('expired',rsa,{before:-3,after:-1});certificate('future',rsa,{before:1,after:7});
certificate('weak-rsa',generateKeyPairSync('rsa',{modulusLength:1024}));
certificate('weak-hash',rsa,{weakHash:true});
const p521=generateKeyPairSync('ec',{namedCurve:'secp521r1'});
certificate('p521-ca',p521,{cn:'QuickJS offline audit CA',ca:true,san:null,basic:seq(der(1,[255])),signer:p521});
const bad=certificate('p521-leaf',rsa,{signer:p521}).bytes;bad[bad.length-1]^=1;
writeFileSync(join(folder,'p521-badsig.pem'),'-----BEGIN CERTIFICATE-----\n'+bad.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE-----\n');
writeFileSync(join(folder,'p521-badsig.key'),rsa.privateKey.export({type:'pkcs8',format:'pem'}));
for(const [index,value] of ['30030101ff','3003010100','3000','3003020101','30000101ff','30040101ff','30060201ff020100','300401020001'].entries())certificate('der-'+index,rsa,{basic:Buffer.from(value,'hex')});
console.log('PASS generated offline TLS certificates');
