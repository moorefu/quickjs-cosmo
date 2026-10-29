"""Windows acceptance helpers using only the caller's own restricted tokens.

No elevation, account creation, privilege grants or system-wide ACL changes.
CreateProcessAsUser may require rights absent from interactive user tokens;
that is reported as permission-denied, never as a successful integrity test.
"""
import ctypes as C
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import subprocess
import sys


class SID_ATTRIBUTES(C.Structure):_fields_=[('Sid',C.c_void_p),('Attributes',W.DWORD)]
class STARTUP(C.Structure):
    _fields_=[('cb',W.DWORD),('reserved',W.LPWSTR),('desktop',W.LPWSTR),('title',W.LPWSTR),
        *[(n,W.DWORD) for n in ('x','y','xs','ys','xc','yc','fill','flags')],('show',W.WORD),('cb2',W.WORD),('reserved2',C.c_void_p),
        ('stdin',W.HANDLE),('stdout',W.HANDLE),('stderr',W.HANDLE)]
class PROCESS(C.Structure):_fields_=[('process',W.HANDLE),('thread',W.HANDLE),('pid',W.DWORD),('tid',W.DWORD)]


def api():
    kernel=C.WinDLL('kernel32',use_last_error=True);adv=C.WinDLL('advapi32',use_last_error=True)
    for dll,name,args,result in (
        (kernel,'GetCurrentProcess',[],W.HANDLE),(kernel,'CloseHandle',[W.HANDLE],W.BOOL),
        (kernel,'OpenProcess',[W.DWORD,W.BOOL,W.DWORD],W.HANDLE),
        (kernel,'WaitForSingleObject',[W.HANDLE,W.DWORD],W.DWORD),
        (kernel,'GetExitCodeProcess',[W.HANDLE,C.POINTER(W.DWORD)],W.BOOL),
        (kernel,'TerminateProcess',[W.HANDLE,W.UINT],W.BOOL),
        (kernel,'LocalFree',[C.c_void_p],C.c_void_p),
        (adv,'OpenProcessToken',[W.HANDLE,W.DWORD,C.POINTER(W.HANDLE)],W.BOOL),
        (adv,'GetTokenInformation',[W.HANDLE,C.c_int,C.c_void_p,W.DWORD,C.POINTER(W.DWORD)],W.BOOL),
        (adv,'SetTokenInformation',[W.HANDLE,C.c_int,C.c_void_p,W.DWORD],W.BOOL),
        (adv,'ConvertStringSidToSidW',[W.LPCWSTR,C.POINTER(C.c_void_p)],W.BOOL),
        (adv,'GetLengthSid',[C.c_void_p],W.DWORD),
        (adv,'ConvertSidToStringSidW',[C.c_void_p,C.POINTER(W.LPWSTR)],W.BOOL),
        (adv,'ConvertStringSecurityDescriptorToSecurityDescriptorW',[W.LPCWSTR,W.DWORD,C.POINTER(C.c_void_p),C.POINTER(W.DWORD)],W.BOOL),
        (adv,'SetKernelObjectSecurity',[W.HANDLE,W.DWORD,C.c_void_p],W.BOOL),
        (adv,'GetSidSubAuthorityCount',[C.c_void_p],C.POINTER(C.c_ubyte)),
        (adv,'GetSidSubAuthority',[C.c_void_p,W.DWORD],C.POINTER(W.DWORD)),
        (adv,'CreateRestrictedToken',[W.HANDLE,W.DWORD,W.DWORD,C.c_void_p,W.DWORD,C.c_void_p,W.DWORD,C.c_void_p,C.POINTER(W.HANDLE)],W.BOOL),
        (adv,'CreateProcessAsUserW',[W.HANDLE,W.LPCWSTR,W.LPWSTR,C.c_void_p,C.c_void_p,W.BOOL,W.DWORD,C.c_void_p,W.LPCWSTR,C.POINTER(STARTUP),C.POINTER(PROCESS)],W.BOOL)):
        function=getattr(dll,name);function.argtypes=args;function.restype=result
    return kernel,adv


def checked(value):
    if not value:raise C.WinError(C.get_last_error())
    return value


def integrity(token=None):
    kernel,adv=api();owned=token is None
    if owned:token=W.HANDLE();checked(adv.OpenProcessToken(kernel.GetCurrentProcess(),8,C.byref(token)))
    try:
        length=W.DWORD();adv.GetTokenInformation(token,25,None,0,C.byref(length))
        if not 0<length.value<=65536:raise ValueError('Invalid token integrity information length')
        buffer=C.create_string_buffer(length.value);checked(adv.GetTokenInformation(token,25,buffer,length,C.byref(length)))
        label=C.cast(buffer,C.POINTER(SID_ATTRIBUTES)).contents
        count=adv.GetSidSubAuthorityCount(label.Sid)[0]
        if not count:raise ValueError('Empty integrity SID')
        return adv.GetSidSubAuthority(label.Sid,count-1)[0]
    finally:
        if owned:kernel.CloseHandle(token)


