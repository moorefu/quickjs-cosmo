#!/usr/bin/env python3
"""Verify host runtime process, exit status and stdio regressions."""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import time

from build_config import load_config
from host_runtime import ape_command, host_info

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ("_COSMO_FDS", "_COSMO_FDS_V2", "_MASK")


class WindowsJob:
    """Close only this audit process tree, including a child stuck before exec."""
    def __init__(self):
        class Basic(ctypes.Structure):
            _fields_ = [
                ("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                ("flags", wintypes.DWORD), ("min_working", ctypes.c_size_t),
                ("max_working", ctypes.c_size_t), ("active", wintypes.DWORD),
                ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
                ("scheduling", wintypes.DWORD),
            ]

        class Counters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in
                        ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]

        class Limits(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", Counters),
                        ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                        ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]

        self.api = ctypes.WinDLL("kernel32", use_last_error=True)
        self.api.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.api.CreateJobObjectW.restype = wintypes.HANDLE
        self.api.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                    ctypes.c_void_p, wintypes.DWORD]
        self.api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.api.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.api.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.api.CreateJobObjectW(None, None)
        limits = Limits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.handle or not self.api.SetInformationJobObject(
                self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())

    def assign(self, process):
        if not self.api.AssignProcessToJobObject(self.handle, int(process._handle)):
            process.kill()
            raise ctypes.WinError(ctypes.get_last_error())

    def stop(self):
        self.api.TerminateJobObject(self.handle, 99)

    def close(self):
        self.api.CloseHandle(self.handle)


def run(command, timeout=5, env=None, input_text=None, no_window=True):
    job = WindowsJob() if os.name == "nt" else None
    options = dict(stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.PIPE,
                   env=dict(os.environ, TZ="UTC", LC_ALL="C") if env is None else env, cwd=ROOT)
    if os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NO_WINDOW if no_window else 0
        api = ctypes.WinDLL("kernel32")
        old_mode = api.SetErrorMode(0x8003)  # Suppress inherited crash/error dialogs during probes.
    else:
        options["start_new_session"] = True
    started = time.monotonic()
    process = None
    try:
        process = subprocess.Popen([str(arg) for arg in command], **options)
        if job:
            job.assign(process)
        try:
            stdout, stderr = process.communicate(
                None if input_text is None else input_text.encode("utf-8"), timeout=timeout)
            timed_out = False
        except subprocess.TimeoutExpired:
            if job:
                job.stop()
            else:
                os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate(timeout=3)
            timed_out = True
        return dict(returncode=process.returncode, timed_out=timed_out,
                    seconds=round(time.monotonic() - started, 3),
                    stdout=stdout.decode("utf-8", errors="replace"),
                    stderr=stderr.decode("utf-8", errors="replace"))
    finally:
        if job:
            job.close()
            api.SetErrorMode(old_mode)
        elif process:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def chain_fixture(qjs, fixture):
    outcomes = {}
    for clean in (False, True):
        environment = dict(os.environ, QJS_AUDIT_MARKER="用户变量")
        if clean:
            environment = {k: v for k, v in environment.items() if k.upper() not in PROTOCOL}
        result = subprocess.run([qjs, fixture, "stdio"], input="输入正文\n".encode(),
                                capture_output=True, env=environment, timeout=5)
        outcomes["clean" if clean else "inherited"] = dict(
            returncode=result.returncode,
            stdout=result.stdout.decode("utf-8", errors="replace"),
            stderr=result.stderr.decode("utf-8", errors="replace"))
    print("CHAIN_JSON " + json.dumps(dict(
        protocol_keys=[k for k in os.environ if k.upper() in PROTOCOL], outcomes=outcomes),
        ensure_ascii=False), flush=True)


