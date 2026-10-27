#!/usr/bin/env python3
"""Run same-source ESM fixtures against pinned Node and the local APE.

--reference-only records Node observations; it never reports qjs compatibility.
Default mode compares only fixtures explicitly promoted to differential status.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

from host_runtime import ape_command, host_info, normalize_arch, node_oracle_key
from node_contract import ROOT, checked_file, load_contract, read_json, validate

PREFIX = "NODE_COMPAT_RESULT "
OUTPUT_LIMIT = 1024 * 1024


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_report(path, report):
    # ECMAScript strings can contain unpaired UTF-16 surrogates. Escape those
    # code units in JSON rather than failing or replacing them during UTF-8 I/O.
    path.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def run_command(command, cwd, timeout=30, output_limit=OUTPUT_LIMIT):
    """Bound time and combined output without buffering arbitrary output in RAM."""
    start = time.monotonic()
    environment = dict(os.environ, TZ="UTC", LC_ALL="C", NO_COLOR="1")
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(list(map(str, command)), cwd=cwd, env=environment,
                                   stdout=stdout, stderr=stderr)
        failure = None
        try:
            while process.poll() is None:
                size = os.fstat(stdout.fileno()).st_size + os.fstat(stderr.fileno()).st_size
                if size > output_limit:
                    failure = "output_limit"
                    break
                if time.monotonic() - start >= timeout:
                    failure = "timeout"
                    break
                time.sleep(0.01)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
        size = os.fstat(stdout.fileno()).st_size + os.fstat(stderr.fileno()).st_size
        if size > output_limit:
            failure = "output_limit"
        stdout.seek(0)
        stderr.seek(0)
        return dict(exit_code=process.returncode, failure=failure,
                    stdout=stdout.read(output_limit).decode("utf-8", errors="replace"),
                    stderr=stderr.read(output_limit).decode("utf-8", errors="replace"),
                    seconds=round(time.monotonic() - start, 3))


def result_value(result):
    if result["failure"]:
        raise ValueError(result["failure"])
    if result["exit_code"] != 0:
        raise ValueError("nonzero_exit: " + str(result["exit_code"]))
    records = [line[len(PREFIX):] for line in result["stdout"].splitlines() if line.startswith(PREFIX)]
    if len(records) != 1:
        raise ValueError("expected exactly one structured result, got " + str(len(records)))
    def reject_constant(value):
        raise ValueError("Non-JSON number: " + value)
    return json.loads(records[0], parse_constant=reject_constant)


def node_identity(node, cwd, baseline):
    script = "console.log(JSON.stringify({version:process.version,versions:process.versions,platform:process.platform,arch:process.arch,execPath:process.execPath}))"
    result = run_command([node, "--input-type=module", "-e", script], cwd)
    if result["failure"] or result["exit_code"]:
        raise ValueError("Cannot execute Node baseline: " + result["stderr"])
    identity = json.loads(result["stdout"])
    if identity["version"] != baseline["version"]:
        raise ValueError(f"Node version mismatch: expected {baseline['version']}, got {identity['version']}")
    host = host_info()
    if identity["platform"] != host["platform"] or normalize_arch(identity["arch"]) != host["execution_arch"]:
        raise ValueError("Node must match the APE platform and execution architecture")
    identity["sha256"] = sha256(identity["execPath"])
    identity["verification"] = verify_node(node, baseline)
    return identity


def verify_node(node, baseline, root=ROOT):
    """Verify the oracle against the locked official executable/archive."""
    host = host_info()
    record = baseline["artifacts"][node_oracle_key(host)]
    if record["file"].endswith(".exe"):
        expected = record["sha256"]
    else:
        archive = root / ".cache/node-baseline" / record["file"].replace("/", "-")
        if not archive.is_file() or sha256(archive) != record["sha256"]:
            raise ValueError("Missing or invalid Node oracle archive; run scripts/prepare_native.py --node")
        member_name = record["file"].split(".tar.")[0] + "/" + record["executable"]
        with tarfile.open(archive, "r:*") as bundle:
            members = [m for m in bundle.getmembers() if m.name == member_name]
            if len(members) != 1 or not members[0].isfile():
                raise ValueError("Invalid Node oracle executable entry")
            digest = hashlib.sha256()
            with bundle.extractfile(members[0]) as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(block)
            expected = digest.hexdigest()
    if sha256(node) != expected:
        raise ValueError("Node oracle executable does not match the pinned official input")
    return dict(artifact=record["file"], artifact_sha256=record["sha256"], executable_sha256=expected)


def compare_case(case, node, qjs, scratch, reference_only=False):
    fixture = checked_file(ROOT, case["file"])
    result = dict(id=case["id"], file=case["file"], mode="reference" if reference_only else "differential")
    try:
        result["node"] = run_command([node, fixture], scratch, case["timeout_seconds"])
        reference = result_value(result["node"])
        result["reference"] = reference
        if reference_only:
            result["passed"] = True
        else:
            result["qjs"] = run_command(ape_command(qjs, ["-m", fixture], ROOT / "dist"),
                                        scratch, case["timeout_seconds"])
            actual = result_value(result["qjs"])
            result["actual"] = actual
            # Serialized comparison keeps JS booleans distinct from numbers.
            result["passed"] = json.dumps(actual, sort_keys=True) == json.dumps(reference, sort_keys=True)
            if not result["passed"]:
                result["error"] = "structured_result_mismatch"
    except (ValueError, OSError) as error:
        result.update(passed=False, error=str(error))
    return result


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node", help="Pinned Node executable (default: node from PATH)")
    parser.add_argument("--qjs", type=Path, default=ROOT / "dist/qjs.exe")
    parser.add_argument("--reference-only", action="store_true")
    parser.add_argument("--check-contract", action="store_true", help="Validate inventory without executing runtimes")
    parser.add_argument("--case", action="append", default=[], help="Select a fixture ID; repeatable")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        inventory = load_contract()
        counts = validate(inventory)
        if args.check_contract:
            print("PASS node-contract " + json.dumps(counts))
            return 0
        host = host_info()
        local = ROOT / "toolchains" / ("node-v24.21.0-" + node_oracle_key(host)) / (
            "node.exe" if host["platform"] == "win32" else "bin/node")
        node = args.node or (str(local) if local.is_file() else shutil.which("node"))
        if not node:
            raise ValueError("Pinned Node not found; pass --node or run scripts/prepare_native.py --node")
        node = Path(node).resolve()
        baseline = read_json(ROOT / inventory["node_baseline"])
        identity = node_identity(node, ROOT, baseline)
        known = {case["id"]: case for case in inventory["tests"]}
        if any(identifier not in known for identifier in args.case):
            raise ValueError("Unknown test ID")
        candidates = [known[i] for i in args.case] if args.case else list(known.values())
        allowed = {"reference", "differential"} if args.reference_only else {"differential"}
        if args.case and any(case["status"] not in allowed for case in candidates):
            raise ValueError("Selected test is not runnable in this mode; use --reference-only for Node observations")
        cases = [case for case in candidates if case["status"] in allowed]
        if not cases:
            raise ValueError("No runnable tests selected")
        qjs = args.qjs.resolve()
        if not args.reference_only and not qjs.is_file():
            raise ValueError("Missing qjs executable: " + str(qjs))
    except (OSError, KeyError, ValueError) as error:
        parser.error(str(error))
    results = []
    for case in cases:
        with tempfile.TemporaryDirectory(prefix="node-contract-", dir=ROOT / "build") as directory:
            result = compare_case(case, node, qjs, directory, args.reference_only)
        results.append(result)
        print(("PASS " if result["passed"] else "FAIL ") + case["id"] + " " + result["mode"], flush=True)
        if not result["passed"]:
            print(json.dumps(result, ensure_ascii=True), flush=True)
    failed = sum(not r["passed"] for r in results)
    report = dict(format=1, mode="reference_only" if args.reference_only else "differential",
                  host=host_info(), node=identity, inventory_sha256=sha256(ROOT / "compat/node-api.json"),
                  node_baseline_sha256=sha256(ROOT / inventory["node_baseline"]),
                  native_lock_sha256=sha256(ROOT / inventory["native_lock"]),
                  entry_contract_sha256=sha256(ROOT / inventory["entry_contract"]),
                  fixture_sha256={p.relative_to(ROOT).as_posix(): sha256(p)
                                  for p in sorted((ROOT / "tests/node").rglob("*.mjs"))},
                  input_versions=read_json(ROOT / "versions.json"),
                  qjs=None if args.reference_only else dict(path=str(qjs), sha256=sha256(qjs)),
                  api_inventory=counts, passed=len(results) - failed, failed=failed,
                  pending_tests=[t["id"] for t in inventory["tests"] if t["id"] not in {c["id"] for c in cases}],
                  results=results)
    name = ("reference-" if args.reference_only else "") + host_info()["system"] + ".json"
    path = args.report or ROOT / "build/node-compat" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    write_report(path, report)
    label = "Node reference only" if args.reference_only else "Node/qjs differential"
    print(f"{label}: {report['passed']}/{len(results)} passed; report: {path}")
    return int(bool(failed))


if __name__ == "__main__":
    (ROOT / "build").mkdir(exist_ok=True)
    sys.exit(main())
