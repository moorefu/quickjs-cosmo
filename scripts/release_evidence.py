"""Require complete, current reports before packaging and after the seven-host matrix."""
import argparse
import json
import re
import os
from pathlib import Path
from build_config import load_config
from host_runtime import node_oracle_key, normalize_arch
from runtime_capabilities import digest

MATRIX={
    'ubuntu-24.04':('linux','x86_64','x86_64'),
    'ubuntu-24.04-arm':('linux','arm64','arm64'),
    'macos-15-intel':('darwin','x86_64','x86_64'),
    'macos-15':('darwin','arm64','arm64'),
    'windows-2022':('win32','x86_64','x86_64'),
    'windows-2025':('win32','x86_64','x86_64'),
    'windows-11-arm':('win32','arm64','x86_64')}

def read(path):return json.loads(Path(path).read_text(encoding='utf8'))

def binding(settings):
    root,dist=settings.root,settings.dist
    return dict(sourceRevision=os.environ.get('GITHUB_SHA'),manifestSha256=digest(dist/'manifest.json'),inventorySha256=digest(root/'compat/node-api.json'),
        nodeBaselineSha256=digest(root/'compat/node-baseline.json'),nativeLockSha256=digest(root/'native/versions.json'),
        releaseChecksSha256=digest(root/'compat/release-checks.json'),versionsSha256=digest(root/'versions.json'),
        qjsSha256=digest(dist/'qjs.exe'),qjscSha256=digest(dist/'qjsc.exe'),
        sdkSha256={name:digest(dist/name) for name in ('libquickjs.a','.aarch64/libquickjs.a')})

def expected_checks(root,build,platform):
    contract=read(root/'compat/release-checks.json')
    if build:return set(contract['build'])
    return set(contract['verify'])|set(contract['windows' if platform=='win32' else 'unix'])

def validate_node_identity(root,node,host):
    baseline=read(root/'compat/node-baseline.json')
    oracle=baseline['artifacts'][node_oracle_key(host)]
    proof=node['verification']
    if node['platform']!=host['platform'] or normalize_arch(node['arch'])!=host['execution_arch'] or node['version']!=baseline['version'] or not re.fullmatch('[0-9a-f]{64}',node['sha256']) or proof['executable_sha256']!=node['sha256'] or proof['artifact_sha256']!=oracle['sha256'] or proof['artifact']!=oracle['file'] or oracle['file'].endswith('.exe') and node['sha256']!=oracle['sha256']:
        raise ValueError('Node oracle identity does not match the pinned host artifact')

