#!/usr/bin/env python3
"""Revalidate two certified profiles and assemble the eight public downloads."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile
from types import SimpleNamespace
import zipfile

from build_config import load_config
from release_assets import digest, runtime_name, verify_runtime, write_zip
from release_evidence import binding, MATRIX, validate_evidence, validate_kernel
from release_version import release_info
from runtime_profiles import declaration_files


def extract_zip(path, destination):
    with zipfile.ZipFile(path) as archive:
        names=archive.namelist()
        if len(names)!=len(set(names)) or archive.testzip():raise ValueError('Invalid SDK/tests ZIP')
        for entry in archive.infolist():
            name=PurePosixPath(entry.filename)
            if (entry.orig_filename!=entry.filename or name.is_absolute() or '..' in name.parts or '\\' in entry.filename or ':' in entry.filename or
                str(name)!=entry.filename or entry.is_dir() or (entry.external_attr>>16)&0o170000 not in (0,0o100000)):
                raise ValueError('Unsafe release ZIP member')
            target=destination/name
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(archive.read(entry))
            target.chmod((entry.external_attr>>16)&0o777)


def validate_profile(settings, profile, directory, release, scratch, proof, records):
    dist=scratch/profile;dist.mkdir(parents=True)
    sdk=directory/('quickjs-cosmo-sdk-'+release['version']+'.zip')
    extract_zip(sdk,scratch/'sdk')
    source=scratch/'sdk'/profile
    if not source.is_dir():raise ValueError('SDK is missing profile '+profile)
    shutil.copytree(source,dist,dirs_exist_ok=True)
    profile_settings=SimpleNamespace(**{**vars(settings),'runtime_profile':profile,'dist':dist,'releases':directory})
    manifest=json.loads((dist/'manifest.json').read_text())
    if manifest['runtime_profile']!=profile or manifest['architecture']!='fat':raise ValueError('SDK profile identity mismatch')
    types={p.name:p.read_bytes() for p in dist.glob('*.d.ts')}
    if types!=declaration_files(settings.root,profile):raise ValueError('SDK profile declarations differ from source')
    for name,value in manifest['files'].items():
        if name.startswith('variants/') or name in ('qjs','qjs.exe','run-test262','run-test262.exe'):continue
        if not (dist/name).is_file() or digest((dist/name).read_bytes())!=value['sha256']:raise ValueError('SDK content differs from certified build: '+name)
    for arch in ('fat','x64','arm64'):
        target=dist if arch=='fat' else dist/'variants'/arch
        target.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(directory/runtime_name(release['version'],profile,arch)) as archive:
            (target/'qjs.exe').write_bytes(archive.read('qjs'))
        if arch!='fat':
            cap=directory/('capabilities-'+profile+'-'+arch+'.json')
            (target/'capabilities.json').write_bytes(cap.read_bytes())
        actual=verify_runtime(profile_settings,release['version'],arch)
        if actual!=next(v for v in records if (v['profile'],v['architecture'])==(profile,arch)):
            raise ValueError('Runtime size/hash/capability evidence mismatch')
    extract_zip(directory/('quickjs-cosmo-tests-'+release['version']+'.zip'),scratch/'tests')
    tests=scratch/'tests'/profile
    for name,target in (('qjs','qjs.exe'),('capabilities.json','capabilities.json')):
        if (tests/name).read_bytes()!=(dist/target).read_bytes():raise ValueError('Tests package profile/runtime differs from release')
    if (tests/'run-tests.py').read_bytes()!=(settings.root/'scripts/release_tests.py').read_bytes():raise ValueError('Tests package runner changed')
    (dist/'run-test262.exe').write_bytes((tests/'run-test262').read_bytes())
    value=proof['profiles'][profile]
    if value['inputs']!=binding(profile_settings):raise ValueError('Certified profile inputs changed')
    validate_evidence(profile_settings,value['build'],build=True)
    platforms=value['platforms']
    if len(platforms)!=len(MATRIX) or {v['runner'] for v in platforms}!=set(MATRIX):raise ValueError('Missing seven-platform profile coverage')
    for platform in platforms:
        validate_evidence(profile_settings,platform)
        expected_arch='x64' if platform['host']['execution_arch']=='x86_64' else 'arm64'
        expected=digest((dist/'variants'/expected_arch/'qjs.exe').read_bytes())
        if platform['profiles']['variants'][expected_arch]!=expected:raise ValueError('Unverified single-CPU release')
    validate_kernel(profile_settings,value['kernel64k'])
    return profile_settings


def verify_public(settings, directory=None, commit=None, tag=None):
    directory=directory or settings.releases/'public'
    metadata=json.loads((directory/'manifest.json').read_text())
    release=metadata['release']
    if metadata.get('format')!=2 or metadata['versions']!=settings.data or release!=release_info(settings,tag or release['tag'],from_environment=False):
        raise ValueError('Public release identity differs from pinned inputs')
    if commit and metadata['sourceRevision']!=commit:raise ValueError('Release evidence belongs to another commit')
    settings=SimpleNamespace(**{**vars(settings),'upstream_readme_bytes':metadata['upstreamReadme'].encode('utf8')})
    expected={runtime_name(release['version'],profile,arch) for profile in ('base','full') for arch in ('fat','x64','arm64')}
    expected|={'quickjs-cosmo-'+kind+'-'+release['version']+'.zip' for kind in ('sdk','tests')}
    if {name for name in metadata['files'] if name.endswith('.zip')}!=expected:raise ValueError('Release requires exactly eight ZIP assets')
    extras={'capabilities-'+profile+('' if arch=='fat' else '-'+arch)+'.json' for profile in ('base','full') for arch in ('fat','x64','arm64')}
    if set(metadata['files'])!=expected|{name+'.sha256' for name in expected}|extras|{'compatibility-report.json'}:
        raise ValueError('Public release metadata/checksum inventory mismatch')
    for name,record in metadata['files'].items():
        if PurePosixPath(name).name!=name or digest((directory/name).read_bytes())!=record['sha256'] or (directory/name).stat().st_size!=record['bytes']:
            raise ValueError('Public release file hash mismatch: '+name)
    for name in expected:
        if (directory/(name+'.sha256')).read_text().split()!=[digest((directory/name).read_bytes()),name]:
            raise ValueError('Public download checksum disagrees with its asset')
    proof=json.loads((directory/'compatibility-report.json').read_text())
    if proof.get('format')!=2 or set(proof['profiles'])!={'base','full'}:raise ValueError('Both certified profiles are required')
    root=settings.root/'build/release-verification';root.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root) as temporary:
        scratch=Path(temporary)
        for profile in ('base','full'):
            validate_profile(settings,profile,directory,release,scratch,proof,metadata['runtimes'])
    return metadata


def assemble(settings, certified):
    release=release_info(settings);version=release['version'];output=settings.releases/'public';output.mkdir(parents=True,exist_ok=True)
    timestamp=datetime.fromisoformat(settings.data['quickjs']['commit_date'].replace('Z','+00:00')).timetuple()[:6]
    proofs={};records=[];aux={'sdk':[],'tests':[]};upstream_readme=None
    # A clean checkout gets the original readme directly from its pinned source.
    for profile in ('base','full'):
        source=certified/('quickjs-cosmo-certified-'+profile)
        archive=source/'.cache/quickjs-source.tar.gz'
        if digest(archive.read_bytes())!=settings.data['quickjs']['sha256']:raise ValueError('Certified QuickJS source pin changed')
        with tarfile.open(archive,'r:gz') as bundle:
            entries=[entry for entry in bundle if entry.name.endswith('/readme-cosmo.txt')]
            if len(entries)!=1 or not entries[0].isfile():raise ValueError('Missing pinned release readme')
            original=bundle.extractfile(entries[0]).read()
            if upstream_readme is not None and upstream_readme!=original:raise ValueError('Profiles use different upstream readmes')
            upstream_readme=original
        data=json.loads((source/'releases'/('assets-'+profile+'.json')).read_text())
        if data['profile']!=profile or data['version']!=version or len(data['runtimes'])!=3:raise ValueError('Certified asset profile mismatch')
        records.extend(data['runtimes'])
        proofs[profile]=json.loads((source/'releases/compatibility-report.json').read_text())
        for arch in ('fat','x64','arm64'):
            name=runtime_name(version,profile,arch)
            for suffix in ('','.sha256'):shutil.copyfile(source/'releases'/(name+suffix),output/(name+suffix))
            cap=source/'dist/capabilities.json' if arch=='fat' else source/'dist/variants'/arch/'capabilities.json'
            name='capabilities-'+profile+('' if arch=='fat' else '-'+arch)+'.json'
            shutil.copyfile(cap,output/name)
        for kind in aux:
            path=source/'releases/internal'/('quickjs-cosmo-'+kind+'-'+profile+'-'+version+'.zip')
            if path.with_suffix('.zip.sha256').read_text().split()!=[digest(path.read_bytes()),path.name]:raise ValueError('Internal SDK/tests checksum mismatch')
            with zipfile.ZipFile(path) as bundle:
                if bundle.testzip():raise ValueError('Corrupt auxiliary asset')
                aux[kind].extend((profile+'/'+entry.filename,bundle.read(entry),(entry.external_attr>>16)&0o777) for entry in bundle.infolist())
    for kind,files in aux.items():
        files.insert(0,('README.txt',('Choose base/ or full/. '+('Run python3 base/run-tests.py or python3 full/run-tests.py.' if kind=='tests' else 'Use the matching qjsc, headers, libraries and node-compat.d.ts. Configure cosmocc on PATH.')+'\n').encode(),0o644))
        write_zip(output/('quickjs-cosmo-'+kind+'-'+version+'.zip'),files,timestamp)
    (output/'compatibility-report.json').write_text(json.dumps(dict(format=2,profiles=proofs),indent=2)+'\n',encoding='utf8')
    files={path.name:dict(bytes=path.stat().st_size,sha256=digest(path.read_bytes())) for path in output.iterdir() if path.is_file() and path.name!='manifest.json'}
    metadata=dict(format=2,release=release,sourceRevision=os.environ.get('GITHUB_SHA'),versions=settings.data,runtimes=records,files=files,
                  upstreamReadme=upstream_readme.decode('utf8'))
    (output/'manifest.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf8')
    verify_public(settings,output,os.environ.get('GITHUB_SHA'))
    print('PASS public release: eight ZIPs, both profiles, fourteen platform attestations and two real 64K kernels')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--certified',type=Path,required=True)
    args=parser.parse_args();assemble(load_config(),args.certified)
