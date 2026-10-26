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

ROOT = Path(__file__).resolve().parents[1]


def execute(command, cwd, timeout=60, loader=None):
    if platform.system() == "Linux" and str(command[0]).endswith(".exe"):
        arch = "aarch64" if platform.machine().lower() in ("aarch64", "arm64") else "x86_64"
        loader = loader or ROOT / f"dist/ape-{arch}.elf"
        if loader.exists():
            command = [loader, *command]
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
    parser.add_argument("--nightly", action="store_true")
    parser.add_argument("--qjs", type=Path)
    parser.add_argument("--qjsc", type=Path)
    parser.add_argument("--upstream", action="store_true")
    parser.add_argument("--compile", action="store_true", help="Also compile and run a standalone APE (needs cosmocc)")
    parser.add_argument("--standalone", type=Path, help="Run an existing standalone APE produced on another host")
    args = parser.parse_args()
    settings = load_config("nightly" if args.nightly else None)
    qjs = (args.qjs or settings.dist / "qjs.exe").resolve()
    qjsc = (args.qjsc or settings.dist / "qjsc.exe").resolve()
    arch = "aarch64" if platform.machine().lower() in ("aarch64", "arm64") else "x86_64"
    loader = settings.dist / f"ape-{arch}.elf"
    system = platform.system().lower()
    scratch = ROOT / "build" / ("test-" + ("nightly-" if settings.profile == "nightly" else "") + system)
    scratch.mkdir(parents=True, exist_ok=True)
    results = []

    def check(name, command, cwd=scratch, expected=0, contains=None, timeout=60):
        start = time.monotonic()
        try:
            result = execute(command, cwd, timeout, loader=loader)
            # Both locked toolchains expose POSIX wait status to native
            # Windows parents; retain the raw return code in the report.
            expected_raw = expected << 8 if os.name == "nt" else expected
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
    if args.standalone:
        check("qjsc/cross-host-ape", [args.standalone.resolve()], contains="Hello from QuickJS")
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
    report = dict(platform=platform.platform(), python=sys.version.split()[0], build_profile=settings.profile,
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
