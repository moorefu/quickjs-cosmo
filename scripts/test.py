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
    check("custom/unknown-builtin", [qjs, "-m", ROOT / "tests/fixtures/unknown-builtin.mjs"],
          expected=1, contains="Unknown builtin module: node:fs")
    check("qjsc/unknown-builtin", [qjsc, "-c", "-m", "-o", scratch / "unknown-builtin.c",
          ROOT / "tests/fixtures/unknown-builtin.mjs"], expected=1, contains="Unknown builtin module: node:fs")
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
        if check("sdk/compile-registry", [settings.toolchain / "bin/cosmocc", "-O2", "-I" + str(settings.dist),
                 ROOT / "tests/native/module_registry.c", settings.dist / "libquickjs.a",
                 "-Wl,--wrap=_Exit,-u,__wrap__Exit", "-lm", "-lpthread", "-ldl", "-o", scratch / "registry-sdk.exe"],
                 timeout=180):
            check("sdk/run-registry", [scratch / "registry-sdk.exe"], contains="PASS module-registry-sdk")
    if args.standalone:
        check("qjsc/cross-host-ape", [args.standalone.resolve()], contains="Hello from QuickJS")
        check("qjsc/cross-host-registry", [args.standalone.resolve().parent / "registry-standalone.exe"],
              contains="PASS runtime-modules")
        check("sdk/cross-host-registry", [args.standalone.resolve().parent / "registry-sdk.exe"],
              contains="PASS module-registry-sdk")
        check("qjsc/cross-host-buffer", [args.standalone.resolve().parent / "buffer-standalone.exe"],
              contains="PASS runtime-buffer")
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
            check("upstream/" + name, [qjs, *flags, Path(f"tests/{name}.js")], cwd=source, timeout=120)

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
