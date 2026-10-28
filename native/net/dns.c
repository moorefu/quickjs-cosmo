#include <arpa/inet.h>
#include <errno.h>
#include <netdb.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include "net.h"
#include "../tasks.h"
#include "../process/binding.h"

enum {ADDRESS_LIMIT=64};
typedef struct {int family;char address[80];} Address;
typedef struct {char *hostname;int family,hints,count,system_error;Address addresses[ADDRESS_LIMIT];} Lookup;
static const char *error_name(int code,int *uv){
    if(code==EAI_AGAIN){*uv=-3001;return "EAI_AGAIN";}
    if(code==EAI_BADFLAGS){*uv=-3002;return "EAI_BADFLAGS";}
    if(code==EAI_FAIL){*uv=-3004;return "EAI_FAIL";}
    if(code==EAI_FAMILY){*uv=-3005;return "EAI_FAMILY";}
    if(code==EAI_MEMORY){*uv=-3006;return "EAI_MEMORY";}
    if(code==EAI_SERVICE){*uv=-3010;return "EAI_SERVICE";}
    if(code==EAI_SOCKTYPE){*uv=-3011;return "EAI_SOCKTYPE";}
    *uv=-3008;return "ENOTFOUND";
}
static JSValue dns_error(JSContext *ctx,Lookup *r,int code){
    int uv;const char *name=error_name(code,&uv);
    if(code==ECANCELED){name="ECANCELLED";uv=-3003;}
    JSValue error=JS_NewError(ctx);if(JS_IsException(error))return error;
    char message[128];snprintf(message,sizeof(message),"getaddrinfo %s",name);
    if(JS_SetPropertyStr(ctx,error,"message",JS_NewString(ctx,message))<0 ||
       JS_SetPropertyStr(ctx,error,"code",JS_NewString(ctx,name))<0 ||
       JS_SetPropertyStr(ctx,error,"errno",JS_NewInt32(ctx,uv))<0 ||
       JS_SetPropertyStr(ctx,error,"syscall",JS_NewString(ctx,"getaddrinfo"))<0 ||
       JS_SetPropertyStr(ctx,error,"hostname",JS_NewString(ctx,r->hostname))<0){JS_FreeValue(ctx,error);return JS_EXCEPTION;}
    if(code==EAI_SYSTEM){
        JSValue detail=js_cosmo_process_error_info(ctx,r->system_error);
        if(JS_IsException(detail)){JS_FreeValue(ctx,error);return detail;}
        JSValue name_value=JS_GetPropertyStr(ctx,detail,"code"),number=JS_GetPropertyStr(ctx,detail,"errno");JS_FreeValue(ctx,detail);
        if(JS_IsException(name_value)||JS_IsException(number)){JS_FreeValue(ctx,name_value);JS_FreeValue(ctx,number);JS_FreeValue(ctx,error);return JS_EXCEPTION;}
        if(JS_SetPropertyStr(ctx,error,"code",name_value)<0){JS_FreeValue(ctx,number);JS_FreeValue(ctx,error);return JS_EXCEPTION;}
        if(JS_SetPropertyStr(ctx,error,"errno",number)<0){JS_FreeValue(ctx,error);return JS_EXCEPTION;}
    }
    return JS_Throw(ctx,error);
}
static int lookup_work(QJSCosmoTask *task){
    Lookup *r=js_cosmo_task_data(task);struct addrinfo hints={0},*addresses=NULL;
    hints.ai_family=r->family==4?AF_INET:r->family==6?AF_INET6:AF_UNSPEC;
    hints.ai_socktype=SOCK_STREAM;hints.ai_protocol=IPPROTO_TCP;
    if(r->hints&32)hints.ai_flags|=AI_ADDRCONFIG;
    if(r->hints&8)hints.ai_flags|=AI_V4MAPPED;
    if(r->hints&16)hints.ai_flags|=AI_ALL;
    int code=getaddrinfo(r->hostname,NULL,&hints,&addresses);r->system_error=errno;
    if(code)return code;
    for(struct addrinfo *p=addresses;p && r->count<ADDRESS_LIMIT;p=p->ai_next){
        Address next={0};
        if(p->ai_family==AF_INET){next.family=4;inet_ntop(AF_INET,&((struct sockaddr_in *)p->ai_addr)->sin_addr,next.address,sizeof(next.address));}
        else if(p->ai_family==AF_INET6){next.family=6;inet_ntop(AF_INET6,&((struct sockaddr_in6 *)p->ai_addr)->sin6_addr,next.address,sizeof(next.address));}
        else continue;
        int duplicate=0;for(int i=0;i<r->count;i++)if(next.family==r->addresses[i].family && !strcmp(next.address,r->addresses[i].address)){duplicate=1;break;}
        if(!duplicate)r->addresses[r->count++]=next;
    }
    freeaddrinfo(addresses);return r->count?0:EAI_NONAME;
}
static JSValue lookup_finish(JSContext *ctx,QJSCosmoTask *task,int error){
    Lookup *r=js_cosmo_task_data(task);if(error)return dns_error(ctx,r,error);
    JSValue result=JS_NewArray(ctx);if(JS_IsException(result))return result;
    for(int i=0;i<r->count;i++){
        JSValue item=JS_NewObject(ctx);if(JS_IsException(item)){JS_FreeValue(ctx,result);return item;}
        if(JS_SetPropertyStr(ctx,item,"address",JS_NewString(ctx,r->addresses[i].address))<0 ||
           JS_SetPropertyStr(ctx,item,"family",JS_NewInt32(ctx,r->addresses[i].family))<0){JS_FreeValue(ctx,item);JS_FreeValue(ctx,result);return JS_EXCEPTION;}
        if(JS_SetPropertyUint32(ctx,result,i,item)<0){JS_FreeValue(ctx,result);return JS_EXCEPTION;}
    }
    return result;
}
static JSValue lookup(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
    if(argc<3 || !JS_IsString(args[0]))return JS_ThrowTypeError(ctx,"Invalid native lookup arguments");
    int family,hints;size_t length;
    if(JS_ToInt32(ctx,&family,args[1])<0 || JS_ToInt32(ctx,&hints,args[2])<0)return JS_EXCEPTION;
    if((family!=0 && family!=4 && family!=6) || (hints&~56))return JS_ThrowRangeError(ctx,"Invalid native lookup options");
    const char *hostname=JS_ToCStringLen(ctx,&length,args[0]);if(!hostname)return JS_EXCEPTION;
    if(memchr(hostname,0,length)){JS_FreeCString(ctx,hostname);return JS_ThrowTypeError(ctx,"Hostname contains NUL");}
    QJSCosmoTask *task=js_cosmo_task_create(ctx,65536+length,sizeof(Lookup),lookup_work,lookup_finish);
    if(!task){JS_FreeCString(ctx,hostname);return JS_EXCEPTION;}
    Lookup *r=js_cosmo_task_data(task);memset(r,0,sizeof(*r));r->family=family;r->hints=hints;
    r->hostname=js_cosmo_task_alloc(task,length+1);
    if(!r->hostname){JS_FreeCString(ctx,hostname);js_cosmo_task_discard(task);return JS_ThrowOutOfMemory(ctx);}
    memcpy(r->hostname,hostname,length+1);JS_FreeCString(ctx,hostname);return js_cosmo_task_submit(ctx,task,NULL);
}
static int strict_ipv4(const char *p){
    int parts=0;
    for(;;){
        const char *begin=p;unsigned value=0;
        while(*p>='0'&&*p<='9'){if(p-begin>=3)return 0;value=value*10+(*p++-'0');}
        if(p==begin||value>255||(p-begin>1&&*begin=='0'))return 0;
        parts++;if(!*p)return parts==4;if(*p++!='.'||parts>=4)return 0;
    }
}
static JSValue ip(JSContext *ctx,JSValueConst self,int argc,JSValueConst *args){
    if(!argc || !JS_IsString(args[0]))return JS_NewInt32(ctx,0);
    size_t length;const char *text=JS_ToCStringLen(ctx,&length,args[0]);if(!text)return JS_EXCEPTION;
    char copy[128];int family=0;uint8_t bytes[16];
    if(length && length<sizeof(copy) && !memchr(text,0,length)){
        memcpy(copy,text,length+1);
        if(strict_ipv4(copy) && inet_pton(AF_INET,copy,bytes)==1)family=4;
        else {
            char *zone=strchr(copy,'%');int valid=1;
            if(zone){*zone++=0;if(!*zone)valid=0;for(char *p=zone;*p;p++)if(!((*p>='a'&&*p<='z')||(*p>='A'&&*p<='Z')||(*p>='0'&&*p<='9')||*p=='_'||*p=='.'||*p=='-'||*p=='~'))valid=0;}
            const char *tail=strrchr(copy,':');
            if(strchr(copy,'.') && (!tail || !strict_ipv4(tail+1)))valid=0;
            if(valid && inet_pton(AF_INET6,copy,bytes)==1)family=6;
        }
    }
    JS_FreeCString(ctx,text);return JS_NewInt32(ctx,family);
}
JSValue js_cosmo_dns_api(JSContext *ctx){
    JSValue api=JS_NewObject(ctx);if(JS_IsException(api))return api;
    if(JS_SetPropertyStr(ctx,api,"lookup",JS_NewCFunction(ctx,lookup,"lookup",3))<0 ||
       JS_SetPropertyStr(ctx,api,"isIP",JS_NewCFunction(ctx,ip,"isIP",1))<0){JS_FreeValue(ctx,api);return JS_EXCEPTION;}
    JSValue constants=JS_NewObject(ctx);if(JS_IsException(constants)){JS_FreeValue(ctx,api);return constants;}
    if(JS_SetPropertyStr(ctx,constants,"ADDRCONFIG",JS_NewInt32(ctx,AI_ADDRCONFIG))<0 ||
       JS_SetPropertyStr(ctx,constants,"V4MAPPED",JS_NewInt32(ctx,AI_V4MAPPED))<0 ||
       JS_SetPropertyStr(ctx,constants,"ALL",JS_NewInt32(ctx,AI_ALL))<0){JS_FreeValue(ctx,constants);JS_FreeValue(ctx,api);return JS_EXCEPTION;}
    if(JS_SetPropertyStr(ctx,api,"constants",constants)<0){JS_FreeValue(ctx,api);return JS_EXCEPTION;}return api;
}
