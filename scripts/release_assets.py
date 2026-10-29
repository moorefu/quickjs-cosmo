"""Deterministic runtime, SDK and test assets with enforced profile contracts."""
from datetime import datetime
import hashlib
import json
import re
import stat
import tarfile
import zipfile

from ape_layout import inspect
from build_variants import validate_ca, slice_segments, validate_architecture
from runtime_capabilities import readme, report
from runtime_resources import validate_resources

MARGIN = 200_000
TARGETS = {
    ('base', 'fat'): (8_700_000, 3_800_000),
    ('full', 'fat'): (10_800_000, 4_600_000),
    ('base', 'x64'): (4_600_000, 2_000_000),
    ('base', 'arm64'): (4_300_000, 1_900_000),
    ('full', 'x64'): (5_800_000, 2_500_000),
    ('full', 'arm64'): (5_300_000, 2_300_000),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def runtime_name(version, profile, architecture):
    suffix = ('-full' if profile == 'full' else '') + ('-' + architecture if architecture != 'fat' else '')
    return 'quickjs-cosmo' + suffix + '-' + version + '.zip'


def profile_asset_names(version, profile):
    return [runtime_name(version, profile, arch) for arch in ('fat', 'x64', 'arm64')] + [
        'internal/quickjs-cosmo-' + kind + '-' + profile + '-' + version + '.zip' for kind in ('sdk', 'tests')]


def write_zip(path, files, timestamp):
    path.parent.mkdir(parents=True, exist_ok=True)
    names = [name for name, _, _ in files]
    if len(names) != len(set(names)):
        raise ValueError('Duplicate release ZIP member')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data, mode in files:
            entry = zipfile.ZipInfo(name, timestamp)
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | mode) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
    path.with_suffix('.zip.sha256').write_text(digest(path.read_bytes()) + '  ' + path.name + '\n', encoding='ascii')


def runtime_readme(settings, version, architecture):
    root, dist = settings.root, settings.dist
    value = report(root, settings.runtime_profile)
    value['architecture'] = architecture
    original=getattr(settings,'upstream_readme_bytes',None)
    if original is None:
        with tarfile.open(root/'.cache/quickjs-source.tar.gz','r:gz') as source:
            original=source.extractfile('quickjs-'+settings.data['quickjs']['commit']+'/readme-cosmo.txt').read()
    return (original +
            ('\n\nPinned build\nRelease version: ' + version + '\nRuntime profile: ' + settings.runtime_profile +
             '\nArchitecture: ' + architecture + '\nQuickJS commit: ' + settings.data['quickjs']['commit'] +
             '\ncosmocc commit: ' + settings.data['cosmopolitan']['commit'] +
             '\ncosmocc Nightly run: ' + str(settings.data['cosmopolitan']['run_number']) +
             '\nRuntime ZIP contains qjs and readme.txt. SDK and tests are separate downloads.\n').encode('ascii') +
            b'\nNode.js JavaScript modules (MIT)\n' + (dist / 'NODE-MODULES-LICENSE').read_bytes() +
            b'\nNative library and source notices\n' + (dist / 'NATIVE-MODULES-LICENSES').read_bytes() + readme(value))


def verify_runtime(settings, version, architecture):
    profile = settings.runtime_profile
    directory = settings.dist if architecture == 'fat' else settings.dist / 'variants' / architecture
    binary = directory / 'qjs.exe'
    path = settings.releases / runtime_name(version, profile, architecture)
    checksum = path.with_suffix('.zip.sha256').read_text().split()
    data = path.read_bytes()
    if checksum != [digest(data), path.name]:
        raise ValueError('Runtime download checksum mismatch')
    with zipfile.ZipFile(path) as archive:
        if archive.namelist() != ['readme.txt', 'qjs'] or archive.testzip():
            raise ValueError('Runtime ZIP must contain only readme.txt and qjs')
        if archive.read('qjs') != binary.read_bytes() or archive.read('readme.txt') != runtime_readme(settings, version, architecture):
            raise ValueError('Runtime ZIP content/profile mismatch')
        members = [dict(name=x.filename, bytes=x.file_size, compressedBytes=x.compress_size) for x in archive.infolist()]
    layout = inspect(binary, expected_architecture=architecture)
    if architecture!='fat':
        fat=settings.dist/'qjs.exe';fat_layout=inspect(fat)
        payload=next(value for value in fat_layout['payloads'] if value['machine']==layout['payloads'][0]['machine'])
        if slice_segments(binary,layout['payloads'][0])!=slice_segments(fat,payload):
            raise ValueError('Single-CPU code/data differs from its certified fat slice')
    ca = validate_ca(binary, settings.root)
    resources = validate_resources(binary, settings.root, profile)
    validate_architecture(binary,architecture)
    target_raw, target_zip = TARGETS[profile, architecture]
    if binary.stat().st_size > target_raw + MARGIN or len(data) > target_zip + MARGIN:
        raise ValueError(f'{profile}/{architecture} exceeds size budget: qjs={binary.stat().st_size}, ZIP={len(data)}')
    capabilities = json.loads((directory / 'capabilities.json').read_text())
    expected=report(settings.root,profile);expected['architecture']=architecture
    if capabilities != expected:
        raise ValueError('Release capability profile/architecture mismatch')
    return dict(profile=profile, architecture=architecture, filename=path.name, sha256=digest(data),
                bytes=len(data), qjsSha256=digest(binary.read_bytes()), qjsBytes=binary.stat().st_size,
                capabilitiesSha256=digest((directory / 'capabilities.json').read_bytes()),
                targetBytes=dict(qjs=target_raw, download=target_zip, margin=MARGIN),
                slices=[dict(machine=x['machine'], fileBytes=sum(s['fileBytes'] for s in x['loads']),segments=slice_segments(binary,x)) for x in layout['payloads']],
                members=members, ca=ca, resources=resources)


