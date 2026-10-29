#include <errno.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "third_party/zlib/zlib.h"
#include "quickjs-libc.h"
#include "module_registry.h"
#include "runtime_state.h"
#include "bundle.h"

enum { SNAPSHOT_MAX=64*1024*1024, MEMBER_MAX=8*1024*1024, MEMBER_COUNT=4096,
       NAME_MAXIMUM=1024, NAMES_MAX=1024*1024, MANIFEST_MAX=64*1024 };
typedef struct {
    char *name;
    uint32_t offset, size, packed, crc, begin, end;
    uint16_t method;
    int directory;
    uint8_t *cache;
} Member;
typedef struct {
    atomic_uint refs;
    unsigned long long id;
    uint8_t *snapshot;
    size_t length, count;
    Member *members;
    pthread_mutex_t mutex;
} Bundle;
static atomic_uint mounts;
static atomic_ullong next_id=1;
static _Thread_local Bundle *inherited;

static JSValue failure(JSContext *ctx, const char *code, const char *message) {
    char text[256];snprintf(text,sizeof(text),"[%s] %s",code,message);
    JSValue error=JS_NewError(ctx);
    if (JS_IsException(error)) return error;
    if (JS_SetPropertyStr(ctx,error,"code",JS_NewString(ctx,code))<0 ||
        JS_SetPropertyStr(ctx,error,"message",JS_NewString(ctx,text))<0) {
        JS_FreeValue(ctx,error); return JS_EXCEPTION;
    }
    return JS_Throw(ctx,error);
}
static uint16_t u16(const uint8_t *p) { return p[0]|(uint16_t)p[1]<<8; }
static uint32_t u32(const uint8_t *p) { return u16(p)|(uint32_t)u16(p+2)<<16; }
static int range(size_t start,size_t length,size_t limit) { return start<=limit && length<=limit-start; }
static int utf8(const uint8_t *s,size_t n) {
    for (size_t i=0;i<n;) {
        unsigned c=s[i++],v,more,min;
        if(c<128) continue;
        if(c>=0xc2&&c<=0xdf) {v=c&31;more=1;min=128;}
        else if(c>=0xe0&&c<=0xef) {v=c&15;more=2;min=2048;}
        else if(c>=0xf0&&c<=0xf4) {v=c&7;more=3;min=65536;}
        else return 0;
        if(more>n-i)return 0;
        while(more--) {c=s[i++];if((c&0xc0)!=0x80)return 0;v=(v<<6)|(c&63);}
        if(v<min||v>0x10ffff||(v>=0xd800&&v<=0xdfff))return 0;
    }
    return 1;
}
static int valid_name(const uint8_t *s,size_t n) {
    if(!n||n>NAME_MAXIMUM||s[0]=='/'||!utf8(s,n))return 0;
    size_t start=0;
    for(size_t i=0;i<=n;i++) {
        if(i<n&&(s[i]<32||s[i]==127||s[i]=='\\'||s[i]==':'||!s[i]))return 0;
        if(i==n||s[i]=='/') {
            size_t len=i-start;
            if(!len) {if(i==n&&i&&s[i-1]=='/')return 1;return 0;}
            if((len==1&&s[start]=='.')||(len==2&&s[start]=='.'&&s[start+1]=='.'))return 0;
            start=i+1;
        }
    }
    return 1;
}
static int extras(const uint8_t *p,size_t n) {
    for(size_t i=0;i<n;) {
        if(!range(i,4,n)||!range(i+4,u16(p+i+2),n)||u16(p+i)==1)return 0;
        i+=4+u16(p+i+2);
    }
    return 1;
}
void *js_cosmo_bundle_retain(void *value) {
    Bundle *b=value;if(b)atomic_fetch_add(&b->refs,1);return b;
}
void js_cosmo_bundle_release(void *value) {
    Bundle *b=value;
    if(!b||atomic_fetch_sub(&b->refs,1)!=1)return;
    for(size_t i=0;i<b->count;i++) {free(b->members[i].name);free(b->members[i].cache);}
    free(b->members);free(b->snapshot);pthread_mutex_destroy(&b->mutex);free(b);atomic_fetch_sub(&mounts,1);
}
void js_cosmo_bundle_enter(void *value) { inherited=value; }
void *js_cosmo_bundle_inherited(void) { return js_cosmo_bundle_retain(inherited); }
static Bundle *current(JSContext *ctx) {
    CosmoRuntimeState *state=NULL;
    if(js_cosmo_lookup_state(ctx,&state)<0)return NULL;
    return state?state->bundle:inherited;
}
void *js_cosmo_bundle_acquire(JSContext *ctx) { return js_cosmo_bundle_retain(current(ctx)); }
static Bundle *open_bundle(JSContext *ctx,const char *filename) {
    if(atomic_fetch_add(&mounts,1)>=4) {atomic_fetch_sub(&mounts,1);failure(ctx,"ERR_QJB_LIMIT","Too many mounted archives");return NULL;}
    Bundle *b=calloc(1,sizeof(*b));
    if(!b) {atomic_fetch_sub(&mounts,1);JS_ThrowOutOfMemory(ctx);return NULL;}
    atomic_init(&b->refs,1);b->id=atomic_fetch_add(&next_id,1);pthread_mutex_init(&b->mutex,NULL);
    FILE *f=fopen(filename,"rb");
    if(!f) {failure(ctx,"ERR_QJB_FORMAT","Cannot open bundle");goto fail;}
    if(fseek(f,0,SEEK_END)||ftell(f)<0) {fclose(f);goto format;}
    long length=ftell(f);
    if(length>SNAPSHOT_MAX) {fclose(f);goto limit;}
    b->length=length;
    b->snapshot=malloc(b->length?b->length:1);
    if(!b->snapshot) {fclose(f);goto memory;}
    if(fseek(f,0,SEEK_SET)||fread(b->snapshot,1,b->length,f)!=b->length) {fclose(f);goto format;}
    fclose(f);
    const uint8_t *s=b->snapshot;
    if(b->length<22)goto format;
    size_t end=b->length-22,lower=end>65535?end-65535:0;
    while(u32(s+end)!=0x06054b50||end+22+u16(s+end+20)!=b->length) {if(end==lower)goto format;end--;}
    if(u16(s+end+4)||u16(s+end+6)||u16(s+end+8)!=u16(s+end+10))goto format;
    size_t count=u16(s+end+10),cd=u32(s+end+16),cd_size=u32(s+end+12);
    if(count==65535||cd==0xffffffff||cd_size==0xffffffff||!range(cd,cd_size,end)||cd+cd_size!=end)goto format;
    if(!count||count>MEMBER_COUNT)goto limit;
    b->members=calloc(count,sizeof(Member));if(!b->members)goto memory;
    size_t pos=cd,total=0,names=0;
    for(size_t i=0;i<count;i++) {
        if(!range(pos,46,end)||u32(s+pos)!=0x02014b50)goto format;
        const uint8_t *p=s+pos;
        uint16_t flags=u16(p+8),method=u16(p+10),n=u16(p+28),extra=u16(p+30),comment=u16(p+32);
        uint32_t size=u32(p+24),packed=u32(p+20),offset=u32(p+42),crc=u32(p+16),mode=u32(p+38)>>16;
        if(u16(p+6)>20||flags&~(0x800|8|6)||((flags&6)&&method!=8)||(method!=0&&method!=8)||u16(p+34))goto format;
        if(size==0xffffffff||packed==0xffffffff||offset==0xffffffff||!range(pos+46,(size_t)n+extra+comment,end))goto format;
        if(size>MEMBER_MAX||total>SNAPSHOT_MAX-size||names>NAMES_MAX-n)goto limit;
        if(!valid_name(p+46,n)||!extras(p+46+n,extra))goto path;
        int directory=p[46+n-1]=='/';
        if((mode&0170000)&&((mode&0170000)!=(directory?0040000:0100000)))goto format;
        if((u32(p+38)&16)&&!directory)goto format;
        if(directory&&(size||packed||crc))goto format;
        if(method==0&&size!=packed)goto format;
        Member *m=&b->members[b->count++];
        m->name=malloc(n+1);if(!m->name)goto memory;
        memcpy(m->name,p+46,n);m->name[n]=0;
        /* Directory and file spellings must not alias each other. */
        for(size_t j=0;j<i;j++) {
            size_t a=strlen(b->members[j].name),aa=a-b->members[j].directory,bb=n-directory;
            if(aa==bb&&!memcmp(b->members[j].name,m->name,aa))goto path;
            if(!b->members[j].directory&&n>a&&m->name[a]=='/'&&!memcmp(m->name,b->members[j].name,a))goto path;
            if(!directory&&a>n&&b->members[j].name[n]=='/'&&!memcmp(m->name,b->members[j].name,n))goto path;
        }
        if(!range(offset,30,cd)||u32(s+offset)!=0x04034b50)goto format;
        const uint8_t *local=s+offset;
        size_t ln=u16(local+26),le=u16(local+28),data=(size_t)offset+30+ln+le;
        if(u16(local+4)>20||u16(local+6)!=flags||u16(local+8)!=method||ln!=n||!range(offset+30,ln+le,cd)||
           memcmp(local+30,p+46,n)||!extras(local+30+ln,le)||!range(data,packed,cd))goto format;
        if(!(flags&8)) {if(u32(local+14)!=crc||u32(local+18)!=packed||u32(local+22)!=size)goto format;}
        else if((u32(local+14)&&u32(local+14)!=crc)||(u32(local+18)&&u32(local+18)!=packed)||(u32(local+22)&&u32(local+22)!=size))goto format;
        size_t finish=data+packed;
        if(flags&8) {
            if(range(finish,4,cd)&&u32(s+finish)==0x08074b50)finish+=4;
            if(!range(finish,12,cd)||u32(s+finish)!=crc||u32(s+finish+4)!=packed||u32(s+finish+8)!=size)goto format;
            finish+=12;
        }
        for(size_t j=0;j<i;j++)if(offset<b->members[j].end&&finish>b->members[j].begin)goto format;
        m->offset=data;m->size=size;m->packed=packed;m->crc=crc;m->method=method;m->directory=directory;m->begin=offset;m->end=finish;
        total+=size;names+=n;pos+=46+n+extra+comment;
    }
    if(pos!=end)goto format;
    return b;
path: failure(ctx,"ERR_QJB_PATH","Invalid or conflicting archive path");goto fail;
format: failure(ctx,"ERR_QJB_FORMAT","Invalid or unsupported ZIP archive");goto fail;
limit: failure(ctx,"ERR_QJB_LIMIT","Archive exceeds QJB limits");goto fail;
memory: JS_ThrowOutOfMemory(ctx);
fail: js_cosmo_bundle_release(b);return NULL;
}
static Member *find(Bundle *b,const char *name) {
    for(size_t i=0;i<b->count;i++)if(!strcmp(b->members[i].name,name))return &b->members[i];
    return NULL;
}
static const uint8_t *read_member(JSContext *ctx,Bundle *b,Member *m) {
    if(!m||m->directory) {failure(ctx,"ERR_QJB_MEMBER","Bundle member does not exist or is a directory");return NULL;}
    pthread_mutex_lock(&b->mutex);
    if(!m->cache) {
        uint8_t *data=malloc((size_t)m->size+1);
        if(!data) {pthread_mutex_unlock(&b->mutex);JS_ThrowOutOfMemory(ctx);return NULL;}
        int valid=1;
        if(!m->method)memcpy(data,b->snapshot+m->offset,m->size);
        else {
            z_stream z={0};
            int code=inflateInit2(&z,-15);
            if(code!=Z_OK)valid=0;
            else {
                z.next_in=b->snapshot+m->offset;z.avail_in=m->packed;z.next_out=data;z.avail_out=m->size+1;
                code=inflate(&z,Z_FINISH);
                valid=code==Z_STREAM_END&&z.total_out==m->size&&z.total_in==m->packed;
                inflateEnd(&z);
            }
        }
        if(valid)valid=crc32(0,data,m->size)==m->crc;
        if(!valid) {free(data);pthread_mutex_unlock(&b->mutex);failure(ctx,"ERR_QJB_FORMAT","Bundle member size, DEFLATE or CRC mismatch");return NULL;}
        data[m->size]=0;m->cache=data;
    }
    const uint8_t *data=m->cache;pthread_mutex_unlock(&b->mutex);return data;
}
static int hex(int c) {return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;}
static char *decode(const char *s) {
    size_t n=strlen(s),k=0;char *p=malloc(n+1);if(!p)return NULL;
    for(size_t i=0;i<n;i++) {
        unsigned c=(uint8_t)s[i];
        if(c=='\\'||c=='?'||c=='#'||c<32||c==127)goto fail;
        if(c=='%') {
            if(i+2>=n||hex(s[i+1])<0||hex(s[i+2])<0)goto fail;
            c=hex(s[i+1])*16+hex(s[i+2]);i+=2;
            if(c=='/'||c=='\\'||c<32||c==127)goto fail;
        }
        p[k++]=c;
    }
    if(!utf8((uint8_t *)p,k))goto fail;
    p[k]=0;return p;
fail: free(p);return NULL;
}
static const char *address_path(Bundle *b,const char *s) {
    char prefix[64];snprintf(prefix,sizeof(prefix),"qjb://%llu/",b->id);
    size_t n=strlen(prefix);return !strncmp(s,prefix,n)?s+n:NULL;
}
static char *encode(JSContext *ctx,Bundle *b,const char *path) {
    static const char digits[]="0123456789ABCDEF";
    size_t n=strlen(path);char *p=js_malloc(ctx,64+n*3),*out=p;
    if(!p)return NULL;
    out+=sprintf(out,"qjb://%llu/",b->id);
    for(size_t i=0;i<n;i++) {
        unsigned c=(uint8_t)path[i];
        if((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||strchr("-._~/",c))*out++=c;
        else {*out++='%';*out++=digits[c>>4];*out++=digits[c&15];}
    }
    *out=0;return p;
}
char *js_cosmo_bundle_resolve(JSContext *ctx,const char *base,const char *name) {
    Bundle *b=current(ctx);char *parent=NULL,*input=NULL,*joined=NULL,*result=NULL;
    if(!b) {failure(ctx,"ERR_QJB_MOUNT","No bundle is mounted");return NULL;}
    if(strlen(base)>64+NAME_MAXIMUM*6||strlen(name)>64+NAME_MAXIMUM*6)goto path;
    const char *bp=address_path(b,base),*np=NULL;
    if(!bp)goto mount;
    parent=decode(bp);if(!parent)goto path;
    if(!strncmp(name,"qjb:",4)) {np=address_path(b,name);if(!np)goto mount;}
    else if(name[0]=='/')np=name+1;
    else if(name[0]=='.'&&(name[1]=='/'||(name[1]=='.'&&name[2]=='/')))np=name;
    else goto path;
    input=decode(np);if(!input)goto path;
    size_t dir=0;
    if(np==name) {char *slash=strrchr(parent,'/');dir=slash?slash-parent+1:0;}
    size_t len=dir+strlen(input);
    if(len>NAME_MAXIMUM*2)goto path;
    joined=malloc(len+1);if(!joined)goto memory;
    memcpy(joined,parent,dir);strcpy(joined+dir,input);
    size_t read=0,write=0,depth=0;uint16_t segments[NAME_MAXIMUM];
    while(joined[read]) {
        size_t start=read;while(joined[read]&&joined[read]!='/')read++;
        size_t n=read-start;if(joined[read])read++;
        if(!n)goto path;
        if(n==1&&joined[start]=='.')continue;
        if(n==2&&joined[start]=='.'&&joined[start+1]=='.') {if(!depth)goto path;write=segments[--depth];continue;}
        segments[depth++]=write;
        if(write)joined[write++]='/';
        memmove(joined+write,joined+start,n);write+=n;
    }
    joined[write]=0;
    if(!valid_name((uint8_t *)joined,write))goto path;
    result=encode(ctx,b,joined);goto done;
mount: failure(ctx,"ERR_QJB_MOUNT","Unknown or foreign bundle address");goto done;
path: failure(ctx,"ERR_QJB_PATH","Invalid bundle specifier or root escape");goto done;
memory: JS_ThrowOutOfMemory(ctx);
done: free(parent);free(input);free(joined);return result;
}
static Member *url_member(JSContext *ctx,Bundle *b,const char *url) {
    const char *p=b?address_path(b,url):NULL;
    if(!p) {failure(ctx,"ERR_QJB_MOUNT","Unknown bundle address");return NULL;}
    if(strlen(p)>NAME_MAXIMUM*3) {failure(ctx,"ERR_QJB_PATH","Bundle address exceeds path budget");return NULL;}
    char *path=decode(p);
    if(!path||!valid_name((uint8_t *)path,strlen(path))) {free(path);failure(ctx,"ERR_QJB_PATH","Invalid bundle address");return NULL;}
    char *canonical=encode(ctx,b,path);
    if(!canonical) {free(path);return NULL;}
    int exact=!strcmp(canonical,url);js_free(ctx,canonical);
    if(!exact) {free(path);failure(ctx,"ERR_QJB_PATH","Resource address must be canonical; use resolve");return NULL;}
    Member *m=find(b,path);free(path);
    if(!m||m->directory) {failure(ctx,"ERR_QJB_MEMBER","Missing bundle file");return NULL;}
    return m;
}
JSModuleDef *js_cosmo_bundle_load(JSContext *ctx,const char *name) {
    Bundle *b=current(ctx);Member *m=url_member(ctx,b,name);
    if(!m)return NULL;
    const uint8_t *source=read_member(ctx,b,m);if(!source)return NULL;
    if(!utf8(source,m->size)) {failure(ctx,"ERR_QJB_UTF8","Module source must be UTF-8");return NULL;}
    JSValue code=JS_Eval(ctx,(const char *)source,m->size,name,JS_EVAL_TYPE_MODULE|JS_EVAL_FLAG_COMPILE_ONLY);
    if(JS_IsException(code))return NULL;
    if(js_module_set_import_meta(ctx,code,0,0)<0) {JS_FreeValue(ctx,code);return NULL;}
    JSModuleDef *module=JS_VALUE_GET_PTR(code);JS_FreeValue(ctx,code);return module;
}
static JSValue bundle_call(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv,int magic) {
    (void)self;
    if(argc<(magic==0?2:1)||!JS_IsString(argv[0])||(magic==0&&!JS_IsString(argv[1])))return JS_ThrowTypeError(ctx,"Expected bundle address strings");
    size_t n;const char *name=JS_ToCStringLen(ctx,&n,argv[0]);if(!name)return JS_EXCEPTION;
    if(memchr(name,0,n)) {JS_FreeCString(ctx,name);return failure(ctx,"ERR_QJB_PATH","NUL in bundle address");}
    JSValue result=JS_EXCEPTION;
    if(!magic) {
        size_t bn;const char *base=JS_ToCStringLen(ctx,&bn,argv[1]);
        if(base) {
            if(memchr(base,0,bn))failure(ctx,"ERR_QJB_PATH","NUL in bundle base");
            else {char *url=js_cosmo_bundle_resolve(ctx,base,name);if(url) {result=JS_NewString(ctx,url);js_free(ctx,url);}}
            JS_FreeCString(ctx,base);
        }
    } else {
        Bundle *b=current(ctx);Member *m=url_member(ctx,b,name);
        const uint8_t *data=m?read_member(ctx,b,m):NULL;
        if(data) {
            if(magic==2&&!utf8(data,m->size))failure(ctx,"ERR_QJB_UTF8","Resource is not valid UTF-8");
            else result=magic==2?JS_NewStringLen(ctx,(const char *)data,m->size):JS_NewArrayBufferCopy(ctx,data,m->size);
        }
    }
    JS_FreeCString(ctx,name);return result;
}
JSValue js_cosmo_bundle_api(JSContext *ctx) {
    JSValue api=JS_NewObject(ctx);if(JS_IsException(api))return api;
    const char *keys[]={"resolve","read","readText"};
    for(int i=0;i<3;i++) {
        JSValue fn=JS_NewCFunctionMagic(ctx,bundle_call,keys[i],i?1:2,JS_CFUNC_generic_magic,i);
        if(JS_IsException(fn)||JS_SetPropertyStr(ctx,api,keys[i],fn)<0) {JS_FreeValue(ctx,api);return JS_EXCEPTION;}
    }
    return api;
}
int js_cosmo_bundle_eval(JSContext *ctx,const char *filename) {
    CosmoRuntimeState *state=js_cosmo_state(ctx);if(!state)return -1;
    if(state->bundle) {failure(ctx,"ERR_QJB_MOUNT","Context already has a bundle");return -1;}
    Bundle *b=open_bundle(ctx,filename);if(!b)return -1;
    state->bundle=b;
    Member *manifest=find(b,"bundle.json");
    if(!manifest||manifest->size>MANIFEST_MAX) {failure(ctx,"ERR_QJB_FORMAT","Missing or oversized bundle.json");return -1;}
    const uint8_t *bytes=read_member(ctx,b,manifest);if(!bytes)return -1;
    if(!utf8(bytes,manifest->size)) {failure(ctx,"ERR_QJB_UTF8","Manifest must be UTF-8");return -1;}
    JSValue json=JS_ParseJSON(ctx,(const char *)bytes,manifest->size,"bundle.json");
    if(JS_IsException(json)) {JSValue error=JS_GetException(ctx);JS_FreeValue(ctx,error);failure(ctx,"ERR_QJB_FORMAT","Manifest is not valid JSON");return -1;}
    JSValue format=JS_GetPropertyStr(ctx,json,"format"),version=JS_GetPropertyStr(ctx,json,"formatVersion"),
            entry=JS_GetPropertyStr(ctx,json,"entry"),type=JS_GetPropertyStr(ctx,json,"type");
    size_t en=0,fn=0,tn=0;const char *f=JS_IsString(format)?JS_ToCStringLen(ctx,&fn,format):NULL,
        *e=JS_IsString(entry)?JS_ToCStringLen(ctx,&en,entry):NULL,
        *t=JS_IsUndefined(type)?NULL:JS_IsString(type)?JS_ToCStringLen(ctx,&tn,type):NULL;
    int module=JS_IsUndefined(type)||(t&&tn==6&&!strcmp(t,"module"));
    double v=0;int valid=JS_IsNumber(version)&&!JS_ToFloat64(ctx,&v,version)&&v==1&&f&&fn==3&&!strcmp(f,"qjb")&&e&&
        !memchr(e,0,en)&&valid_name((const uint8_t *)e,en)&&e[en-1]!='/'&&(JS_IsUndefined(type)||(t&&tn==6&&(!strcmp(t,"module")||!strcmp(t,"script"))));
    if(valid&&en>=4&&!strcmp(e+en-4,".mjs")&&!module)valid=0;
    Member *m=valid?find(b,e):NULL;
    char *url=valid?encode(ctx,b,e):NULL;
    JS_FreeCString(ctx,f);JS_FreeCString(ctx,e);JS_FreeCString(ctx,t);
    JS_FreeValue(ctx,format);JS_FreeValue(ctx,version);JS_FreeValue(ctx,entry);JS_FreeValue(ctx,type);JS_FreeValue(ctx,json);
    if(!valid) {failure(ctx,"ERR_QJB_FORMAT","Invalid QJB v1 manifest or entry mode");return -1;}
    if(!url)return -1;
    const uint8_t *source=read_member(ctx,b,m);
    if(!source) {js_free(ctx,url);return -1;}
    if(!utf8(source,m->size)) {js_free(ctx,url);failure(ctx,"ERR_QJB_UTF8","Entry source must be UTF-8");return -1;}
    JSValue value=JS_Eval(ctx,(const char *)source,m->size,url,module?JS_EVAL_TYPE_MODULE|JS_EVAL_FLAG_COMPILE_ONLY:JS_EVAL_TYPE_GLOBAL);
    if(module&&!JS_IsException(value)) {
        if(js_module_set_import_meta(ctx,value,0,1)<0) {JS_FreeValue(ctx,value);value=JS_EXCEPTION;}
        else value=JS_EvalFunction(ctx,value);
        value=js_std_await(ctx,value);
    }
    js_free(ctx,url);int failed=JS_IsException(value);JS_FreeValue(ctx,value);return failed?-1:0;
}
