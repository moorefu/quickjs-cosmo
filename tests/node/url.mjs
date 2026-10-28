import url,{URL,URLSearchParams,fileURLToPath,pathToFileURL,domainToASCII,domainToUnicode} from 'node:url';
import {check,result,errorOf} from './fixtures/result.mjs';
const output={identity:[URL===globalThis.URL,URLSearchParams===globalThis.URLSearchParams,url.URL===URL]};
function snapshot(u){return [u.href,u.origin,u.protocol,u.username,u.password,u.host,u.hostname,u.port,u.pathname,u.search,u.hash,[...u.searchParams]];}
const inputs=['HTTP://ExAmPle.com:80/a/../b?q=a b#x y','https://user:p%40ss@例子.测试:443/a/%2e%2e/b/中文😀?x=1&x=2&q=%FF#片段','http://[2001:0db8:0:0:0:0:0:1]:80/a','http://[::ffff:127.0.0.1]/','http://127.1/','http://0177.0.0.1/','http://0x7f000001/','http://2130706433/','http://example.com./','mailto:a b@example.com','data:text/plain,中文','foo://Host:99/a','foo:/path','file:///C:/a/../b','file://localhost/a','file://server/share/a?x=1','http://u:p:a@x/','http://a@b@x/','https://x/?#',' \tHTTP://x/a\r\nb '];
output.absolute=inputs.map(value=>snapshot(new URL(value)));
output.relative=[];
for(const [value,base] of [['../c?q=1#x','https://x/a/b'],['?new=2','https://x/a?old=1#z'],['#next','https://x/a?old=1#z'],['','https://x/a?old=1#z'],['//new.test:80/x','http://old.test/a'],['./%2e/../c','https://x/a/b'],['..','file:///C:/a/b'],['../x','foo:/a/b'],['http:b','http://x/a/'],['a\\b','https://x/dir/']])output.relative.push(snapshot(new URL(value,base)));
const u=new URL('https://user:pass@example.com:8443/a/b?old=1#old'),params=u.searchParams;output.setters=[];
for(const [name,value] of [['hostname','例子.测试'],['protocol','http:'],['port','80'],['username','a@b'],['password','p: q'],['pathname','/one/../two a'],['search','?a=1&b=x y'],['hash','#片段']]){u[name]=value;output.setters.push(snapshot(u));}
params.set('b','~+');params.append('b','last');output.link=[snapshot(u),params===u.searchParams];u.href='https://new.test/?new=2';output.hrefSetter=[snapshot(u),params===u.searchParams,[...params]];
const p=new URLSearchParams('a=%ff&b=%E4%B8&x=%ZZ&n=a+b&x=last');
output.params=[p.toString(),p.size,[...p],p.get('x'),p.getAll('x'),p.has('x','last')];p.delete('x','%ZZ');p.set('a','中文😀');p.append('space','~ !+');p.sort();output.paramsAfter=[p.toString(),[...p.keys()],[...p.values()]];
const live=new URLSearchParams('a=1&b=2'),seen=[];live.forEach((value,name,self)=>{seen.push([name,value,self===live]);if(name==='a')self.append('c','3');});output.live=seen;
output.constructors=[new URLSearchParams({a:[1,2],b:null}).toString(),new URLSearchParams([['a','1'],['a','2']]).toString(),new URLSearchParams('\uD800=x').toString()];
output.statics=[URL.canParse('/x','https://example.com/'),URL.canParse('bad'),URL.parse('bad'),URL.parse('/x','https://example.com/').href];
output.domains=['例子.测试','bücher.example','faß.de','ＦＯＯ。example','127.1','xn--fsqu00a.xn--0zwm56d'].map(name=>[domainToASCII(name),domainToUnicode(name)]);
output.files=[];for(const [value,options] of [['/tmp/中文 #?%.txt',{windows:false}],['C:\\test\\中文 #?%.txt',{windows:true}],['\\\\server\\share\\a b',{windows:true}],['/tmp/a!b\'c()~[]',{windows:false}]]){const valueURL=pathToFileURL(value,options);output.files.push([valueURL.href,fileURLToPath(valueURL,options)]);}
output.invalid={url:errorOf(()=>new URL('http://[bad]/')),port:errorOf(()=>new URL('https://x:99999/')),fileScheme:errorOf(()=>fileURLToPath('https://x/')),fileSlash:errorOf(()=>fileURLToPath('file:///a%2fb',{windows:false})),fileHost:errorOf(()=>fileURLToPath('file://remote/a',{windows:false})),tuple:errorOf(()=>new URLSearchParams([['x']])),append:errorOf(()=>new URLSearchParams().append('x')),get:errorOf(()=>new URLSearchParams().get()),objectFile:errorOf(()=>fileURLToPath({}))};
check(Object.prototype.toString.call(u)==='[object URL]','URL brand');
result(output);
