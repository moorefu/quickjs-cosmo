#!/usr/bin/env python3
"""Build an auditable 64K runtime overlay; retain the original Nightly archive."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile

from ape_layout import inspect
from bootstrap import extract_zip
from build_config import load_config
from prepare_native import prepare_source, sha256, source_name, write_member

SOURCES = ('scripts/prepare_toolchain.py', 'scripts/ape_layout.py', 'scripts/bootstrap.py',
           'scripts/build_config.py', 'compat/patches/apelink-64k.patch',
           'compat/patches/tls-flags.patch',
           'versions.json', 'native/versions.json')
COMMANDS = []


def role(name):
    if name.startswith('include/') or name.endswith('.h'):return 'headers'
    if name.endswith('/libcosmo.a'):return 'libcosmo'
    if '/crt' in name and name.endswith('.o'):return 'crt'
    if name.startswith('bin/ape-'):return 'loaders'
    if name == 'bin/apelink':return 'apelink'
    if name.startswith('bin/') and name.split('/')[-1] in ('cosmocc','cosmoc++','cosmocross','cosmoar','cosmoranlib','cosmoinstall'):return 'drivers'
    return 'support-tools-and-libraries'


def validate_record(settings, record):
    expected=inputs(settings)
    actual=record['inputs']
    if any(actual.get(key)!=expected[key] for key in ('schema','archive','source','files')):
        raise ValueError('Runtime toolchain provenance does not match maintained inputs')
    original,installed=record['original'],record['installed']
    if not original or set(original)!=set(installed):raise ValueError('Toolchain component inventory is incomplete')
    for name in ('bin/cosmocc','bin/apelink','bin/ape-aarch64.elf','bin/ape-x86_64.elf',
                 'aarch64-linux-cosmo/lib/crt.o','x86_64-linux-cosmo/lib/crt.o',
                 'aarch64-linux-cosmo/lib/libcosmo.a','x86_64-linux-cosmo/lib/libcosmo.a'):
        if name not in installed:raise ValueError('Missing toolchain component: '+name)
    roles={}
    for name in installed:roles.setdefault(role(name),[]).append(name)
    if roles!=record['roles'] or not installed.get('include/stdio.h') or not record.get('commands'):
        raise ValueError('Missing toolchain roles or rebuild commands')
    changes={name:dict(before=original[name],after=value) for name,value in installed.items() if original[name]!=value}
    if changes!=record['changes'] or any(name not in changes for name in ('bin/apelink','bin/cosmocc','bin/ape-aarch64.elf')):
        raise ValueError('Missing reviewed toolchain overrides')
    return record


def inputs(settings):
    return dict(schema=1, archive=settings.data['cosmopolitan'],
                source=json.loads((settings.root/'native/versions.json').read_text())['cosmopolitan'],
                host=dict(system=platform.system(), machine=platform.machine()),
                files={name: sha256(settings.root/name) for name in SOURCES})


def inventory(root):
    result = {}
    for path in sorted(root.rglob('*')):
        name = path.relative_to(root).as_posix()
        if name == '.runtime-toolchain.json':
            continue
        if path.is_symlink():
            result[name] = dict(link=os.readlink(path))
        elif path.is_file():
            result[name] = dict(bytes=path.stat().st_size, sha256=sha256(path))
    return result


def run(command, **kwargs):
    COMMANDS.append(dict(argv=[str(v) for v in command],cwd=str(kwargs.get('cwd',Path.cwd()))))
    subprocess.run([str(v) for v in command], check=True, **kwargs)


def host_tools(root):
    """Only disposable overlay tools are assimilated, never runtime payloads."""
    if platform.system() != 'Linux':
        return
    arch = 'aarch64' if platform.machine().lower() in ('arm64', 'aarch64') else 'x86_64'
    loader = root/f'bin/ape-{arch}.elf'
    paths = []
    for path in root.rglob('*'):
        if path.is_file() and not path.is_symlink():
            with path.open('rb') as stream:
                if stream.read(2) == b'MZ':
                    paths.append(path)
    if paths:
        run([loader, root/'bin/assimilate', '-e', '-a' if arch == 'aarch64' else '-x', '-c', *paths])


def prepare(settings, offline=False):
    if os.name != 'posix':
        raise ValueError('Build the runtime toolchain in Linux/WSL or macOS')
    expected = inputs(settings)
    if sha256(settings.archive) != settings.data['cosmopolitan']['sha256']:
        raise ValueError('Nightly toolchain archive checksum mismatch')
    marker = settings.toolchain/'.runtime-toolchain.json'
    if marker.is_file():
        record = json.loads(marker.read_text())
        if record.get('inputs') == expected:
            validate_record(settings, record)
            if inventory(settings.toolchain) != record['installed']:
                raise ValueError('Installed runtime toolchain changed; restore this generated overlay')
            print('Verified runtime toolchain:', settings.toolchain, flush=True)
            return record
    native = prepare_source(offline=offline)
    private = settings.root/'build/runtime-toolchain-source'
    private.mkdir(parents=True, exist_ok=True)
    source = expected['source']
    with tarfile.open(settings.root/'.cache'/source['archive'], 'r:gz') as bundle:
        for member in bundle:
            name = source_name(member.name, 'cosmopolitan-'+source['commit'])
            if name.startswith('tool/build/') and member.isfile():
                write_member(bundle, member, private/name)
    run(['patch', '--batch', '--fuzz=0', '-p1', '-i', settings.root/'compat/patches/apelink-64k.patch'], cwd=private)
    tls_source=private/'libc/sysv/tlsasm.S';tls_source.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(native/'libc/sysv/tlsasm.S',tls_source)
    run(['patch', '--batch', '--fuzz=0', '-p1', '-i', settings.root/'compat/patches/tls-flags.patch'], cwd=private)
    stage = settings.toolchain.with_name(settings.toolchain.name+'.staging')
    for path in (stage, settings.toolchain):
        if path.parent.resolve() != (settings.root/'toolchains').resolve() or path.is_symlink():
            raise ValueError('Unsafe toolchain output')
        if path.exists():
            shutil.rmtree(path)
    stage.mkdir()
    print('Extracting independent runtime toolchain overlay', flush=True)
    extract_zip(settings.archive, stage)
    original = inventory(stage)
    host_tools(stage)
    objects = settings.root/'build/runtime-toolchain-objects'
    objects.mkdir(parents=True, exist_ok=True)
    tls_object=objects/'tlsasm.o'
    run([stage/'bin/x86_64-linux-cosmo-gcc','-D_COSMO_SOURCE','-c','-iquote'+str(native),'-o',tls_object,tls_source])
    for flavor in ('','dbg/'):
        archive=stage/('x86_64-linux-cosmo/lib/'+flavor+'libcosmo.a')
        members=subprocess.check_output([str(stage/'bin/x86_64-linux-cosmo-ar'),'t',str(archive)],text=True).splitlines()
        if members.count('tlsasm.o')!=1:raise ValueError('Pinned TLS archive member changed')
        run([stage/'bin/x86_64-linux-cosmo-ar','r',archive,tls_object])
    compiler = stage/'bin/aarch64-linux-cosmo-gcc'
    for name in ('start', 'launch', 'systemcall'):
        run([compiler, '-iquote'+str(native), '-fpie', '-c', native/f'ape/{name}.S', '-o', objects/f'{name}.o'])
    flags = ['-std=gnu23', '-DNDEBUG', '-DSUPPORT_VECTOR=33', '-iquote'+str(native), '-Wall', '-Wextra',
             '-fpie', '-Os', '-ffreestanding', '-mgeneral-regs-only', '-fno-asynchronous-unwind-tables',
             '-fno-stack-protector', '-fno-ident', '-fno-gnu-unique']
    run([compiler, *flags, '-c', native/'ape/loader.c', '-o', objects/'loader.o'])
    loader = stage/'bin/ape-aarch64.elf'
    run([stage/'bin/aarch64-linux-cosmo-ld', '-pie', '-static', '-nostdlib', '--no-dynamic-linker',
         '-z', 'norelro', '-z', 'common-page-size=0x10000', '-z', 'max-page-size=0x10000',
         '-o', loader, *[objects/f'{name}.o' for name in ('start', 'loader', 'launch', 'systemcall')]])
    run([stage/'bin/aarch64-linux-cosmo-strip', '-g', loader])
    run([stage/'bin/fixupobj', loader])
    layout = inspect(loader)
    if not layout['elf']['modern']:
        raise ValueError('Rebuilt ARM64 loader lacks modern APE identity')
    apelink = objects/'apelink'
    run([stage/'bin/cosmocc', '-O2', '-std=gnu23', '-D_GNU_SOURCE', '-D_COSMO_SOURCE',
         '-iquote'+str(private), '-iquote'+str(native), private/'tool/build/apelink.c',
         private/'tool/build/lib/parsesupportvector.c', native/'third_party/haclstar/blake2b.c', '-o', apelink])
    shutil.copy2(apelink, stage/'bin/apelink')
    host_tools(stage)
    driver = stage/'bin/cosmocc'
    text = driver.read_text()
    old = '-Wl,-z,common-page-size=16384 -Wl,-z,max-page-size=16384'
    if text.count(old) != 1:
        raise ValueError('Pinned ARM64 compiler-driver flags changed')
    driver.write_text(text.replace(old, '-Wl,-z,common-page-size=65536 -Wl,-z,max-page-size=65536'), newline='\n')
    installed = inventory(stage)
    changes = {name: dict(before=original.get(name), after=value) for name, value in installed.items() if original.get(name) != value}
    roles={}
    for name in installed:roles.setdefault(role(name),[]).append(name)
    record = dict(inputs=expected, original=original, installed=installed, changes=changes, loader=layout,roles=roles,commands=COMMANDS,
                  runtimePageSizes=[4096, 16384, 65536], buildHost='Official compiler executables retain their original host page requirements')
    validate_record(settings,record)
    (stage/'.runtime-toolchain.json').write_text(json.dumps(record, indent=2)+'\n')
    stage.rename(settings.toolchain)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    import fcntl
    settings = load_config()
    (settings.root/'build').mkdir(exist_ok=True)
    with (settings.root/'build/runtime-toolchain.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        prepare(settings, args.offline)


if __name__ == '__main__':
    main()
