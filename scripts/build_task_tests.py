#!/usr/bin/env python3
"""Build one self-contained source/bytecode SDK task-pool test executable."""
from pathlib import Path
import subprocess
from build_config import load_config
from host_runtime import ape_command

settings=load_config();root=settings.root;scratch=root/'build/test-linux'
scratch.mkdir(parents=True,exist_ok=True)
fixture=root/'tests/native/task-pool.mjs'
source=fixture.read_bytes()
(scratch/'tasks-source.h').write_text('static const char tasks_source[]={'+','.join(map(str,source))+',0};\n',encoding='utf-8')
generated=scratch/'tasks-bytecode.c'
subprocess.run(list(map(str,ape_command(settings.dist/'qjsc.exe',['-c','-m','-N','tasks_bytecode','-o',generated,fixture],settings.dist))),check=True,cwd=root)
command=[settings.toolchain/'bin/cosmocc','-O2','-I'+str(settings.dist),'-I'+str(scratch),root/'tests/native/task_pool.c',generated,
         settings.dist/'libquickjs.a','-lm','-lpthread','-ldl','-Wl,--wrap=_Exit,-u,__wrap__Exit',
         '-Wl,--wrap=js_malloc_rt,--wrap=pthread_create','-o',scratch/'task-pool-sdk.exe']
subprocess.run(list(map(str,command)),check=True,cwd=root)
print('PASS task-pool SDK build: embedded source and qjsc bytecode')
