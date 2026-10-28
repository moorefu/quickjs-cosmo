"""Generate capability descriptions from the reviewed API and backend contracts."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def report(root=ROOT):
    inventory=json.loads((root/'compat/node-api.json').read_text(encoding='utf8'))
    native=json.loads((root/'native/versions.json').read_text(encoding='utf8'))
    return dict(format=1,nodeApiTarget=json.loads((root/inventory['node_baseline']).read_text(encoding='utf8'))['version'],
        inventorySha256=digest(root/'compat/node-api.json'),
        backendLocks={p.relative_to(root).as_posix():digest(p) for p in sorted((root/'native').rglob('*.json'))},
        scope=dict(modules='ESM',commonJS=False,npmResolution=False,tlsVersions=['TLSv1.2'],serverNetworking=False,
            stdioOutput='synchronous writes; deferred callbacks',workerStdin=False),
        limits=dict(nativeTasks=dict(scope='runtime',threads=2,tasks=64,reservedBytes=64*1024*1024),
            sockets=dict(scope='runtime',count=32,inputBytes=65536,outputBytes=65536,tlsArenaBytes=8*1024*1024),
            childProcesses=dict(scope='runtime',count=16),
            stdio=dict(scope='process',readers=1,writeChunkBytes=65536,pollIntervalMs=10)),
        backends=[dict(id=x['id'],delivery=x['delivery'],sourceAdmission=x['admission']) for x in native['libraries']],
        modules=inventory['modules'],globals=inventory['globals'],
        notes=['Method status describes only its declared parameters and platform/entry support.',
               'Source admission labels are backend input evidence, not claims of full library API exposure.',
               'Counts and exported names are not a Node compatibility percentage. BSD has no verified CI runner.'])

def runtime_summary(root=ROOT):
    value=report(root)
    value['modules']=[dict(specifier=m['specifier'],aliases=m['aliases'],apis={e['name']:e['status'] for e in m['entries']}) for m in value['modules']]
    value['globals']={e['name']:e['status'] for e in value['globals']}
    return value

def features(value):
    enabled={'partial','supported'}
    modules=[m['specifier'] for m in value['modules'] if any(e['status'] in enabled for e in m['entries'])]
    globals_=sorted({e['name'].split('.')[0] for e in value['globals'] if e['status'] in enabled})
    return ['std','os','qjs:std','qjs:os',*modules,*globals_,'Worker','BigInt','experimental Temporal/Intl']

def readme(value):
    modules=[m['specifier'] for m in value['modules']]
    return ('\nRuntime capability contract\nNode API target: '+value['nodeApiTarget']+
        '\nAPI inventory SHA-256: '+value['inventorySha256']+
        '\nDeclared ESM module subsets: '+', '.join(modules)+
        '\nESM only; CommonJS require() and npm resolution are separate projects.'+
        '\nClient networking; TLS 1.2 with certificate and hostname verification. No TLS server API.'+
        '\nStandard output writes are synchronous; Worker shared stdin is unavailable.'+
        '\nUse cosmo:runtime runtimeInfo() for backend/limit summaries; the SDK capabilities.json contains method, parameter and platform contracts.'+
        '\nPartial methods and module names do not imply full Node compatibility. BSD has no verified CI runner.\n').encode('utf8')