def validate_evidence(settings,value,build=False):
    root=settings.root
    if value.get('format')!=1 or value.get('inputs')!=binding(settings):raise ValueError('Evidence refers to different runtime inputs or binaries')
    host=value['host'];platform=host['platform'];runner=value['runner']
    if runner in MATRIX and (platform,host['host_arch'],host['execution_arch'])!=MATRIX[runner]:raise ValueError('Matrix host/APE architecture mismatch: '+runner)
    if build and (platform,host['execution_arch'])!=('linux','x86_64'):raise ValueError('Build evidence requires Linux x86_64')
    expected=expected_checks(root,build,platform)
    if len(value['checks'])!=len(expected) or set(value['checks'])!=expected or value['passed']!=len(expected) or value['failed']!=0:raise ValueError('Incomplete required runtime checks: '+runner)
    allowed=[read(root/'compat/release-checks.json')['windows_skip']] if platform=='win32' else []
    if value['skipped']!=allowed:raise ValueError('Unexpected or missing platform skip: '+runner)
    inventory=read(root/'compat/node-api.json');tests={t['id'] for t in inventory['tests'] if t['status']=='differential'}
    if len(value['nodeTests'])!=len(tests) or set(value['nodeTests'])!=tests:raise ValueError('Incomplete differential coverage: '+runner)
    validate_node_identity(root,value['node'],host)
    from test_terminal import expected_cases
    terminal=value.get('terminal',{})
    records=terminal.get('records',[])
    expected_transport='ConPTY' if platform=='win32' else 'PTY'
    if terminal.get('host')!=host or terminal.get('qjsSha256')!=value['inputs']['qjsSha256'] or terminal.get('transport')!=expected_transport or len(records)!=len(expected_cases()) or {(v['entry'],v['case']) for v in records}!=expected_cases():
        raise ValueError('Missing, stale or incomplete real terminal evidence: '+runner)
    for record in records:
        if not record.get('logs') or any(not re.fullmatch('[0-9a-f]{64}',v) for v in record['logs'].values()) or (record['case']=='pipe' and record.get('noAutomaticAnsi') is not True) or (record['case']!='pipe' and (record.get('restored') is not True or record.get('result',[0])[0]!=1)):
            raise ValueError('Invalid terminal restoration or raw log evidence: '+runner)
    deployment=value.get('deployment',{})
    if deployment.get('host')!=host or deployment.get('qjsSha256')!=value['inputs']['qjsSha256']:
        raise ValueError('Missing or stale deployment evidence: '+runner)
    expected_entries={'qjs','compiled','sdk','installed-first','installed-reuse','qjs-custom-argv0','compiled-custom-argv0','sdk-custom-argv0'}|({'bare-elf'} if platform=='linux' else set())
    deployment_records=deployment.get('records',[])
    if len(deployment_records)!=len(expected_entries) or {v['entry'] for v in deployment_records}!=expected_entries:
        raise ValueError('Incomplete deployment entry evidence: '+runner)
    for record in deployment_records:
        if record['entry']=='bare-elf':continue
        result=record['value']
        if not isinstance(record.get('nativePid'),int) or record['nativePid']<=0 or result.get('main',{}).get('pid')!=record['nativePid'] or result.get('worker',{}).get('pid')!=record['nativePid']:
            raise ValueError('Missing native/Worker PID identity: '+runner)
        if record['entry'].endswith('-custom-argv0'):
            if result.get('custom') is not True or result['worker']['argv0']!=result['main']['argv0']:raise ValueError('Missing custom argv0/Worker identity: '+runner)
            continue
        if result.get('vectors')!=261 or not result.get('nativeToApe') or len(result.get('results',[]))!=62:
            raise ValueError('Incomplete argv/cursor deployment vectors: '+runner)
        cursor=[(v.get('target'),v.get('api')) for v in result['results'] if v.get('sharedCursor')]
        if len(cursor)!=8 or set(cursor)!={(target,api) for target in ('ape','native') for api in ('sync','async','legacy','legacy-async')}:
            raise ValueError('Incomplete shared cursor transports: '+runner)
        for target in ('ape','native'):
            for api in ('sync','async','legacy'):
                if sum(v.get('count',0) for v in result['results'] if v.get('target')==target and v.get('api')==api)!=261:
                    raise ValueError('Incomplete argument transport: '+runner)
    if deployment.get('immutable',{}).get('dist/qjs.exe')!=value['inputs']['qjsSha256'] or not deployment.get('capabilities'):
        raise ValueError('Missing deployment immutability/capability record: '+runner)
    if platform=='win32':
        security=value.get('windowsSecurity',{})
        levels=security.get('integrity',[])
        if security.get('qjsSha256')!=value['inputs']['qjsSha256'] or security.get('unc',{}).get('status')!='implemented' or len(levels)!=3 or {v['requested'] for v in levels}!={4096,8192,12288} or any(v['value'].get('status')!='executed' or v['value']['proof'].get('passed') is not True or len(v['value']['proof'].get('checks',[]))!=3 for v in levels):
            raise ValueError('Missing actual Windows integrity/UNC acceptance: '+runner)
        if security.get('deniedTargetKnownLive') is not True or any(v['value'].get('integrity')!=v['requested'] or v['value']['proof'].get('integrity')!=v['requested'] or v['value']['proof'].get('deniedTarget',{}).get('status')!='permission-denied' for v in levels):
            raise ValueError('Invalid Windows integrity/process visibility identity: '+runner)
    return value

def validate_reports(settings,runner='local',build=False):
    root=settings.root;host_report='linux' if build else __import__('platform').system().lower()
    runtime=read(settings.reports/(host_report+'.json'))
    node=read(root/('build/node-compat/'+host_report+'.json'))
    inputs=binding(settings)
    if runtime.get('artifacts')!=inputs or runtime.get('coverage')!=dict(upstream=True,nodeCompat=True,compiled=build,standalone=not build):raise ValueError('Runtime report lacks the required entry coverage or artifact binding')
    if runtime['qjs_sha256']!=inputs['qjsSha256'] or runtime['quickjs_commit']!=settings.data['quickjs']['commit'] or runtime['cosmopolitan']!=settings.data['cosmopolitan']:raise ValueError('Runtime report has stale pinned inputs')
    checks=runtime['results']
    if runtime['failed'] or runtime['passed']!=len(checks) or any(not x['passed'] or x['exit_code']!=0 and x.get('expected_logical_exit',0)==0 for x in checks):raise ValueError('Runtime checks failed or counters disagree')
    if node['mode']!='differential' or node['failed'] or node['passed']!=len(node['results']) or any(not x['passed'] for x in node['results']):raise ValueError('Differential checks failed or counters disagree')
    expected=dict(inventory_sha256=inputs['inventorySha256'],node_baseline_sha256=inputs['nodeBaselineSha256'],native_lock_sha256=inputs['nativeLockSha256'],entry_contract_sha256=digest(root/'docs/NODE_ENTRY_CONTRACT.md'))
    if any(node.get(k)!=v for k,v in expected.items()) or node['input_versions']!=settings.data or node['qjs']['sha256']!=inputs['qjsSha256'] or node['host']!=runtime['host']:raise ValueError('Differential report has stale inputs or a different host')
    fixtures={p.relative_to(root).as_posix():digest(p) for p in sorted((root/'tests/node').rglob('*.mjs'))}
    if node['fixture_sha256']!=fixtures:raise ValueError('Differential fixtures changed after testing')
    identity={k:node['node'][k] for k in ('version','platform','arch','execPath','sha256','verification')}
    # Reuse the differential driver's archive/member validation on this host.
    # The final offline gate consumes this checked attestation, without needing
    # all five host-specific Node archives in the release payload.
    from test_node_compat import verify_node
    if verify_node(Path(identity['execPath']),read(root/'compat/node-baseline.json'),root)!=identity['verification']:raise ValueError('Node executable changed after differential testing')
    terminal=read(root/('build/terminal/'+host_report+'/results.json'))
    value=dict(format=1,runner=runner,host=runtime['host'],inputs=inputs,node=identity,terminal=terminal,
        passed=runtime['passed'],failed=runtime['failed'],skipped=runtime['skipped'],checks=[x['name'] for x in checks],nodeTests=[x['id'] for x in node['results']])
    value['deployment']=read(root/('build/deployment/'+host_report+'/results.json'))
    if runtime['host']['platform']=='win32':value['windowsSecurity']=read(root/'build/deployment/windows/security.json')
    return validate_evidence(settings,value,build)

