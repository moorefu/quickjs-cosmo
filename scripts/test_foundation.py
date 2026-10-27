#!/usr/bin/env python3
"""Check real process identity and entry behavior against the embedding contract."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

from build_config import load_config
from host_runtime import ape_command
from test_node_compat import result_value

ROOT = Path(__file__).resolve().parents[1]


def run(command):
    process = subprocess.Popen(list(map(str, command)), cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = process.communicate(timeout=30)
    value = result_value(dict(exit_code=process.returncode, stdout=stdout.decode('utf-8', 'replace'),
                              stderr=stderr.decode('utf-8', 'replace'), failure=None))
    return process.pid, value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--standalone', type=Path)
    args = parser.parse_args()
    settings = load_config()
    fixture = ROOT / 'tests/fixtures/process-entry.mjs'
    pid, value = run(ape_command(settings.dist / 'qjs.exe', ['-m', fixture, '中文 space', '--business-option'], settings.dist))
    assert value['pid'] == pid and value['ppid'] == os.getpid(), value
    assert value['argv'][1:] == [str(fixture), '中文 space', '--business-option'], value
    assert value['execArgv'] == ['-m'] and value['main'] and not value['importedMain'], value
    assert Path(value['execPath']).resolve() == (settings.dist / 'qjs.exe').resolve(), value
    assert value['url'] == fixture.as_uri() and value['importedURL'].startswith('file:'), value
    expression = "import p from 'node:process'; console.log('NODE_COMPAT_RESULT '+JSON.stringify({argv:p.argv,execArgv:p.execArgv,url:import.meta.url}));"
    _, evaluated = run(ape_command(settings.dist / 'qjs.exe', ['-m', '-e', expression, 'literal\\argument'], settings.dist))
    assert evaluated['argv'][1:] == ['literal\\argument'], evaluated
    assert evaluated['execArgv'] == ['-m', '-e', expression] and evaluated['url'] == 'qjs:eval', evaluated
    for code in [7, -1]:
        for source in [f'process.exitCode={code}', f'process.exit({code})']:
            command = ape_command(settings.dist / 'qjs.exe', ['-e', source], settings.dist)
            result = subprocess.run(list(map(str, command)), cwd=ROOT, capture_output=True, timeout=30)
            expected = code & (0xffffffff if os.name == 'nt' else 255)
            assert result.returncode == expected, (source, result.returncode, expected, result.stderr)
    if sys.platform == 'darwin':
        environment = dict(os.environ)
        environment.pop('HOME', None)
        source = "import os from 'node:os'; try { os.homedir(); throw Error('missing failure'); } catch(e) { if(e.code!=='ERR_NOT_SUPPORTED') throw e; }"
        result = subprocess.run(list(map(str, ape_command(settings.dist / 'qjs.exe', ['-m', '-e', source], settings.dist))),
                                cwd=ROOT, env=environment, capture_output=True, timeout=30)
        assert result.returncode == 0, result.stderr
    if args.standalone:
        target = args.standalone.resolve()
        pid, compiled = run(ape_command(target, ['中文 space', '--business-option'], settings.dist))
        assert compiled['pid'] == pid and compiled['ppid'] == os.getpid(), compiled
        assert compiled['argv'] == [str(target), str(target), '中文 space', '--business-option'], compiled
        assert compiled['execArgv'] == [] and compiled['main'] and not compiled['importedMain'], compiled
        assert compiled['url'] == target.as_uri() and compiled['importedURL'].startswith('qjs:embedded/'), compiled
        assert '/mnt/' not in compiled['importedURL'] and '/home/runner/' not in compiled['importedURL'], compiled
    print('PASS foundation-entry: native PID/PPID, source/eval arguments, URLs, exit codes' + (' and compiled identity' if args.standalone else ''))


if __name__ == '__main__':
    main()
