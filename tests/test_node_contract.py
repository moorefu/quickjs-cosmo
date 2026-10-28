"""Regression guards for the compatibility gate, not for future Node methods."""
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import node_contract
import host_runtime
import prepare_native
import test_node_compat as runner


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.inventory = node_contract.load_contract()

    def test_bare_os_alias_is_reserved_for_quickjs(self):
        self.inventory["modules"][0]["aliases"].append("os")
        with self.assertRaisesRegex(ValueError, "Conflicting module"):
            node_contract.validate(self.inventory)

    def test_no_retired_namespace_alias(self):
        self.inventory["modules"][0]["aliases"].append("@runtime/crypto")
        with self.assertRaisesRegex(ValueError, "Conflicting module"):
            node_contract.validate(self.inventory)

    def test_aliases_cannot_create_duplicate_module_identity(self):
        self.inventory["modules"][1]["aliases"].append("buffer")
        with self.assertRaisesRegex(ValueError, "Conflicting module"):
            node_contract.validate(self.inventory)

    def test_reference_only_case_cannot_back_support_claim(self):
        entry = self.inventory["modules"][0]["entries"][0]
        entry["status"] = "supported"
        self.inventory["tests"][0]["status"] = "reference"
        entry["tests"] = [self.inventory["tests"][0]["id"]]
        with self.assertRaisesRegex(ValueError, "differential tests"):
            node_contract.validate(self.inventory)

    def test_project_runtime_fixture_cannot_back_node_api_claim(self):
        entry = self.inventory["modules"][0]["entries"][0]
        entry["status"] = "partial"
        entry["tests"] = ["MOD-001"]
        entry["evidence"] = ["project-only fixture"]
        with self.assertRaisesRegex(ValueError, "differential tests"):
            node_contract.validate(self.inventory)

    def test_per_platform_support_also_needs_evidence(self):
        entry = self.inventory["modules"][0]["entries"][0]
        entry["support"] = copy.deepcopy(self.inventory["support_defaults"])
        entry["support"]["win32"]["qjs"] = "partial"
        entry["tests"] = ["LANG-001"]
        entry.pop("evidence", None)
        with self.assertRaisesRegex(ValueError, "requires evidence"):
            node_contract.validate(self.inventory)

    def test_nonexistent_test_and_task_are_rejected(self):
        entry = self.inventory["modules"][0]["entries"][0]
        entry["tests"] = ["MISSING-001"]
        with self.assertRaisesRegex(ValueError, "unknown tests"):
            node_contract.validate(self.inventory)
        entry["task"] = "M0-99"
        with self.assertRaisesRegex(ValueError, "Incomplete API"):
            node_contract.validate(self.inventory)

    def test_fixture_path_cannot_escape_workspace(self):
        self.inventory["tests"][0]["file"] = "../escape.mjs"
        with self.assertRaisesRegex(ValueError, "Invalid contract path"):
            node_contract.validate(self.inventory)

    def test_global_support_cannot_use_only_project_runtime_checks(self):
        entry=self.inventory['globals'][0];entry['tests']=['FETCH-004']
        with self.assertRaisesRegex(ValueError,'same-source differential'):
            node_contract.validate(self.inventory)

    def test_global_reference_observation_cannot_back_support_claim(self):
        next(t for t in self.inventory['tests'] if t['id']=='FETCH-001')['status']='reference'
        with self.assertRaisesRegex(ValueError,'differential tests'):
            node_contract.validate(self.inventory)

    def test_duplicate_global_names_are_rejected(self):
        self.inventory['globals'].append(copy.deepcopy(self.inventory['globals'][0]))
        with self.assertRaisesRegex(ValueError,'duplicate API'):
            node_contract.validate(self.inventory)


