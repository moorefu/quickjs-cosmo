#!/usr/bin/env python3
"""Run the same QuickJS scripts on Windows and Unix, with per-process timeouts."""
import argparse
import errno
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
from build_config import load_config
from host_runtime import ape_command, check_host, host_info

ROOT = Path(__file__).resolve().parents[1]


def execute(command, cwd, timeout=60, loader=None):
    if str(command[0]).endswith(".exe"):
        command = ape_command(command[0], command[1:], ROOT / "dist", loader=loader)
    environment = dict(os.environ, TZ="UTC", LC_ALL="C")
    options = dict(cwd=cwd, env=environment, text=True, encoding="utf-8", errors="replace",
                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    try:
        return subprocess.run([str(arg) for arg in command], **options)
    except OSError as error:
        if os.name == "posix" and error.errno == errno.ENOEXEC:
            return subprocess.run(["/bin/sh", *map(str, command)], **options)
        raise


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nightly", action="store_true", help="Compatibility alias; Nightly is always used")
    parser.add_argument("--qjs", type=Path)
    parser.add_argument("--qjsc", type=Path)
    parser.add_argument("--upstream", action="store_true")
    parser.add_argument("--compile", action="store_true", help="Also compile and run a standalone APE (needs cosmocc)")
    parser.add_argument("--node-compat", action="store_true", help="Run implemented Node differential contracts (requires pinned Node)")
    parser.add_argument("--node", help="Node oracle executable; used with --node-compat")
    parser.add_argument("--standalone", type=Path, help="Run an existing standalone APE produced on another host")
    parser.add_argument("--expected-platform", choices=("linux", "darwin", "win32"))
    parser.add_argument("--expected-arch", choices=("x86_64", "arm64"))
    parser.add_argument("--expected-execution-arch", choices=("x86_64", "arm64"))
    args = parser.parse_args()
    if args.node and not args.node_compat:
        parser.error("--node requires --node-compat")
    settings = load_config("nightly" if args.nightly else None)
    qjs = (args.qjs or settings.dist / "qjs.exe").resolve()
    qjsc = (args.qjsc or settings.dist / "qjsc.exe").resolve()
    arch = "aarch64" if platform.machine().lower() in ("aarch64", "arm64") else "x86_64"
    loader = settings.dist / f"ape-{arch}.elf"
    system = platform.system().lower()
    host = host_info()
    try:
        check_host(host, args.expected_platform, args.expected_arch, args.expected_execution_arch)
    except ValueError as error:
        parser.error(str(error))
    print("HOST " + json.dumps(host), flush=True)
    if args.standalone and not (args.standalone.resolve().parent / "runtime-standalone.exe").is_file():
        parser.error("--standalone requires the adjacent runtime-standalone.exe process fixture")
    scratch = ROOT / "build" / ("test-" + system)
    scratch.mkdir(parents=True, exist_ok=True)
    results = []

    def check(name, command, cwd=scratch, expected=0, contains=None, timeout=60):
        start = time.monotonic()
        try:
            result = execute(command, cwd, timeout, loader=loader)
            expected_raw = expected
            passed = result.returncode == expected_raw and (contains is None or contains in result.stdout)
            output = result.stdout
            code = result.returncode
        except (OSError, subprocess.TimeoutExpired) as error:
            passed, output, code = False, str(error), None
        results.append(dict(name=name, passed=passed, exit_code=code, expected_logical_exit=expected,
                            seconds=round(time.monotonic() - start, 3), output=output))
        print(("PASS " if passed else "FAIL ") + name, flush=True)
        if output.strip():
            print(output.rstrip(), flush=True)
        return passed

    if args.compile or args.standalone:
        for probe in ("native", "backends"):
            command = [sys.executable, ROOT / ("scripts/probe_" + probe + ".py")]
            if args.compile:
                command.append("--compile")
                if probe == "backends": command.append("--offline")
            check("native/" + probe, command, timeout=300)

    for name in ("language", "modules", "async", "io", "io-events", "worker", "experimental"):
        flags = ["--experimental"] if name == "experimental" else []
        check("custom/" + name, [qjs, *flags, "-m", ROOT / f"tests/{name}.js"],
              contains="PASS " + name)
    expected_platform = "win32" if os.name == "nt" else system
    check("custom/platform", [qjs, "-m", ROOT / "tests/platform.js", expected_platform], contains="PASS platform")
    check("custom/node-contract-inventory", [sys.executable, ROOT / "scripts/test_node_compat.py", "--check-contract"],
          contains="PASS node-contract")
    check("custom/runtime-modules", [qjs, "-m", ROOT / "tests/runtime_modules.mjs"], contains="PASS runtime-modules")
    check("custom/runtime-buffer", [qjs, "-m", ROOT / "tests/runtime_buffer.mjs"], contains="PASS runtime-buffer")
    check("custom/runtime-foundation", [qjs, "-m", ROOT / "tests/runtime_foundation.mjs"], contains="PASS runtime-foundation")
    check("custom/runtime-scheduling", [qjs, "-m", ROOT / "tests/runtime_scheduling.mjs"], contains="PASS runtime-scheduling")
    check("custom/runtime-fs", [qjs, "-m", ROOT / "tests/runtime_fs.mjs"], contains="PASS runtime-fs")
    check("custom/runtime-crypto", [qjs, "-m", ROOT / "tests/runtime_crypto.mjs"], contains="PASS runtime-crypto")
    check("custom/runtime-crypto-advanced", [qjs, "-m", ROOT / "tests/runtime_crypto_advanced.mjs"], contains="PASS runtime-crypto-advanced", timeout=120)
    check("custom/runtime-compression", [qjs, "-m", ROOT / "tests/runtime_compression.mjs"], contains="PASS runtime-compression")
    check("custom/runtime-child-process", [qjs, "-m", ROOT / "tests/runtime_child_process.mjs"], contains="PASS runtime-child-process")
    check("custom/runtime-async", [qjs, "-m", ROOT / "tests/runtime_async.mjs"], contains="PASS runtime-async", timeout=120)
    check("custom/runtime-file-algorithm-streams", [qjs, "-m", ROOT / "tests/runtime_file_algorithm_streams.mjs"], contains="PASS runtime-file-algorithm-streams", timeout=120)
    check("custom/runtime-stream", [qjs, "-m", ROOT / "tests/runtime_stream.mjs"], contains="PASS runtime-stream", timeout=120)
    check("custom/runtime-child-process-async", [qjs, "-m", ROOT / "tests/runtime_child_process_async.mjs"], contains="PASS runtime-child-process-async", timeout=120)
    check("custom/unknown-builtin", [qjs, "-m", ROOT / "tests/fixtures/unknown-builtin.mjs"],
          expected=1, contains="Unknown builtin module: node:missing")
    check("qjsc/unknown-builtin", [qjsc, "-c", "-m", "-o", scratch / "unknown-builtin.c",
          ROOT / "tests/fixtures/unknown-builtin.mjs"], expected=1, contains="Unknown builtin module: node:missing")
    check("custom/runtime-metadata-oom", [qjs, "--memory-limit", "8M", "-m", ROOT / "tests/runtime_metadata_oom.mjs"],
          contains="PASS runtime-metadata-oom")
    identity = dict(engine="quickjs", quickjsVersion=settings.data["quickjs"]["version"],
                    quickjsCommit=settings.data["quickjs"]["commit"],
                    cosmopolitanVersion=settings.data["cosmopolitan"]["version"],
                    cosmopolitanCommit=settings.data["cosmopolitan"]["commit"],
                    nodeApiTarget="v24.21.0", platform=expected_platform,
                    arch="x64" if host["execution_arch"] == "x86_64" else host["execution_arch"])
    identity_script = ("import {runtimeInfo} from 'cosmo:runtime'; const actual=runtimeInfo(); "
                       "for(const [key,value] of Object.entries(" + json.dumps(identity) + ")) "
                       "if(actual[key]!==value) throw Error('Runtime identity mismatch: '+key); "
                       "console.log('PASS runtime-identity')")
    check("custom/runtime-identity", [qjs, "-m", "-e", identity_script], contains="PASS runtime-identity")
    if args.node_compat:
        node_command = [sys.executable, ROOT / "scripts/test_node_compat.py", "--qjs", qjs]
        if args.node:
            node_command += ["--node", str(Path(args.node).resolve())]
        check("custom/node-differential", node_command, contains="Node/qjs differential:", timeout=180)
        scheduling = [sys.executable, ROOT / "scripts/test_scheduling.py", "--qjs", qjs]
        if args.node:
            scheduling += ["--node", str(Path(args.node).resolve())]
        check("custom/scheduler-lifecycle", scheduling, contains="Scheduler lifecycle:", timeout=180)
    check("example/hello", [qjs, ROOT / "examples/hello.js"], contains="Hello from QuickJS")
    check("example/system-info", [qjs, "-m", ROOT / "examples/system-info.js", "hello"], contains='"workerAvailable": true')
    check("cli/explicit-exit", [qjs, "--std", "-e", "std.exit(7)"], expected=7)
    check("cli/syntax-error", [qjs, "-e", "const = ;"], expected=1, contains="SyntaxError")
    check("cli/uncaught-error", [qjs, "-e", "throw new Error('expected-test-error')"],
          expected=1, contains="expected-test-error")
    check("cli/unhandled-rejection", [qjs, "-e", "Promise.reject(new Error('expected-rejection'))"],
          expected=1, contains="expected-rejection")
    generated = scratch / "hello.c"
    if check("qjsc/generate-c", [qjsc, "-c", "-o", generated, ROOT / "examples/hello.js"]):
        valid = generated.is_file() and "const uint8_t" in generated.read_text()
        results[-1]["passed"] = valid
        if not valid:
            print("FAIL generated C has no bytecode array", flush=True)
    if args.compile:
        if check("qjsc/compile-crypto-advanced-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/crypto-advanced-worker.mjs",
                 "-o", scratch / "crypto-advanced-standalone.exe", ROOT / "tests/runtime_crypto_advanced.mjs"], timeout=180):
            check("qjsc/run-crypto-advanced-ape", [scratch / "crypto-advanced-standalone.exe"], contains="PASS runtime-crypto-advanced", timeout=120)
        if check("sdk/compile-crypto-advanced", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/crypto_advanced.c", settings.dist / "libquickjs.a", "-lm", "-lpthread", "-ldl",
                 "-Wl,--wrap=_Exit,-u,__wrap__Exit", "-Wl,--wrap=js_malloc_rt,--wrap=js_malloc,--wrap=js_free_rt",
                 "-o", scratch / "crypto-advanced-sdk.exe"], timeout=180):
            check("sdk/run-crypto-advanced", [scratch / "crypto-advanced-sdk.exe"], contains="PASS crypto-advanced-sdk", timeout=120)
        if check("qjsc/compile-file-algorithm-streams-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/file-algorithm-stream-worker.mjs",
                 "-o", scratch / "file-algorithm-streams-standalone.exe", ROOT / "tests/runtime_file_algorithm_streams.mjs"], timeout=180):
            check("qjsc/run-file-algorithm-streams-ape", [scratch / "file-algorithm-streams-standalone.exe"], contains="PASS runtime-file-algorithm-streams", timeout=120)
        if check("sdk/compile-file-algorithm-streams", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/file_algorithm_streams.c", settings.dist / "libquickjs.a", "-lm", "-lpthread", "-ldl",
                 "-Wl,--wrap=_Exit,-u,__wrap__Exit", "-Wl,--wrap=js_malloc_rt,--wrap=js_malloc",
                 "-o", scratch / "file-algorithm-streams-sdk.exe"], timeout=180):
            check("sdk/run-file-algorithm-streams", [scratch / "file-algorithm-streams-sdk.exe"], contains="PASS file-algorithm-stream-sdk", timeout=120)
        if check("qjsc/compile-child-process-async-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/child-process-async-worker.mjs",
                 "-o", scratch / "child-process-async-standalone.exe", ROOT / "tests/runtime_child_process_async.mjs"], timeout=180):
            check("qjsc/run-child-process-async-ape", [scratch / "child-process-async-standalone.exe"], contains="PASS runtime-child-process-async", timeout=120)
        if check("sdk/compile-child-process-async", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/child_process_async.c", settings.dist / "libquickjs.a", "-lm", "-lpthread", "-ldl",
                 "-Wl,--wrap=_Exit,-u,__wrap__Exit", "-Wl,--wrap=js_malloc_rt,--wrap=js_malloc,--wrap=pipe2,--wrap=close,--wrap=poll,--wrap=read,--wrap=write,--wrap=pthread_create,--wrap=qp_unix_launch,--wrap=qp_windows_launch,--wrap=qp_wait_child,--wrap=qp_force_reap,--wrap=qp_windows_close",
                 "-o", scratch / "child-process-async-sdk.exe"], timeout=180):
            check("sdk/run-child-process-async", [scratch / "child-process-async-sdk.exe"], contains="PASS child-process-async-sdk", timeout=120)
        if check("qjsc/compile-stream-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/stream-worker.mjs",
                 "-o", scratch / "stream-standalone.exe", ROOT / "tests/runtime_stream.mjs"], timeout=180):
            check("qjsc/run-stream-ape", [scratch / "stream-standalone.exe"], contains="PASS runtime-stream", timeout=120)
        if check("sdk/compile-stream", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/stream.c", settings.dist / "libquickjs.a", "-lm", "-lpthread", "-ldl",
                 "-Wl,--wrap=_Exit,-u,__wrap__Exit", "-o", scratch / "stream-sdk.exe"], timeout=180):
            check("sdk/run-stream", [scratch / "stream-sdk.exe"], contains="PASS stream-sdk", timeout=120)
        if check("qjsc/compile-async-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/async-worker.mjs",
                 "-o", scratch / "async-standalone.exe", ROOT / "tests/runtime_async.mjs"], timeout=180):
            check("qjsc/run-async-ape", [scratch / "async-standalone.exe"], contains="PASS runtime-async", timeout=120)
        if check("sdk/compile-async", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/async.c", settings.dist / "libquickjs.a", "-lm", "-lpthread", "-ldl",
                 "-Wl,--wrap=_Exit,-u,__wrap__Exit", "-Wl,--wrap=js_malloc_rt,--wrap=js_malloc,--wrap=qjs_cosmo_fs_openat,--wrap=__fcntl_dupfd_cloexec,--wrap=read,--wrap=write,--wrap=close,--wrap=getrandom",
                 "-o", scratch / "async-sdk.exe"], timeout=180):
            check("sdk/run-async", [scratch / "async-sdk.exe"], contains="PASS async-sdk", timeout=120)
        if check("sdk/compile-task-pool", [sys.executable, ROOT / "scripts/build_task_tests.py"],
                 contains="PASS task-pool SDK build", timeout=180):
            check("sdk/task-pool-source", [scratch / "task-pool-sdk.exe"], contains="PASS task-pool-sdk", timeout=120)
            check("sdk/task-pool-bytecode", [scratch / "task-pool-sdk.exe", "--bytecode"], contains="PASS task-pool-sdk", timeout=120)
        if check("qjsc/compile-child-process-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/child-process-worker.mjs",
                 "-o", scratch / "child-process-standalone.exe", ROOT / "tests/runtime_child_process.mjs"], timeout=180):
            check("qjsc/run-child-process-ape", [scratch / "child-process-standalone.exe"], contains="PASS runtime-child-process")
        if check("sdk/compile-child-process", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/child_process.c", settings.dist / "libquickjs.a", "-lm", "-lpthread", "-ldl",
                 "-Wl,--wrap=_Exit,-u,__wrap__Exit", "-Wl,--wrap=js_malloc_rt,--wrap=js_free_rt,--wrap=pipe2,--wrap=poll,--wrap=read,--wrap=write,--wrap=pthread_create",
                 "-o", scratch / "child-process-sdk.exe"], timeout=180):
            check("sdk/run-child-process", [scratch / "child-process-sdk.exe"], contains="PASS child-process-sdk", timeout=180)
        check("custom/compression-interoperability", [sys.executable, ROOT / "scripts/test_compression_interop.py"],
              contains="PASS compression interoperability", timeout=180)
        if check("qjsc/compile-compression-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/compression-worker.mjs",
                 "-o", scratch / "compression-standalone.exe", ROOT / "tests/runtime_compression.mjs"], timeout=180):
            check("qjsc/run-compression-ape", [scratch / "compression-standalone.exe"], contains="PASS runtime-compression")
        if check("sdk/compile-compression", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/compression.c", settings.dist / "libquickjs.a", "-lm", "-lpthread", "-ldl",
                 "-Wl,--wrap=_Exit,-u,__wrap__Exit", "-Wl,--wrap=js_malloc_rt,--wrap=js_free_rt",
                 "-o", scratch / "compression-sdk.exe"], timeout=180):
            check("sdk/run-compression", [scratch / "compression-sdk.exe"], contains="PASS compression-sdk")
        if check("qjsc/compile-crypto-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/crypto-worker.mjs",
                 "-o", scratch / "crypto-standalone.exe", ROOT / "tests/runtime_crypto.mjs"], timeout=180):
            check("qjsc/run-crypto-ape", [scratch / "crypto-standalone.exe"], contains="PASS runtime-crypto")
        if check("sdk/compile-crypto", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/crypto.c", settings.dist / "libquickjs.a", "-lm", "-lpthread", "-ldl",
                 "-Wl,--wrap=_Exit,-u,__wrap__Exit", "-Wl,--wrap=js_malloc_rt,--wrap=js_malloc,--wrap=js_free_rt,--wrap=getrandom",
                 "-o", scratch / "crypto-sdk.exe"], timeout=180):
            check("sdk/run-crypto", [scratch / "crypto-sdk.exe"], contains="PASS crypto-sdk")
        if check("qjsc/compile-fs-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/fs-worker.mjs",
                 "-o", scratch / "fs-standalone.exe", ROOT / "tests/runtime_fs.mjs"], timeout=180):
            check("qjsc/run-fs-ape", [scratch / "fs-standalone.exe"], contains="PASS runtime-fs")
        if check("sdk/compile-fs", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/fs.c", settings.dist / "libquickjs.a", "-lm", "-lpthread", "-ldl",
                 "-Wl,--wrap=_Exit,-u,__wrap__Exit", "-Wl,--wrap=qjs_cosmo_fs_openat,--wrap=read,--wrap=write,--wrap=pread,--wrap=pwrite,--wrap=close,--wrap=fstat",
                 "-o", scratch / "fs-sdk.exe"], timeout=180):
            check("sdk/run-fs", [scratch / "fs-sdk.exe"], contains="PASS fs-sdk")
        standalone = scratch / "hello-standalone.exe"
        if check("qjsc/compile-ape", [qjsc, "-o", standalone, ROOT / "examples/hello.js"], timeout=180):
            check("qjsc/run-ape", [standalone], contains="Hello from QuickJS")
        check("qjsc/compile-process-ape", [qjsc, "-m", "-o", scratch / "runtime-standalone.exe",
              ROOT / "tests/runtime_process.js"], timeout=180)
        if check("qjsc/compile-registry-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/registry-worker.mjs",
                 "-o", scratch / "registry-standalone.exe", ROOT / "tests/runtime_modules.mjs"], timeout=180):
            check("qjsc/run-registry-ape", [scratch / "registry-standalone.exe"], contains="PASS runtime-modules")
        if check("qjsc/compile-buffer-ape", [qjsc, "-m", "-o", scratch / "buffer-standalone.exe",
                 ROOT / "tests/runtime_buffer.mjs"], timeout=180):
            check("qjsc/run-buffer-ape", [scratch / "buffer-standalone.exe"], contains="PASS runtime-buffer")
        if check("qjsc/compile-foundation-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/foundation-worker.mjs",
                 "-o", scratch / "foundation-standalone.exe", ROOT / "tests/runtime_foundation.mjs"], timeout=180):
            check("qjsc/run-foundation-ape", [scratch / "foundation-standalone.exe"], contains="PASS runtime-foundation")
        check("qjsc/compile-entry-ape", [qjsc, "-m", "-o", scratch / "entry-standalone.exe",
              ROOT / "tests/fixtures/process-entry.mjs"], timeout=180)
        if check("qjsc/compile-scheduling-ape", [qjsc, "-m", "-D", ROOT / "tests/fixtures/scheduling-worker.mjs",
                 "-o", scratch / "scheduling-standalone.exe", ROOT / "tests/runtime_scheduling.mjs"], timeout=180):
            check("qjsc/run-scheduling-ape", [scratch / "scheduling-standalone.exe"], contains="PASS runtime-scheduling")
        if check("sdk/compile-scheduler", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/scheduler.c", settings.dist / "libquickjs.a", "-Wl,--wrap=_Exit,-u,__wrap__Exit",
                 "-lm", "-lpthread", "-ldl", "-o", scratch / "scheduler-sdk.exe"], timeout=180):
            check("sdk/run-scheduler", [scratch / "scheduler-sdk.exe"], contains="PASS scheduler-sdk")
        if check("sdk/compile-registry", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/module_registry.c", settings.dist / "libquickjs.a",
                 "-Wl,--wrap=_Exit,-u,__wrap__Exit", "-lm", "-lpthread", "-ldl", "-o", scratch / "registry-sdk.exe"],
                 timeout=180):
            check("sdk/run-registry", [scratch / "registry-sdk.exe"], contains="PASS module-registry-sdk")
    if args.standalone:
        check("qjsc/cross-host-crypto-advanced", [args.standalone.resolve().parent / "crypto-advanced-standalone.exe"], contains="PASS runtime-crypto-advanced", timeout=120)
        check("sdk/cross-host-crypto-advanced", [args.standalone.resolve().parent / "crypto-advanced-sdk.exe"], contains="PASS crypto-advanced-sdk", timeout=120)
        check("qjsc/cross-host-file-algorithm-streams", [args.standalone.resolve().parent / "file-algorithm-streams-standalone.exe"], contains="PASS runtime-file-algorithm-streams", timeout=120)
        check("sdk/cross-host-file-algorithm-streams", [args.standalone.resolve().parent / "file-algorithm-streams-sdk.exe"], contains="PASS file-algorithm-stream-sdk", timeout=120)
        check("qjsc/cross-host-child-process-async", [args.standalone.resolve().parent / "child-process-async-standalone.exe"], contains="PASS runtime-child-process-async", timeout=120)
        check("sdk/cross-host-child-process-async", [args.standalone.resolve().parent / "child-process-async-sdk.exe"], contains="PASS child-process-async-sdk", timeout=120)
        check("qjsc/cross-host-stream", [args.standalone.resolve().parent / "stream-standalone.exe"], contains="PASS runtime-stream", timeout=120)
        check("sdk/cross-host-stream", [args.standalone.resolve().parent / "stream-sdk.exe"], contains="PASS stream-sdk", timeout=120)
        check("qjsc/cross-host-async", [args.standalone.resolve().parent / "async-standalone.exe"], contains="PASS runtime-async", timeout=120)
        check("sdk/cross-host-async", [args.standalone.resolve().parent / "async-sdk.exe"], contains="PASS async-sdk", timeout=120)
        check("sdk/cross-host-task-pool-source", [args.standalone.resolve().parent / "task-pool-sdk.exe"], contains="PASS task-pool-sdk", timeout=120)
        check("sdk/cross-host-task-pool-bytecode", [args.standalone.resolve().parent / "task-pool-sdk.exe", "--bytecode"], contains="PASS task-pool-sdk", timeout=120)
        check("qjsc/cross-host-child-process", [args.standalone.resolve().parent / "child-process-standalone.exe"], contains="PASS runtime-child-process")
        check("sdk/cross-host-child-process", [args.standalone.resolve().parent / "child-process-sdk.exe"], contains="PASS child-process-sdk", timeout=180)
        check("qjsc/cross-host-compression", [args.standalone.resolve().parent / "compression-standalone.exe"], contains="PASS runtime-compression")
        check("sdk/cross-host-compression", [args.standalone.resolve().parent / "compression-sdk.exe"], contains="PASS compression-sdk")
        check("qjsc/cross-host-crypto", [args.standalone.resolve().parent / "crypto-standalone.exe"], contains="PASS runtime-crypto")
        check("sdk/cross-host-crypto", [args.standalone.resolve().parent / "crypto-sdk.exe"], contains="PASS crypto-sdk")
        check("qjsc/cross-host-fs", [args.standalone.resolve().parent / "fs-standalone.exe"], contains="PASS runtime-fs")
        check("sdk/cross-host-fs", [args.standalone.resolve().parent / "fs-sdk.exe"], contains="PASS fs-sdk")
        check("qjsc/cross-host-ape", [args.standalone.resolve()], contains="Hello from QuickJS")
        check("qjsc/cross-host-registry", [args.standalone.resolve().parent / "registry-standalone.exe"],
              contains="PASS runtime-modules")
        check("sdk/cross-host-registry", [args.standalone.resolve().parent / "registry-sdk.exe"],
              contains="PASS module-registry-sdk")
        check("qjsc/cross-host-buffer", [args.standalone.resolve().parent / "buffer-standalone.exe"],
              contains="PASS runtime-buffer")
        check("qjsc/cross-host-foundation", [args.standalone.resolve().parent / "foundation-standalone.exe"],
              contains="PASS runtime-foundation")
        check("qjsc/cross-host-scheduling", [args.standalone.resolve().parent / "scheduling-standalone.exe"],
              contains="PASS runtime-scheduling")
        check("sdk/cross-host-scheduler", [args.standalone.resolve().parent / "scheduler-sdk.exe"], contains="PASS scheduler-sdk")
    foundation = [sys.executable, ROOT / "scripts/test_foundation.py"]
    compiled_entry = (args.standalone.resolve().parent if args.standalone else scratch) / "entry-standalone.exe"
    if (args.compile or args.standalone) and compiled_entry.is_file():
        foundation += ["--standalone", compiled_entry]
    check("custom/foundation-entry", foundation, contains="PASS foundation-entry")
    runtime = [sys.executable, ROOT / "scripts/audit_runtime.py", "--verify", "--label", "regression",
               "--qjs", qjs, "--qjsc", qjsc]
    compiled_process = (args.standalone.resolve().parent if args.standalone else scratch) / "runtime-standalone.exe"
    if (args.compile or args.standalone) and compiled_process.is_file():
        runtime += ["--standalone", compiled_process]
    check("custom/runtime-process", runtime, timeout=240, contains="PASS runtime")
    if os.name == "nt":
        check("cli/windows-module-path", [qjs, "-m", r".\tests\modules.js"],
              cwd=ROOT, contains="PASS modules")
        check("cli/windows-argument", [qjs, "-m", r".\examples\system-info.js", r"literal\value"],
              cwd=ROOT, contains=json.dumps(r"literal\value"))
        check("qjsc/windows-module-path", [qjsc, "-c", "-m", "-o", scratch / "modules.c", r"tests\modules.js"],
              cwd=ROOT)

    skipped = []
    if args.upstream:
        source = ROOT / "upstream/quickjs"
        for name in ("test_closure", "test_language", "test_builtin", "test_loop", "test_bigint",
                     "test_cyclic_import", "test_worker", "test_std", "test_rw_handler", "test_intl"):
            if os.name == "nt" and name == "test_std":
                skipped.append("upstream/test_std: requires Unix /bin/sh, true and cat; run in WSL")
                print("SKIP " + skipped[-1], flush=True)
                continue
            flags = ["--std"] if name == "test_builtin" else ["--experimental"] if name == "test_intl" else []
            fixture = Path(f"tests/{name}.js")
            if name == "test_std":
                # The Node entry contract canonicalizes ESM filenames. Preserve
                # upstream's formatting checks, adapting only its two literal
                # relative stack filenames in a generated fixture copy.
                original = (source / fixture).read_text(encoding="utf-8")
                expected = "(tests/test_std.js)"
                if original.count(expected) != 2:
                    raise ValueError("Upstream stack fixture changed; review entry adaptation")
                fixture = scratch / "upstream-test_std.js"
                fixture.write_text(original.replace(expected, "(" + fixture.as_posix() + ")"), encoding="utf-8")
            check("upstream/" + name, [qjs, *flags, fixture], cwd=source, timeout=120)

    failed = sum(not result["passed"] for result in results)
    report = dict(platform=platform.platform(), host=host, python=sys.version.split()[0], build_profile=settings.profile,
                  qjs=str(qjs), qjs_sha256=hashlib.sha256(qjs.read_bytes()).hexdigest(),
                  quickjs_commit=settings.data["quickjs"]["commit"], cosmopolitan=settings.data["cosmopolitan"],
                  passed=len(results) - failed, failed=failed, skipped=skipped, results=results)
    reports = settings.reports
    reports.mkdir(parents=True, exist_ok=True)
    report_path = reports / (system + ".json")
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\n{report['passed']}/{len(results)} passed, {len(skipped)} skipped; report: {report_path}", flush=True)
    return bool(failed)


if __name__ == "__main__":
    sys.exit(main())