def aggregate(settings,directory):
    paths=list(Path(directory).glob('**/release-evidence/*.json'))
    values=[validate_evidence(settings,read(p)) for p in paths]
    if len(values)!=len(MATRIX) or {x['runner'] for x in values}!=set(MATRIX):raise ValueError('Require exactly one successful evidence record for each of the seven matrix rows')
    build=validate_evidence(settings,read(settings.root/'build/ci/build-evidence.json'),build=True)
    kernel_paths=list(Path(directory).glob('reports-kernel64k/results.json'))
    if len(kernel_paths)!=1:raise ValueError('Require the real ARM64 64K kernel evidence')
    kernel=read(kernel_paths[0]);validate_kernel(settings,kernel)
    if digest(kernel_paths[0].with_name('console.log'))!=kernel['consoleSha256']:raise ValueError('64K kernel console log changed')
    return dict(format=1,inputs=binding(settings),build=build,kernel64k=kernel,platforms=sorted(values,key=lambda x:x['runner']),notes=['Declared API subsets only; this report is not a Node compatibility percentage.'])


def validate_kernel(settings,value):
    # Keep this independent of QEMU/compilers so the final gate remains offline.
    lock=read(settings.root/'compat/kernel64k.json')
    cases={'loader-fat','literal-argv0','bare-elf','compiled','sdk','qjsc','binfmt-fat','binfmt-nested'}
    if value.get('format')!=1 or value.get('inputs')!=binding(settings) or value.get('kernel',{}).get('lock')!=lock or value.get('auxv')!=dict(pageSize=65536,release=lock['release'],machine='aarch64'):
        raise ValueError('Missing or stale real 64K kernel identity')
    if len(value.get('cases',[]))!=len(cases) or set(value['cases'])!=cases or len(value.get('results',[]))!=7 or any(v.get('kernel') is not True or v.get('immutable') is not True for v in value['results']):
        raise ValueError('Incomplete real 64K kernel execution')
    if not re.fullmatch('[0-9a-f]{64}',value.get('consoleSha256','')):raise ValueError('Missing kernel console evidence')
    for name in ('qjs.exe','qjsc.exe','deployment-standalone.exe','deployment-sdk.exe'):
        layout=value.get('layouts',{}).get(name,{})
        expected={'qjs.exe':value['inputs']['qjsSha256'],'qjsc.exe':value['inputs']['qjscSha256']}.get(name)
        if expected and layout.get('sha256')!=expected:raise ValueError('64K kernel executed a different payload: '+name)
        if layout.get('format')!='APE' or not any(v.get('machine')==183 and v.get('ready64k') and v.get('modern') for v in layout.get('payloads',[])) or not layout.get('loaders',{}).get('183',{}).get('ready64k'):
            raise ValueError('Missing 64K fat or embedded loader layout: '+name)
    return value

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('operation',choices=['platform','aggregate']);parser.add_argument('--runner',default='local',choices=['local',*MATRIX]);parser.add_argument('--reports',type=Path);parser.add_argument('--output',type=Path)
    args=parser.parse_args();settings=load_config()
    if args.operation=='platform':value=validate_reports(settings,args.runner);output=args.output or settings.root/('build/release-evidence/'+args.runner+'.json')
    else:
        if not args.reports:parser.error('--reports is required for aggregation')
        value=aggregate(settings,args.reports);output=args.output or settings.releases/'compatibility-report.json'
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(value,indent=2)+'\n',encoding='utf8')
    print('PASS release evidence: '+args.operation+'; '+str(output))

if __name__=='__main__':main()