class ResultProtocolTests(unittest.TestCase):
    def result(self, stdout, code=0, failure=None):
        return dict(stdout=stdout, exit_code=code, failure=failure, stderr="")

    def test_report_preserves_unpaired_utf16_from_js(self):
        value = runner.result_value(self.result('NODE_COMPAT_RESULT {"text":"\\ud800"}\n'))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            runner.write_report(path, value)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"text": "\ud800"})

    def test_false_success_marker_cannot_hide_nonzero_exit(self):
        with self.assertRaisesRegex(ValueError, "nonzero_exit"):
            runner.result_value(self.result('NODE_COMPAT_RESULT {"ok":true}\n', 1))

    def test_zero_exit_without_result_is_failure(self):
        with self.assertRaisesRegex(ValueError, "exactly one"):
            runner.result_value(self.result("PASS\n"))

    def test_duplicate_result_and_non_json_numbers_are_rejected(self):
        with self.assertRaises(ValueError):
            runner.result_value(self.result("NODE_COMPAT_RESULT 1\nNODE_COMPAT_RESULT 1\n"))
        with self.assertRaisesRegex(ValueError, "Non-JSON"):
            runner.result_value(self.result("NODE_COMPAT_RESULT NaN\n"))

    def test_report_does_not_conflate_true_and_one(self):
        case = dict(id="LANG-001", file="tests/node/esm.mjs", timeout_seconds=1)
        node = self.result("NODE_COMPAT_RESULT true\n")
        qjs = self.result("NODE_COMPAT_RESULT 1\n")
        with mock.patch.object(runner, "run_command", side_effect=[node, qjs]), \
             mock.patch.object(runner, "ape_command", return_value=["qjs"]):
            result = runner.compare_case(case, "node", ROOT / "dist/qjs.exe", ROOT)
        self.assertFalse(result["passed"])
        self.assertEqual(result["error"], "structured_result_mismatch")

    def test_reference_mode_never_executes_or_records_qjs(self):
        case = dict(id="BUF-001", file="tests/node/buffer.mjs", timeout_seconds=1)
        with mock.patch.object(runner, "run_command", return_value=self.result("NODE_COMPAT_RESULT {}\n")) as execute:
            result = runner.compare_case(case, "node", None, ROOT, reference_only=True)
        self.assertEqual(execute.call_count, 1)
        self.assertNotIn("qjs", result)
        self.assertEqual(result["mode"], "reference")

    def test_console_output_is_checked_beyond_result_marker(self):
        case = dict(id="CON-001", file="tests/node/console.mjs", timeout_seconds=1, compare_output=True)
        node = self.result("expected\nNODE_COMPAT_RESULT {}\n")
        qjs = self.result("wrong\nNODE_COMPAT_RESULT {}\n")
        with mock.patch.object(runner, "run_command", side_effect=[node, qjs]), \
             mock.patch.object(runner, "ape_command", return_value=["qjs"]):
            result = runner.compare_case(case, "node", ROOT / "dist/qjs.exe", ROOT)
        self.assertFalse(result["passed"])
        self.assertEqual(result["error"], "output_mismatch")

    def test_wrong_node_version_is_rejected_before_tests(self):
        result = self.result(json.dumps(dict(version="v22.0.0")))
        with mock.patch.object(runner, "run_command", return_value=result):
            with self.assertRaisesRegex(ValueError, "version mismatch"):
                runner.node_identity("node", ROOT, dict(version="v24.21.0"))


class ProcessBudgetTests(unittest.TestCase):
    def test_timeout_terminates_test(self):
        result = runner.run_command([sys.executable, "-c", "import time; time.sleep(10)"], ROOT, timeout=0.1)
        self.assertEqual(result["failure"], "timeout")

    def test_output_budget_includes_stderr(self):
        result = runner.run_command([sys.executable, "-c", "import sys; sys.stderr.write('x'*10000)"],
                                    ROOT, output_limit=128)
        self.assertEqual(result["failure"], "output_limit")
        self.assertLessEqual(len(result["stderr"]), 128)