def package_profile(settings, release):
    version, profile = release['version'], settings.runtime_profile
    source=settings.root/'.cache/quickjs-source.tar.gz'
    if digest(source.read_bytes())!=settings.data['quickjs']['sha256']:
        raise ValueError('Pinned QuickJS source archive hash mismatch')
    with tarfile.open(source,'r:gz') as archive:
        engine=archive.extractfile('quickjs-'+settings.data['quickjs']['commit']+'/VERSION').read().decode('ascii').strip()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',engine) or engine!=settings.data['quickjs']['version']:
        raise ValueError('QuickJS VERSION must match the locked YYYY-MM-DD version')
    timestamp = datetime.fromisoformat(settings.data['quickjs']['commit_date'].replace('Z', '+00:00')).timetuple()[:6]
    records = []
    for arch in ('fat', 'x64', 'arm64'):
        directory = settings.dist if arch == 'fat' else settings.dist / 'variants' / arch
        write_zip(settings.releases / runtime_name(version, profile, arch), [
            ('readme.txt', runtime_readme(settings, version, arch), 0o664),
            ('qjs', (directory / 'qjs.exe').read_bytes(), 0o755)], timestamp)
        records.append(verify_runtime(settings, version, arch))
    sdk = sdk_files(settings)
    tests = test_files(settings)
    for kind, contents in (('sdk', sdk), ('tests', tests)):
        path = settings.releases / ('internal/quickjs-cosmo-' + kind + '-' + profile + '-' + version + '.zip')
        write_zip(path, contents, timestamp)
    result = dict(format=1, profile=profile, version=version, runtimes=records)
    (settings.releases / ('assets-' + profile + '.json')).write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')
    return result


def sdk_files(settings):
    sdk=[]
    for path in sorted(settings.dist.rglob('*'),key=lambda value:value.relative_to(settings.dist).as_posix()):
        name = path.relative_to(settings.dist).as_posix()
        if not path.is_file() or name.startswith('variants/') or name in ('qjs', 'qjs.exe', 'run-test262', 'run-test262.exe'):
            continue
        sdk.append((name, path.read_bytes(), 0o755 if name in ('qjsc', 'qjsc.exe') or name.startswith('ape-') else 0o644))
    return sdk


def test_files(settings):
    tests = [('README.txt', b'Run: python3 run-tests.py\nBoth qjs and run-test262 are self-contained APEs.\n', 0o644),
             ('run-tests.py', (settings.root / 'scripts/release_tests.py').read_bytes(), 0o755)]
    for name, source in (('qjs', 'qjs.exe'), ('run-test262', 'run-test262.exe'), ('ape-x86_64.elf', 'ape-x86_64.elf'), ('ape-aarch64.elf', 'ape-aarch64.elf')):
        tests.append((name, (settings.dist / source).read_bytes(), 0o755))
    tests.append(('capabilities.json', (settings.dist / 'capabilities.json').read_bytes(), 0o644))
    for name in ('NODE-MODULES-LICENSE','NATIVE-MODULES-LICENSES'):
        tests.append((name,(settings.dist/name).read_bytes(),0o644))
    tests.append(('tests/release-smoke.js', (settings.root / 'tests/fixtures/test262-smoke.js').read_bytes(), 0o644))
    with tarfile.open(settings.root/'.cache/quickjs-source.tar.gz','r:gz') as archive:
        prefix='quickjs-'+settings.data['quickjs']['commit']+'/'
        tests.append(('LICENSE',archive.extractfile(prefix+'LICENSE').read(),0o644))
        for member in sorted(archive.getmembers(),key=lambda entry:entry.name):
            if member.isfile() and member.name.startswith(prefix+'tests/'):
                tests.append((member.name[len(prefix):],archive.extractfile(member).read(),0o644))
    return tests


def verify_auxiliary(settings,version):
    for kind,expected in (('sdk',sdk_files(settings)),('tests',test_files(settings))):
        path=settings.releases/('internal/quickjs-cosmo-'+kind+'-'+settings.runtime_profile+'-'+version+'.zip')
        if path.with_suffix('.zip.sha256').read_text().split()!=[digest(path.read_bytes()),path.name]:
            raise ValueError('SDK/tests archive checksum mismatch')
        with zipfile.ZipFile(path) as archive:
            actual=[(entry.filename,archive.read(entry),(entry.external_attr>>16)&0o777) for entry in archive.infolist()]
            if archive.testzip() or actual!=expected:raise ValueError('SDK/tests archive differs from its tested inputs')