def process_state(pid):
    kernel,_=api();handle=kernel.OpenProcess(0x101000,False,pid)
    if not handle:
        error=C.get_last_error()
        return dict(status='permission-denied' if error==5 else 'unobservable',winerror=error)
    try:
        wait=kernel.WaitForSingleObject(handle,0)
        if wait==258:return dict(status='running')
        if wait!=0:return dict(status='unobservable',winerror=C.get_last_error())
        code=W.DWORD()
        if not kernel.GetExitCodeProcess(handle,C.byref(code)):return dict(status='unobservable',winerror=C.get_last_error())
        return dict(status='exited',exitCode=code.value)
    finally:kernel.CloseHandle(handle)


def deny_process_query(handle):
    """Change only an owned fixture process; retained creator handles still work."""
    kernel,adv=api();token=W.HANDLE();text=W.LPWSTR();descriptor=C.c_void_p()
    try:
        checked(adv.OpenProcessToken(kernel.GetCurrentProcess(),8,C.byref(token)))
        length=W.DWORD();adv.GetTokenInformation(token,1,None,0,C.byref(length))
        buffer=C.create_string_buffer(length.value);checked(adv.GetTokenInformation(token,1,buffer,length,C.byref(length)))
        checked(adv.ConvertSidToStringSidW(C.cast(buffer,C.POINTER(SID_ATTRIBUTES)).contents.Sid,C.byref(text)))
        sddl='D:(D;;0x101000;;;'+text.value+')(A;;GA;;;'+text.value+')'
        checked(adv.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl,1,C.byref(descriptor),None))
        checked(adv.SetKernelObjectSecurity(W.HANDLE(int(handle)),4,descriptor))
    finally:
        if descriptor:kernel.LocalFree(descriptor)
        if text:kernel.LocalFree(C.cast(text,C.c_void_p))
        if token:kernel.CloseHandle(token)


def launch_restricted(rid,command,environment,cwd,timeout=60):
    kernel,adv=api();original=W.HANDLE();token=W.HANDLE();sid=C.c_void_p();process=PROCESS()
    try:
        checked(adv.OpenProcessToken(kernel.GetCurrentProcess(),0x8b,C.byref(original)))
        checked(adv.CreateRestrictedToken(original,1,0,None,0,None,0,None,C.byref(token)))
        if rid>integrity(original):return dict(status='permission-denied',reason='Requested integrity exceeds caller; run the acceptance script from an elevated console')
        checked(adv.ConvertStringSidToSidW('S-1-16-'+str(rid),C.byref(sid)))
        label=SID_ATTRIBUTES(sid,0x20)
        checked(adv.SetTokenInformation(token,25,C.byref(label),C.sizeof(label)+adv.GetLengthSid(sid)))
        actual=integrity(token)
        if actual!=rid:raise ValueError('Restricted token integrity was not applied')
        startup=STARTUP();startup.cb=C.sizeof(startup)
        block=C.create_unicode_buffer('\0'.join(k+'='+v for k,v in sorted(environment.items(),key=lambda v:v[0].upper()))+'\0\0')
        line=C.create_unicode_buffer(subprocess.list2cmdline([str(v) for v in command]))
        checked(adv.CreateProcessAsUserW(token,str(command[0]),line,None,None,False,0x08000400,block,str(cwd),C.byref(startup),C.byref(process)))
        wait=kernel.WaitForSingleObject(process.process,timeout*1000)
        if wait!=0:
            kernel.TerminateProcess(process.process,124);kernel.WaitForSingleObject(process.process,5000)
            raise TimeoutError('Restricted acceptance child did not finish')
        code=W.DWORD();checked(kernel.GetExitCodeProcess(process.process,C.byref(code)))
        return dict(status='executed',integrity=actual,pid=process.pid,exitCode=code.value)
    except OSError as error:
        if error.winerror in (5,1314):return dict(status='permission-denied',winerror=error.winerror)
        raise
    finally:
        for handle in (process.thread,process.process,token,original):
            if handle:kernel.CloseHandle(handle)
        if sid:kernel.LocalFree(sid)


def child(config):
    value=json.loads(Path(config).read_text(encoding='utf8'));result=Path(value['result'])
    proof=dict(integrity=integrity(),parent=process_state(value['parent']),checks=[])
    try:
        if proof['integrity']!=value['integrity'] or proof['parent']['status']=='exited':raise ValueError('Integrity or known-live parent classification failed')
        proof['deniedTarget']=process_state(value['deniedTarget'])
        if proof['deniedTarget']['status']!='permission-denied':raise ValueError('Known-live denied target was misclassified')
        for entry in value['entries']:
            run=subprocess.run(entry['command'],env=value['environment'],cwd=value['cwd'],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=45)
            rows=[json.loads(v.partition(' ')[2]) for v in run.stdout.splitlines() if v.startswith('DEPLOYMENT_SECURITY ')]
            if run.returncode or len(rows)!=1 or not rows[0].get('signalRoundTrip') or not rows[0].get('worker') or not rows[0].get('child'):raise ValueError(entry['name']+': '+run.stdout+run.stderr)
            proof['checks'].append(dict(entry=entry['name'],value=rows[0]))
        proof['passed']=True
    except Exception as error:proof.update(passed=False,error=str(error))
    result.write_text(json.dumps(proof,indent=2)+'\n',encoding='utf8')
    return 0 if proof['passed'] else 1


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--child':raise SystemExit(child(sys.argv[2]))
    raise SystemExit('Use scripts/test_windows_deployment.py for acceptance')
