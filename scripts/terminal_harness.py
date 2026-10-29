"""Real PTY/ConPTY sessions. Both channels stay drained during bounded teardown."""
import os
from pathlib import Path
import subprocess
import threading
import time


class Session:
    def __init__(self):
        self.output=bytearray();self.inputs=[];self.changed=threading.Condition();self.error=None

    def _received(self,data):
        with self.changed:self.output.extend(data);self.changed.notify_all()

    def wait_for(self,predicate,timeout=8):
        deadline=time.monotonic()+timeout
        with self.changed:
            while not predicate(bytes(self.output)):
                if self.error:raise self.error
                remaining=deadline-time.monotonic()
                if remaining<=0:raise TimeoutError('Terminal marker timeout; output='+repr(bytes(self.output)[-2500:]))
                self.changed.wait(min(remaining,.1))
        return bytes(self.output)

    def save(self,folder):
        folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
        (folder/'output.bin').write_bytes(bytes(self.output));(folder/'input.bin').write_bytes(b''.join(self.inputs))


if os.name!='nt':
    import errno
    import fcntl
    import pty
    import select
    import struct
    import termios

    class UnixSession(Session):
        def __init__(self,command,cwd,env=None,columns=80,rows=24):
            super().__init__();self.master,self.slave=pty.openpty();self.closed=False
            self.resize(columns,rows);self.before=termios.tcgetattr(self.slave)
            def setup():os.setsid();fcntl.ioctl(0,termios.TIOCSCTTY,0)
            try:self.process=subprocess.Popen(list(map(str,command)),stdin=self.slave,stdout=self.slave,stderr=self.slave,cwd=cwd,env=env,preexec_fn=setup)
            except BaseException:os.close(self.master);os.close(self.slave);raise
            self.thread=threading.Thread(target=self._read,daemon=True);self.thread.start()

        def _read(self):
            try:
                while not self.closed:
                    if not select.select([self.master],[],[],.05)[0]:continue
                    try:data=os.read(self.master,65536)
                    except OSError as error:
                        if error.errno in (errno.EIO,errno.EBADF):break
                        raise
                    if not data:break
                    self._received(data)
            except BaseException as error:
                if not self.closed:
                    with self.changed:self.error=error;self.changed.notify_all()

        def write(self,data):
            data=bytes(data);self.inputs.append(data)
            while data:data=data[os.write(self.master,data):]

        def resize(self,columns,rows):fcntl.ioctl(self.slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,columns,0,0))

        def wait(self,timeout=8):return self.process.wait(timeout=timeout)

        def restored(self):return self.before==termios.tcgetattr(self.slave)

        def close(self):
            if self.closed:return
            if self.process.poll() is None:self.process.kill();self.process.wait(timeout=5)
            time.sleep(.03);self.closed=True;self.thread.join(timeout=2)
            try:
                try:termios.tcsetattr(self.slave,termios.TCSANOW,self.before)
                except termios.error as error:
                    # The restoration assertion runs before ACK. A dead
                    # Darwin session may already have revoked the slave.
                    if error.args[0] not in (errno.ENOTTY,errno.EIO) or self.process.poll() is None:raise
            finally:os.close(self.master);os.close(self.slave)
            if self.thread.is_alive():raise RuntimeError('PTY reader did not terminate')

    TerminalSession=UnixSession
