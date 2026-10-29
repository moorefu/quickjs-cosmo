#!/usr/bin/env python3
"""Real PTY/ConPTY acceptance with a native supervisor kept alive after exit."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
from host_runtime import ape_command, host_info
from terminal_harness import TerminalSession

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/runtime_terminal.mjs'
CASES = ('legacy', 'owners', 'natural', 'explicit', 'throw', 'signal', 'reset-signal', 'keys', 'readline', 'legacy-read', 'sample', 'sample-signal', 'sample-throw', 'sample-explicit', 'idle-resize', 'worker')


def expected_cases():
    return {(entry, case) for entry in ('qjs', 'compiled', 'sdk') for case in (*CASES, 'pipe')} | {('sdk', 'lifecycle')}


def events(data):
    return [json.loads(match) for match in re.findall(rb'TTY_EVENT (\{[^\r\n]*\})', data)]


def send_control(path, command):
    # The native poller must never observe an empty file before Python flushes.
    temporary = path.with_suffix('.next')
    temporary.write_text(command, encoding='ascii')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('qjs', 'compiled', 'sdk'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    dist = args.qjs.resolve().parent
    folder = ROOT / 'build/terminal' / host_info()['system']
    folder.mkdir(parents=True, exist_ok=True)
    records = []
    def command(entry, mode):
        binary = getattr(args, entry).resolve()
        if mode == 'lifecycle':
            return ape_command(args.sdk.resolve(), ['--lifecycle'], dist)
        arguments = ['-m', str(FIXTURE)] if entry == 'qjs' else [str(FIXTURE)] if entry == 'sdk' else []
        return ape_command(binary, arguments, dist)
    for entry in ('qjs', 'compiled', 'sdk'):
        for mode in (*CASES, *(['lifecycle'] if entry == 'sdk' else [])):
            case = folder / (entry + '-' + mode)
            case.mkdir(exist_ok=True)
            control = case / 'control.txt'
            control.unlink(missing_ok=True)
            env = dict(os.environ, QJS_TERMINAL_CASE=mode, TZ='UTC', LC_ALL='C')
            if os.name == 'nt' and entry == 'sdk' and mode == 'sample':
                env['QJS_TERMINAL_TEST_NO_VT'] = '1'
            supervised = ape_command(args.sdk.resolve(), ['--supervise', str(control), *command(entry, mode)], dist)
            session = TerminalSession(supervised, ROOT, env)
            try:
                if mode in ('signal', 'reset-signal', 'keys', 'readline', 'legacy-read'):
                    session.wait_for(lambda data: any(value['kind'] == 'ready' for value in events(data)))
                # Immediate exception/exit can restore the alternate buffer
                # before ConPTY renders READY. Those cases need no input.
                if mode in ('sample', 'sample-signal'):
                    session.wait_for(lambda data: b'TTY_SAMPLE_READY' in data)
                if mode in ('signal', 'reset-signal', 'sample-signal'):
                    send_control(control, 'TERM')
                elif mode == 'keys':
                    ready = [v['value'] for v in events(bytes(session.output)) if v['kind'] == 'ready']
                    assert ready == [[80, 24]], ready
                    session.resize(100, 30)
                    session.wait_for(lambda data: any(v == dict(kind='resize', value=[100, 30]) for v in events(data)))
                    sequences = (b'j', b'\x1b[A', b'\x1b[15~', b'\r', b'\x1b', b'\x03')
                    expected = ('j', 'up', 'f5', 'return', 'escape', 'c')
                    for index, sequence in enumerate(sequences):
                        session.write(sequence)
                        session.wait_for(lambda data: len([v for v in events(data) if v['kind'] == 'key']) > index)
                    keys = [v['value'] for v in events(bytes(session.output)) if v['kind'] == 'key']
                    assert [v[1] for v in keys] == list(expected), keys
                    assert keys[-1][2] is True, keys
                elif mode == 'readline':
                    session.write(b'ab\x1b[DX\r')
                elif mode in ('sample', 'legacy-read'):
                    session.write(b'q')
                code = session.wait(12)
                session.wait_for(lambda data: b'TTY_CONTROL RESULT ' in data)
                data = bytes(session.output)
                result = json.loads(re.findall(rb'TTY_CONTROL RESULT (\[[^\r\n]*\])', data)[-1])
                assert code == 0 and result[0] == 1 and result[3] == 0, (code, result, data)
                expected_code = 7 if mode in ('explicit', 'sample-explicit') else 1 if mode in ('throw', 'sample-throw') else 15 if mode in ('signal', 'reset-signal') and os.name == 'nt' else -1 if mode in ('signal', 'reset-signal') else 0
                assert result[1] == expected_code, (mode, result, data)
                if mode in ('throw', 'sample-throw'):
                    marker = b'TTY_EXPECTED_SAMPLE_EXCEPTION' if mode == 'sample-throw' else b'TTY_EXPECTED_EXCEPTION'
                    assert marker in data, data
                if os.name != 'nt':
                    assert session.restored(), 'Parent PTY termios changed'
                    assert result[2] == (15 if mode in ('signal', 'reset-signal') else 0), result
                if mode.startswith('sample'):
                    # Inspect the application channel before ConPTY teardown.
                    if os.name == 'nt':
                        # ConPTY renders alternate buffers; it need not forward
                        # the original ANSI bytes. Query its active native buffer.
                        assert b'TTY_CONTROL DISPLAY [1]' in data, data
                        if entry == 'sdk' and mode == 'sample':
                            before = json.loads(re.findall(rb'TTY_CONTROL BEFORE (\[[^\r\n]*\])', data)[-1])
                            after = json.loads(re.findall(rb'TTY_CONTROL AFTER (\[[^\r\n]*\])', data)[-1])
                            assert not before[1] & 4 and before == after, (before, after)
                    else:
                        assert b'\x1b[?1049h' in data and b'\x1b[?1049l' in data, data
                        assert data.rfind(b'\x1b[?25h') > data.find(b'\x1b[?25l'), data
                        assert b'\x1b[0m\x1b[?25h\x1b[?1049l' in data, data
                records.append(dict(entry=entry, case=mode, restored=True, result=result))
                print('PASS terminal ' + entry + '/' + mode, flush=True)
            finally:
                session.save(case)
                session.close()
            records[-1]['logs'] = {name: hashlib.sha256((case / name).read_bytes()).hexdigest() for name in ('input.bin', 'output.bin')}
        pipe = subprocess.run(command(entry, 'pipe'), input=b''.join(('line-' + str(i) + '\r\n').encode() for i in range(256)), env=dict(os.environ, QJS_TERMINAL_CASE='pipe'), cwd=ROOT, capture_output=True, timeout=20)
        (folder / (entry + '-pipe.bin')).write_bytes(pipe.stdout + pipe.stderr)
        assert pipe.returncode == 0 and b'\x1b' not in pipe.stdout + pipe.stderr and dict(kind='done', value='pipe') in events(pipe.stdout), (entry, pipe)
        records.append(dict(entry=entry, case='pipe', noAutomaticAnsi=True, logs={'pipe.bin': hashlib.sha256(pipe.stdout + pipe.stderr).hexdigest()}))
    report = dict(format=1, host=host_info(), qjsSha256=hashlib.sha256(args.qjs.read_bytes()).hexdigest(), transport='ConPTY' if os.name == 'nt' else 'PTY', records=records)
    (folder / 'results.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print('PASS terminal all entries: ' + str(len(records)) + ' real terminal/pipe cases; raw logs in ' + str(folder))


if __name__ == '__main__':
    main()