def native_fixture():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    print("NATIVE_JSON " + json.dumps(dict(
        input=sys.stdin.read(), cwd=os.getcwd(), argv=sys.argv[2:],
        marker=os.environ.get("QJS_AUDIT_MARKER"),
        preserved=os.environ.get("_COSMO_USER"),
        protocol=[k for k in os.environ if k.upper() in PROTOCOL]), ensure_ascii=False))
    print("x" * 1048576)
    print("NATIVE_STDERR_OK", file=sys.stderr)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) > 1 and sys.argv[1] == "--chain-fixture":
        chain_fixture(sys.argv[2], sys.argv[3])
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--native-fixture":
        native_fixture()
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nightly", action="store_true", help="Compatibility alias; Nightly is always used")
    parser.add_argument("--qjs", type=Path)
    parser.add_argument("--qjsc", type=Path)
    parser.add_argument("--label", default="current")
    parser.add_argument("--verify", action="store_true", help="Assert the repaired runtime contract")
    parser.add_argument("--standalone", type=Path, help="Also test qjsc-compiled process fixture")
    args = parser.parse_args()
    settings = load_config("nightly" if args.nightly else None)
    qjs = (args.qjs or settings.dist / "qjs.exe").resolve()
    qjsc = (args.qjsc or settings.dist / "qjsc.exe").resolve()
    system = platform.system().lower()
    work = ROOT / "build/runtime-audit" / (settings.profile + "-" + args.label + "-" + system)
    work.mkdir(parents=True, exist_ok=True)
    fixture = ROOT / "tests/runtime_process.js"
    outcomes = []
    expectations = {}

    def invoke(binary, arguments, **options):
        command = ape_command(binary, arguments, settings.dist)
        return run(command, **options)

    def record(name, result):
        for line in result["stdout"].splitlines():
            if line.startswith("AUDIT_JSON "):
                result["probe"] = json.loads(line[len("AUDIT_JSON "):])
        outcomes.append(dict(name=name, **result))
        brief = {k: v for k, v in result.items() if k not in ("stdout", "stderr")}
        print(name, json.dumps(brief, ensure_ascii=False), flush=True)
        return result

    record("platform", invoke(qjs, ["--std", "-e", "print(os.platform)"]))
    for hidden in (False, True) if os.name == "nt" else (False,):
        for index in range(3):
            record(f"natural-exit/{hidden}/{index}",
                   invoke(qjs, ["-e", "print('NATURAL_EXIT_OK')"], no_window=hidden))
        record(f"uncaught-error/{hidden}", invoke(qjs, ["-e", "throw Error('expected')"], no_window=hidden))
        record(f"qjsc-valid/{hidden}", invoke(qjsc, ["-c", "-o", work / "hello.c",
                                                  ROOT / "examples/hello.js"], no_window=hidden))
    record("std-exit7", invoke(qjs, ["--std", "-e", "std.exit(7)"]))
    (work / "invalid.js").write_text("const = ;\n")
    record("qjsc-invalid", invoke(qjsc, ["-c", "-o", work / "invalid.c", work / "invalid.js"]))

    def spawn(name, program, argv, asynchronous=False, expected=0, binary=qjs, **options):
        config = work / (name + ".json")
        config.write_text(json.dumps({"program": str(program).replace("\\", "/"),
                                      "argv": argv, "async": asynchronous, **options}))
        expectations[name] = (expected, asynchronous)
        return record(name, invoke(binary, [config] if binary != qjs else [fixture, config], timeout=15))

    if os.name == "nt":
        cmd = Path(os.environ["SystemRoot"]) / "System32/cmd.exe"
        spawn("async-cmd", cmd, ["cmd.exe", "/d", "/c", "exit 3"], True, expected=3)
        spawn("block-cmd", cmd, ["cmd.exe", "/d", "/c", "exit 3"], expected=3)
    else:
        spawn("async-shell", "/bin/sh", ["sh", "-c", "exit 3"], True, expected=3)
        spawn("block-shell", "/bin/sh", ["sh", "-c", "exit 3"], expected=3)
    spawn("block-python7", sys.executable, ["python", "-c", "import sys; sys.exit(7)"], expected=7)
    git = shutil.which("git.exe" if os.name == "nt" else "git")
    if git:
        spawn("block-git", git, ["git", "--version"])
    if os.name == "nt":
        spawn("raw-status", sys.executable, ["python", "-c",
              "import ctypes; ctypes.windll.kernel32.ExitProcess(3221225794)"], expected=3221225794)
        spawn("process-chain", sys.executable, ["python", str(Path(__file__).resolve()),
              "--chain-fixture", str(qjs), str(fixture)])
        stale = dict(os.environ, QJS_AUDIT_MARKER="用户变量")
        stale["_COSMO_FDS_V2"] = "".join(f"{fd}_-1_1_0_0_0_0_0_0;" for fd in range(3))
        record("stale-protocol", invoke(qjs, [fixture, "stdio"], env=stale, input_text="输入正文\n"))

    # The child cannot finish until the parent has performed its first WNOHANG.
    release = work / "async.release"
    release.unlink(missing_ok=True)
    spawn("async-python7", sys.executable, ["python", "-c",
          "import pathlib,time\np=pathlib.Path(" + repr(str(release)) + ")\n"
          "while not p.exists(): time.sleep(0.01)\nraise SystemExit(7)"],
          True, expected=7, releaseFile=release.as_posix())
    spawn("path-python", Path(sys.executable).name,
          [Path(sys.executable).name, "-c", "pass"], usePath=True)
    if args.standalone:
        spawn("standalone-process", sys.executable,
              ["python", "-c", "raise SystemExit(7)"], expected=7, binary=args.standalone.resolve())
    if os.name == "nt":
        for status in (0xC0000005, 0xC0000142):
            spawn("async-raw-" + hex(status), sys.executable,
                  ["python", "-c", f"import ctypes; ctypes.windll.kernel32.ExitProcess({status})"],
                  True, expected=status)
        for key in ("uid", "gid"):
            spawn("unsupported-" + key, sys.executable, ["python", "-c", "pass"],
                  expected="unsupported", **{key: 0})
        for asynchronous in (False, True):
            spawn("missing-" + str(asynchronous), work / "does-not-exist.exe", ["missing.exe"],
                  asynchronous, expected="posix_spawn failed")

    unicode_dir = work / "工作目录 with spaces"
    unicode_dir.mkdir(exist_ok=True)
    capture = {name: (work / (name + ".txt")).as_posix() for name in ("stdin", "stdout", "stderr")}
    Path(capture["stdin"]).write_bytes("输入正文\n".encode("utf-8"))
    arguments = ['space and "quotes"', r"literal\value", "中文参数"]
    environment = dict(os.environ, QJS_AUDIT_MARKER="替换环境", _COSMO_USER="保留用户变量")
    if os.name == "nt":
        environment.update(_COSMO_FDS="stale", _MASK="0", _COSMO_FDS_V2="stale")
    spawn("native-stdio-cwd-env", sys.executable,
          ["python", str(Path(__file__).resolve()), "--native-fixture", *arguments],
          cwd=unicode_dir.as_posix(), env=environment, capture=capture)
    native_stdout = Path(capture["stdout"]).read_text(encoding="utf-8")
    native_stderr = Path(capture["stderr"]).read_text(encoding="utf-8")
    capture = {**capture, **{name: (work / ("ape-" + name + ".txt")).as_posix()
                            for name in ("stdout", "stderr")}}
    direct = ape_command(qjs, [fixture, "stdio"], settings.dist)
    executable = direct[0]
    spawn("ape-stdio", executable, direct, expected=7,
          env=dict(os.environ, QJS_AUDIT_MARKER="用户变量"), capture=capture)
    ape_stdout = Path(capture["stdout"]).read_text(encoding="utf-8")
    ape_stderr = Path(capture["stderr"]).read_text(encoding="utf-8")

    failed = []
    if args.verify:
        def require(name, condition):
            if not condition:
                failed.append(name)
        for row in outcomes:
            name = row["name"]
            require(name + "/timeout", not row["timed_out"])
            code = 1 if name.startswith(("uncaught-error/", "qjsc-invalid")) else 7 if name in (
                "std-exit7", "stale-protocol") else 0
            require(name + "/exit", row["returncode"] == code)
            if name.startswith("natural-exit/"):
                require(name + "/output", row["stdout"] == "NATURAL_EXIT_OK\n")
            if name in expectations:
                expected, asynchronous = expectations[name]
                probe = row.get("probe", {})
                if isinstance(expected, str):
                    require(name + "/error", expected in probe.get("error", ""))
                elif asynchronous:
                    wait = probe.get("wait", [None, None])
                    status = expected if os.name == "nt" else expected << 8
                    require(name + "/status", wait[0] and wait[0] > 0 and wait[1] == status
                            and not probe.get("timedOut", True))
                else:
                    require(name + "/status", probe.get("result") == expected)
                    require(name + "/parent-cwd", probe.get("parentCwd") == probe.get("cwdAfter"))
            if name == "async-python7":
                require(name + "/initial-status", row.get("probe", {}).get("firstWait") == [0, 0])
            if name == "process-chain":
                try:
                    chain = json.loads(next(line[11:] for line in row["stdout"].splitlines()
                                            if line.startswith("CHAIN_JSON ")))
                    require(name + "/protocol", chain["protocol_keys"] == [])
                    for outcome in chain["outcomes"].values():
                        require(name + "/child-exit", outcome["returncode"] == 7)
                        require(name + "/stdio", json.loads(outcome["stdout"]) == dict(
                            input="输入正文\n", marker="用户变量") and outcome["stderr"] == "CHILD_STDERR_OK\n")
                except (ValueError, KeyError, StopIteration):
                    failed.append(name + "/invalid-chain-output")
            if name == "stale-protocol":
                require(name + "/stdio", row["stdout"] == '{"input":"输入正文\\n","marker":"用户变量"}\n'
                        and row["stderr"] == "CHILD_STDERR_OK\n")
        try:
            native = json.loads(native_stdout.splitlines()[0][12:])
            require("native/arguments", native["argv"] == arguments)
            require("native/cwd", Path(native["cwd"]).resolve() == unicode_dir.resolve())
            require("native/environment", native["marker"] == "替换环境" and native["preserved"] == "保留用户变量")
            require("native/protocol", native["protocol"] == [])
            require("native/stdio", native["input"] == "输入正文\n" and
                    native_stdout.splitlines()[1] == "x" * 1048576 and native_stderr == "NATIVE_STDERR_OK\n")
            require("ape/stdio", json.loads(ape_stdout) == dict(input="输入正文\n", marker="用户变量")
                    and ape_stderr == "CHILD_STDERR_OK\n")
        except (ValueError, KeyError, IndexError):
            failed.append("stdio/invalid-output")

    report = dict(profile=settings.profile, variant=args.label, host=host_info(),
                  system=system, qjs=str(qjs), qjs_sha256=hashlib.sha256(qjs.read_bytes()).hexdigest(),
                  quickjs=settings.data["quickjs"], cosmopolitan=settings.data["cosmopolitan"],
                  outcomes=outcomes, verified=args.verify, failed=failed)
    destination = ROOT / "build/runtime-audit" / f"{settings.profile}-{args.label}-{system}.json"
    destination.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("REPORT", destination, flush=True)
    if args.verify:
        print("FAIL " + ", ".join(failed) if failed else f"PASS runtime ({len(outcomes)} cases)", flush=True)
    return bool(failed)


if __name__ == "__main__":
    sys.exit(main())
