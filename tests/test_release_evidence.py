"""Reject missing, stale and incorrectly attributed release evidence."""
import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import release_evidence as evidence
from host_runtime import node_oracle_key
from runtime_capabilities import runtime_summary,features,report

class ReleaseEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.settings=SimpleNamespace(root=ROOT)
        self.inputs={'qjsSha256':'current-qjs','qjscSha256':'current-qjsc'}
        self.binding=patch.object(evidence,'binding',return_value=self.inputs);self.binding.start();self.addCleanup(self.binding.stop)

    def value(self,runner='ubuntu-24.04',build=False):
        platform,host_arch,execution=evidence.MATRIX[runner]
        host=dict(platform=platform,host_arch=host_arch,execution_arch=execution)
        baseline=evidence.read(ROOT/'compat/node-baseline.json');oracle=baseline['artifacts'][node_oracle_key(host)]
        node=dict(version=baseline['version'],platform=platform,arch='x64' if execution=='x86_64' else execution,execPath='node',sha256=oracle['sha256'],verification=dict(artifact=oracle['file'],artifact_sha256=oracle['sha256'],executable_sha256=oracle['sha256']))
        checks=sorted(evidence.expected_checks(ROOT,build,platform));contract=evidence.read(ROOT/'compat/release-checks.json')
        from test_terminal import expected_cases
        records=[dict(entry=entry,case=case,logs={'input.bin':'a'*64},**({'noAutomaticAnsi':True} if case=='pipe' else {'restored':True,'result':[1,0,0,0,0]})) for entry,case in sorted(expected_cases())]
        terminal=dict(host=host,qjsSha256=self.inputs['qjsSha256'],transport='ConPTY' if platform=='win32' else 'PTY',records=records)
        transports=[dict(target=target,api=api,count=count) for target in ('ape','native') for api in ('sync','async','legacy') for count in ([32]*8+[5])]
        transports += [dict(target=target,api=api,sharedCursor=True) for target in ('ape','native') for api in ('sync','async','legacy','legacy-async')]
        records=[dict(entry=entry,nativePid=1,value=dict(main=dict(pid=1),worker=dict(pid=1),vectors=261,nativeToApe=True,results=copy.deepcopy(transports))) for entry in ('qjs','compiled','sdk','installed-first','installed-reuse',*(['bare-elf'] if platform=='linux' else []))]
        records += [dict(entry=entry+'-custom-argv0',nativePid=1,value=dict(custom=True,main=dict(argv0='custom',pid=1),worker=dict(argv0='custom',pid=1))) for entry in ('qjs','compiled','sdk')]
        deployment=dict(host=host,qjsSha256=self.inputs['qjsSha256'],records=records,immutable={'dist/qjs.exe':self.inputs['qjsSha256']},capabilities={'zero':{}})
        security=dict(qjsSha256=self.inputs['qjsSha256'],deniedTargetKnownLive=True,unc=dict(status='implemented'),integrity=[dict(requested=rid,value=dict(status='executed',integrity=rid,proof=dict(passed=True,integrity=rid,deniedTarget=dict(status='permission-denied'),checks=[{}]*3))) for rid in (4096,8192,12288)])
        return dict(format=1,runner=runner,host=host,inputs=copy.deepcopy(self.inputs),node=node,terminal=terminal,deployment=deployment,windowsSecurity=security,passed=len(checks),failed=0,
            skipped=[contract['windows_skip']] if platform=='win32' else [],checks=checks,
            nodeTests=[t['id'] for t in evidence.read(ROOT/'compat/node-api.json')['tests'] if t['status']=='differential'])

    def test_complete_host_record(self):
        for runner in evidence.MATRIX:evidence.validate_evidence(self.settings,self.value(runner))

    def test_empty_success_is_rejected(self):
        value=self.value();value.update(checks=[],passed=0)
        with self.assertRaises(ValueError):evidence.validate_evidence(self.settings,value)

    def test_missing_terminal_case_is_rejected(self):
        value=self.value();value['terminal']['records'].pop()
        with self.assertRaisesRegex(ValueError,'terminal evidence'):evidence.validate_evidence(self.settings,value)

    def test_missing_terminal_log_is_rejected(self):
        value=self.value();value['terminal']['records'][0]['logs']={}
        with self.assertRaisesRegex(ValueError,'raw log evidence'):evidence.validate_evidence(self.settings,value)

    def test_stale_terminal_binary_is_rejected(self):
        value=self.value();value['terminal']['qjsSha256']='stale'
        with self.assertRaisesRegex(ValueError,'terminal evidence'):evidence.validate_evidence(self.settings,value)

    def test_missing_sdk_check_is_rejected(self):
        value=self.value();value['checks'].remove('sdk/cross-host-lifecycle');value['passed']-=1
        with self.assertRaises(ValueError):evidence.validate_evidence(self.settings,value)

    def test_stale_binary_binding_is_rejected(self):
        value=self.value();value['inputs']['qjscSha256']='another-compiler'
        with self.assertRaises(ValueError):evidence.validate_evidence(self.settings,value)

    def test_unexpected_skip_is_rejected(self):
        value=self.value();value['skipped']=['fixture missing']
        with self.assertRaises(ValueError):evidence.validate_evidence(self.settings,value)

    def test_duplicate_node_case_is_rejected(self):
        value=self.value();value['nodeTests'][0]=value['nodeTests'][1]
        with self.assertRaises(ValueError):evidence.validate_evidence(self.settings,value)

    def test_wrong_node_binary_is_rejected(self):
        value=self.value();value['node']['sha256']='unverified'
        with self.assertRaises(ValueError):evidence.validate_evidence(self.settings,value)

    def test_windows_arm_execution_identity_is_enforced(self):
        value=self.value('windows-11-arm');value['host']['execution_arch']='arm64'
        with self.assertRaises(ValueError):evidence.validate_evidence(self.settings,value)

    def test_missing_matrix_row_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)/'release-evidence';folder.mkdir()
            for runner in list(evidence.MATRIX)[:-1]:(folder/(runner+'.json')).write_text(json.dumps(self.value(runner)),encoding='utf8')
            with self.assertRaisesRegex(ValueError,'seven matrix rows'):evidence.aggregate(self.settings,directory)

    def kernel(self):
        lock=evidence.read(ROOT/'compat/kernel64k.json')
        layout=dict(format='APE',payloads=[dict(machine=183,ready64k=True,modern=True)],loaders={'183':dict(ready64k=True)})
        return dict(format=1,inputs=copy.deepcopy(self.inputs),kernel=dict(lock=lock),auxv=dict(pageSize=65536,release=lock['release'],machine='aarch64'),
            cases=['loader-fat','literal-argv0','bare-elf','compiled','sdk','qjsc','binfmt-fat','binfmt-nested'],results=[dict(kernel=True,immutable=True)]*7,
            consoleSha256='a'*64,layouts={name:dict(layout,sha256=self.inputs.get('qjsSha256' if name=='qjs.exe' else 'qjscSha256','unused')) for name in ('qjs.exe','qjsc.exe','deployment-standalone.exe','deployment-sdk.exe')})

    def test_wrong_native_pid_is_rejected(self):
        value=self.value();value['deployment']['records'][0]['nativePid']=2
        with self.assertRaisesRegex(ValueError,'PID identity'):evidence.validate_evidence(self.settings,value)

    def test_duplicate_cursor_transport_is_rejected(self):
        value=self.value();result=value['deployment']['records'][0]['value']['results'];result[-1]=result[-2]
        with self.assertRaisesRegex(ValueError,'shared cursor'):evidence.validate_evidence(self.settings,value)

    def test_kernel_missing_case_or_real_pages_is_rejected(self):
        for key,value in [('cases',[]),('auxv',dict(pageSize=4096)),('results',[])]:
            data=self.kernel();data[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):evidence.validate_kernel(self.settings,data)

    def test_missing_deployment_entry_is_rejected(self):
        value=self.value();value['deployment']['records'].pop()
        with self.assertRaisesRegex(ValueError,'deployment entry'):evidence.validate_evidence(self.settings,value)

    def test_permission_denied_is_not_windows_integrity_coverage(self):
        value=self.value('windows-2022');value['windowsSecurity']['integrity'][0]['value']['status']='permission-denied'
        with self.assertRaisesRegex(ValueError,'actual Windows'):evidence.validate_evidence(self.settings,value)

    def test_complete_matrix_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)/'release-evidence';folder.mkdir()
            for runner in evidence.MATRIX:(folder/(runner+'.json')).write_text(json.dumps(self.value(runner)),encoding='utf8')
            original=evidence.read
            build=self.value(build=True);build['runner']='build-linux-x64'
            kernel=Path(directory)/'reports-kernel64k';kernel.mkdir();(kernel/'results.json').write_text(json.dumps(self.kernel()));(kernel/'console.log').write_text('console')
            with patch.object(evidence,'digest',return_value='a'*64),patch.object(evidence,'read',side_effect=lambda path:build if Path(path).as_posix().endswith('/build/ci/build-evidence.json') else original(path)):
                result=evidence.aggregate(self.settings,directory)
            self.assertEqual(len(result['platforms']),7)

    def test_capability_manifest_includes_late_modules(self):
        self.assertTrue({'node:tls','node:http','node:https','fetch','ReadableStream'}.issubset(features(report())))
        summary=runtime_summary();self.assertEqual(summary['scope']['tlsVersions'],['TLSv1.2'])
        # These are fixed native quotas, not estimates or host memory readings.
        import re
        tasks=(ROOT/'native/tasks.c').read_text();sockets=(ROOT/'native/net/socket.c').read_text();children=(ROOT/'native/process/async.c').read_text()
        self.assertEqual(int(re.search(r'THREADS=(\d+)',tasks)[1]),summary['limits']['nativeTasks']['threads'])
        self.assertEqual(int(re.search(r'CAPACITY=(\d+)',tasks)[1]),summary['limits']['nativeTasks']['tasks'])
        self.assertEqual(int(re.search(r'SOCKET_LIMIT=(\d+)',sockets)[1]),summary['limits']['sockets']['count'])
        self.assertEqual(int(re.search(r'CHILD_LIMIT=(\d+)',children)[1]),summary['limits']['childProcesses']['count'])
        self.assertEqual(summary['limits']['sockets']['scope'],'runtime')
        self.assertEqual(summary['limits']['childProcesses']['scope'],'runtime')
        self.assertIn('MAX_RESERVED=64*1024*1024',tasks)
        self.assertIn('QJS_TLS_ARENA=8*1024*1024',(ROOT/'native/tls/backend.h').read_text())

if __name__=='__main__':unittest.main()
