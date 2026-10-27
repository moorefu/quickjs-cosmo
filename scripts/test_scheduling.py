#!/usr/bin/env python3
"""Bounded Node/qjs subprocess checks for scheduler liveness and exit events."""
import argparse
import json
from pathlib import Path
import shutil
import sys

from build_config import load_config
from host_runtime import ape_command, host_info
from node_contract import read_json
from test_node_compat import node_identity, run_command, write_report

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    dict(id='unref-timeout', code="setTimeout(()=>console.log('wrong'),10000).unref(); console.log('done');", output='done\n'),
    dict(id='unref-interval', code="setInterval(()=>console.log('wrong'),10000).unref(); console.log('done');", output='done\n'),
    dict(id='unref-immediate', code="setImmediate(()=>console.log('wrong')).unref(); console.log('done');", output='done\n'),
    dict(id='ref-after-unref', code="setTimeout(()=>console.log('fired'),5).unref().ref();", output='fired\n'),
    dict(id='refresh-fired', code="let n=0;const t=setTimeout(()=>{console.log(++n);if(n===1)t.refresh()},2);", output='1\n2\n'),
    dict(id='unreferenced-await', module=True, code="import{setTimeout}from'node:timers/promises';await setTimeout(10000,'unused',{ref:false});console.log('wrong');", status=13, output=''),
    dict(id='unsettled-await', module=True, code="await new Promise(()=>{});console.log('wrong');", status=13, output=''),
    dict(id='unsettled-custom-code', module=True, code="process.exitCode=7;await new Promise(()=>{});", status=7, output=''),
    dict(id='timeout-error', code="setTimeout(()=>{throw Error('SCHEDULER_EXPECTED_ERROR')},1);setTimeout(()=>console.log('wrong'),20);", status=1, error='SCHEDULER_EXPECTED_ERROR', output=''),
    dict(id='microtask-error', code="queueMicrotask(()=>{throw Error('SCHEDULER_EXPECTED_ERROR')});queueMicrotask(()=>console.log('wrong'));", status=1, error='SCHEDULER_EXPECTED_ERROR', output=''),
    dict(id='nexttick-error', code="process.nextTick(()=>{throw Error('SCHEDULER_EXPECTED_ERROR')});process.nextTick(()=>console.log('wrong'));", status=1, error='SCHEDULER_EXPECTED_ERROR', output=''),
    dict(id='promise-error', code="process.on('exit',code=>console.log('exit',code));setTimeout(async()=>{throw Error('SCHEDULER_EXPECTED_ERROR')},1);setTimeout(()=>console.log('wrong'),1);", status=1, error='SCHEDULER_EXPECTED_ERROR', output='exit 1\n'),
    dict(id='event-listener-error', module=True, code="const c=new AbortController();c.signal.onabort=()=>{throw Error('SCHEDULER_EXPECTED_ERROR')};c.abort();Promise.resolve().then(()=>console.log('promise'));process.on('exit',code=>console.log('exit',code));", status=1, error='SCHEDULER_EXPECTED_ERROR', output='promise\nexit 1\n'),
    dict(id='before-exit-rejection', code="process.on('beforeExit',async()=>{throw Error('SCHEDULER_EXPECTED_ERROR')});process.on('exit',code=>console.log('exit',code));", status=1, error='SCHEDULER_EXPECTED_ERROR', output='exit 1\n'),
    dict(id='global-script-order', code="process.nextTick(()=>console.log('tick'));Promise.resolve().then(()=>console.log('promise'));queueMicrotask(()=>console.log('micro'));", output='tick\npromise\nmicro\n'),
    dict(id='before-exit', code="let n=0;process.on('beforeExit',code=>{console.log('before',++n,code);if(n===1)setTimeout(()=>console.log('timer'),2)});process.on('exit',code=>console.log('exit',code));process.exitCode=7;", status=7, output='before 1 7\ntimer\nbefore 2 7\nexit 7\n'),
    dict(id='before-exit-microtask', code="process.on('beforeExit',()=>{console.log('before');queueMicrotask(()=>console.log('micro'))});process.on('exit',()=>console.log('exit'));", output='before\nmicro\nexit\n'),
    dict(id='explicit-exit', code="process.on('beforeExit',()=>console.log('wrong'));process.on('exit',code=>{console.log('exit',code);setTimeout(()=>console.log('wrong'),1)});process.exit(7);", status=7, output='exit 7\n'),
    dict(id='exit-error', code="process.on('exit',()=>{throw Error('SCHEDULER_EXPECTED_ERROR')});", status=1, error='SCHEDULER_EXPECTED_ERROR', output=''),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node')
    parser.add_argument('--qjs', type=Path)
    args = parser.parse_args()
    settings = load_config()
    host = host_info()
    from host_runtime import node_oracle_key
    local = ROOT / 'toolchains' / ('node-v24.21.0-' + node_oracle_key(host)) / ('node.exe' if host['platform'] == 'win32' else 'bin/node')
    node = Path(args.node or (str(local) if local.is_file() else shutil.which('node') or 'node')).resolve()
    identity = node_identity(node, ROOT, read_json(ROOT / 'compat/node-baseline.json'))
    qjs = (args.qjs or settings.dist / 'qjs.exe').resolve()
    results = []
    for case in CASES:
        node_args = ['--input-type=module'] if case.get('module') else []
        qjs_args = ['-m'] if case.get('module') else []
        reference = run_command([node, *node_args, '-e', case['code']], ROOT, 3)
        actual = run_command(ape_command(qjs, [*qjs_args, '-e', case['code']], settings.dist), ROOT, 3)
        status = case.get('status', 0)
        passed = all(value.get('failure') is None and value['exit_code'] == status and value['stdout'] == case['output']
                     and (not case.get('error') or case['error'] in value['stderr'])
                     for value in (reference, actual))
        results.append(dict(id=case['id'], passed=passed, node=reference, qjs=actual))
        print(('PASS ' if passed else 'FAIL ') + case['id'], flush=True)
        if not passed:
            print(json.dumps(results[-1], ensure_ascii=True), flush=True)
    report = ROOT / 'build/node-compat' / ('scheduling-' + host['system'] + '.json')
    write_report(report, dict(host=host, node=identity, results=results))
    print(f"Scheduler lifecycle: {sum(result['passed'] for result in results)}/{len(results)} passed")
    return int(any(not result['passed'] for result in results))


if __name__ == '__main__':
    sys.exit(main())