else:
    import ctypes as c
    from ctypes import wintypes as w

    class COORD(c.Structure):_fields_=[('X',c.c_short),('Y',c.c_short)]
    class STARTUPINFO(c.Structure):
        _fields_=[('cb',w.DWORD),('reserved',w.LPWSTR),('desktop',w.LPWSTR),('title',w.LPWSTR),
                  ('x',w.DWORD),('y',w.DWORD),('xs',w.DWORD),('ys',w.DWORD),('xc',w.DWORD),('yc',w.DWORD),
                  ('fill',w.DWORD),('flags',w.DWORD),('show',w.WORD),('reservedSize',w.WORD),('reservedBytes',c.c_void_p),
                  ('stdin',w.HANDLE),('stdout',w.HANDLE),('stderr',w.HANDLE)]
    class STARTUPINFOEX(c.Structure):_fields_=[('startup',STARTUPINFO),('attributes',c.c_void_p)]
    class PROCESS_INFORMATION(c.Structure):_fields_=[('process',w.HANDLE),('thread',w.HANDLE),('pid',w.DWORD),('tid',w.DWORD)]
    k=c.WinDLL('kernel32',use_last_error=True)
    signatures={
        'CreatePipe':([c.POINTER(w.HANDLE),c.POINTER(w.HANDLE),c.c_void_p,w.DWORD],w.BOOL),
        'CreatePseudoConsole':([COORD,w.HANDLE,w.HANDLE,w.DWORD,c.POINTER(w.HANDLE)],c.c_long),
        'ResizePseudoConsole':([w.HANDLE,COORD],c.c_long),
        'ClosePseudoConsole':([w.HANDLE],None),
        'CloseHandle':([w.HANDLE],w.BOOL),
        'ReadFile':([w.HANDLE,c.c_void_p,w.DWORD,c.POINTER(w.DWORD),c.c_void_p],w.BOOL),
        'WriteFile':([w.HANDLE,c.c_void_p,w.DWORD,c.POINTER(w.DWORD),c.c_void_p],w.BOOL),
        'InitializeProcThreadAttributeList':([c.c_void_p,w.DWORD,w.DWORD,c.POINTER(c.c_size_t)],w.BOOL),
        'UpdateProcThreadAttribute':([c.c_void_p,w.DWORD,c.c_size_t,c.c_void_p,c.c_size_t,c.c_void_p,c.c_void_p],w.BOOL),
        'DeleteProcThreadAttributeList':([c.c_void_p],None),
        'CreateProcessW':([w.LPCWSTR,w.LPWSTR,c.c_void_p,c.c_void_p,w.BOOL,w.DWORD,c.c_void_p,w.LPCWSTR,c.POINTER(STARTUPINFOEX),c.POINTER(PROCESS_INFORMATION)],w.BOOL),
        'WaitForSingleObject':([w.HANDLE,w.DWORD],w.DWORD),
        'GetExitCodeProcess':([w.HANDLE,c.POINTER(w.DWORD)],w.BOOL),
        'TerminateProcess':([w.HANDLE,w.UINT],w.BOOL),
        'CancelSynchronousIo':([w.HANDLE],w.BOOL),
        'OpenThread':([w.DWORD,w.BOOL,w.DWORD],w.HANDLE),
    }
    for name,(args,result) in signatures.items():getattr(k,name).argtypes=args;getattr(k,name).restype=result

    def check(value,label):
        if not value:raise c.WinError(c.get_last_error(),label)

    class WindowsSession(Session):
        def __init__(self,command,cwd,env=None,columns=80,rows=24):
            super().__init__();self.hpc=w.HANDLE();self.input=w.HANDLE();self.output_handle=w.HANDLE();self.pi=PROCESS_INFORMATION();self.thread=None;self.closed=False
            incoming=w.HANDLE();outgoing=w.HANDLE();attributes=None;attributes_ready=False
            try:
                check(k.CreatePipe(c.byref(incoming),c.byref(self.input),None,0),'CreatePipe input')
                check(k.CreatePipe(c.byref(self.output_handle),c.byref(outgoing),None,0),'CreatePipe output')
                status=k.CreatePseudoConsole(COORD(columns,rows),incoming,outgoing,0,c.byref(self.hpc))
                if status:raise OSError('CreatePseudoConsole failed: '+hex(status&0xffffffff))
                # Start draining before CreateProcess/ClosePseudoConsole can fill a pipe.
                self.thread=threading.Thread(target=self._read,daemon=True);self.thread.start()
                size=c.c_size_t();k.InitializeProcThreadAttributeList(None,1,0,c.byref(size));attributes=c.create_string_buffer(size.value)
                check(k.InitializeProcThreadAttributeList(attributes,1,0,c.byref(size)),'InitializeProcThreadAttributeList')
                attributes_ready=True
                check(k.UpdateProcThreadAttribute(attributes,0,0x20016,self.hpc,c.sizeof(w.HANDLE),None,None),'UpdateProcThreadAttribute')
                # Null std handles force attachment even when this driver is redirected.
                # https://github.com/microsoft/terminal/discussions/15814
                startup=STARTUPINFOEX();startup.startup.cb=c.sizeof(startup);startup.startup.flags=0x100;startup.attributes=c.cast(attributes,c.c_void_p)
                if os.environ.get('QJS_TERMINAL_TRACE'):print('CONPTY_TRACE',self.hpc.value,incoming.value,outgoing.value,self.input.value,self.output_handle.value,c.sizeof(startup),startup.attributes,flush=True)
                line=c.create_unicode_buffer(subprocess.list2cmdline(list(map(str,command))))
                environment=None
                if env is not None:environment=c.create_unicode_buffer('\0'.join(key+'='+str(value) for key,value in sorted(env.items(),key=lambda row:row[0].upper()))+'\0\0')
                check(k.CreateProcessW(str(command[0]),line,None,None,False,0x80000|0x400,environment,str(cwd),c.byref(startup),c.byref(self.pi)),'CreateProcessW')
                k.CloseHandle(incoming);incoming=w.HANDLE();k.CloseHandle(outgoing);outgoing=w.HANDLE()
                k.CloseHandle(self.pi.thread);self.pi.thread=None
            except BaseException:
                self.close();raise
            finally:
                if attributes_ready:k.DeleteProcThreadAttributeList(attributes)
                if incoming:k.CloseHandle(incoming)
                if outgoing:k.CloseHandle(outgoing)

        def _read(self):
            try:
                buffer=c.create_string_buffer(65536);count=w.DWORD()
                while k.ReadFile(self.output_handle,buffer,len(buffer),c.byref(count),None):
                    if not count.value:break
                    self._received(buffer.raw[:count.value])
                error=c.get_last_error()
                if error not in (0,109,995,232) and not self.closed:raise c.WinError(error)
            except BaseException as error:
                if not self.closed:
                    with self.changed:self.error=error;self.changed.notify_all()

        def write(self,data):
            data=bytes(data);self.inputs.append(data);count=w.DWORD()
            while data:
                check(k.WriteFile(self.input,data,len(data),c.byref(count),None),'ConPTY input')
                if not count.value:raise RuntimeError('ConPTY input made no progress')
                data=data[count.value:]

        def resize(self,columns,rows):
            status=k.ResizePseudoConsole(self.hpc,COORD(columns,rows))
            if status:raise OSError('ResizePseudoConsole failed: '+hex(status&0xffffffff))

        def wait(self,timeout=8):
            status=k.WaitForSingleObject(self.pi.process,int(timeout*1000))
            if status==258:raise TimeoutError('ConPTY process timeout')
            if status:raise c.WinError(c.get_last_error())
            code=w.DWORD();check(k.GetExitCodeProcess(self.pi.process,c.byref(code)),'GetExitCodeProcess');return code.value

        def restored(self):raise RuntimeError('Windows restoration requires attached native supervisor evidence')

        def close(self):
            if self.closed:return
            self.closed=True
            if self.pi.process and k.WaitForSingleObject(self.pi.process,0)==258:k.TerminateProcess(self.pi.process,1);k.WaitForSingleObject(self.pi.process,5000)
            if self.hpc:
                # Keep the reader running while ConPTY sends its final frame.
                k.ClosePseudoConsole(self.hpc);self.hpc=None
            if self.input:k.CloseHandle(self.input);self.input=None
            if self.thread:
                self.thread.join(timeout=3)
                if self.thread.is_alive():
                    thread=k.OpenThread(1,False,self.thread.native_id)
                    if thread:k.CancelSynchronousIo(thread);k.CloseHandle(thread)
                    self.thread.join(timeout=2)
            if self.output_handle:k.CloseHandle(self.output_handle);self.output_handle=None
            if self.pi.process:k.CloseHandle(self.pi.process);self.pi.process=None
            if self.thread and self.thread.is_alive():raise RuntimeError('ConPTY reader did not terminate')

    TerminalSession=WindowsSession