class NativeInputTests(unittest.TestCase):
    def test_prepared_source_rechecks_files_beyond_anchor_headers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "native").mkdir()
            (root / ".cache").mkdir()
            commit = "a" * 40
            archive = root / ".cache/source.tar.gz"
            with tarfile.open(archive, "w:gz") as bundle:
                for name in ("libc/anchor.h", "libc/candidate.c"):
                    data = b"original"
                    entry = tarfile.TarInfo("cosmopolitan-" + commit + "/" + name)
                    entry.size = len(data)
                    bundle.addfile(entry, io.BytesIO(data))
            lock = dict(cosmopolitan=dict(commit=commit, archive=archive.name,
                        url="https://example.test/source", sha256=prepare_native.sha256(archive)),
                        libraries=[dict(files=[dict(path="libc/anchor.h", sha256=hashlib.sha256(b"original").hexdigest())])])
            (root / "native/versions.json").write_text(json.dumps(lock))
            (root / "versions.json").write_text(json.dumps(dict(cosmopolitan=dict(commit=commit))))
            source = prepare_native.prepare_source(root, offline=True)
            (source / "libc/candidate.c").write_bytes(b"modified after preparation")
            with self.assertRaisesRegex(ValueError, "source changed"):
                prepare_native.prepare_source(root, offline=True)

    def test_node_oracle_rejects_same_version_but_untrusted_binary(self):
        with tempfile.TemporaryDirectory() as directory:
            node = Path(directory) / "node.exe"
            node.write_bytes(b"not the official executable")
            baseline = dict(artifacts={"win32-x64":dict(file="win-x64/node.exe", sha256="0" * 64)})
            with mock.patch.object(runner, "host_info", return_value=dict(platform="win32", python_arch="x86_64", execution_arch="x86_64")):
                with self.assertRaisesRegex(ValueError, "pinned official"):
                    runner.verify_node(node, baseline)

    def test_offline_corrupt_input_is_not_used(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "archive"
            path.write_bytes(b"corrupt")
            with self.assertRaisesRegex(ValueError, "invalid cached"):
                prepare_native.fetch("https://example.test/input", path, "0" * 64, True)
            self.assertEqual(path.read_bytes(), b"corrupt")

    def test_archive_rejects_parent_and_windows_paths(self):
        for path in ("cosmo/../escape", "/cosmo/file", "cosmo/C:/file", "cosmo/a\\b"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                prepare_native.source_name(path, "cosmo")

    def test_selected_archive_link_is_rejected(self):
        entry = tarfile.TarInfo("cosmo/bin/node")
        entry.type = tarfile.SYMTYPE
        entry.linkname = "../../../outside"
        with self.assertRaisesRegex(ValueError, "regular file"):
            prepare_native.write_member(None, entry, Path("unused"))

    def test_source_commit_must_match_toolchain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "native").mkdir()
            (root / "native/versions.json").write_text(json.dumps(dict(cosmopolitan=dict(commit="other"))))
            (root / "versions.json").write_text(json.dumps(dict(cosmopolitan=dict(commit="toolchain"))))
            with self.assertRaisesRegex(ValueError, "must match"):
                prepare_native.prepare_source(root, offline=True)


class OracleArchitectureTests(unittest.TestCase):
    def test_native_arm_python_on_windows_still_selects_x64_node(self):
        info = dict(platform="win32", host_arch="arm64", python_arch="arm64", execution_arch="x86_64")
        self.assertEqual(host_runtime.node_oracle_key(info), "win32-x64")

    def test_linux_arm_selects_native_arm_node(self):
        info = dict(platform="linux", host_arch="arm64", python_arch="arm64", execution_arch="arm64")
        self.assertEqual(host_runtime.node_oracle_key(info), "linux-arm64")

    def test_installer_uses_ape_architecture_for_destination(self):
        with mock.patch.object(prepare_native, "node_oracle_key", return_value="win32-x64"):
            self.assertEqual(prepare_native.node_destination(Path("project")),
                             Path("project/toolchains/node-v24.21.0-win32-x64"))

    def test_reference_accepts_x64_node_with_native_arm_python(self):
        info = dict(platform="win32", host_arch="arm64", python_arch="arm64", execution_arch="x86_64")
        observation = dict(version="v24.21.0", platform="win32", arch="x64", execPath="node.exe")
        with mock.patch.object(runner, "host_info", return_value=info), \
             mock.patch.object(runner, "run_command", return_value=dict(failure=None, exit_code=0, stdout=json.dumps(observation))), \
             mock.patch.object(runner, "sha256", return_value="verified"), \
             mock.patch.object(runner, "verify_node", return_value={"verified": True}):
            result = runner.node_identity("node.exe", ROOT, dict(version="v24.21.0"))
        self.assertEqual(result["arch"], "x64")


if __name__ == "__main__":
    unittest.main()
