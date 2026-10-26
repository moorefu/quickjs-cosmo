"""CI failures must reject mixed payloads and incorrect execution platforms."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import bootstrap
import ci_artifact
import host_runtime


class HostSelectionTests(unittest.TestCase):
    def test_linux_arm_uses_arm_loader(self):
        with tempfile.TemporaryDirectory() as directory:
            dist = Path(directory)
            loader = dist / "ape-aarch64.elf"
            loader.touch()
            self.assertEqual(host_runtime.ape_command("qjs.exe", ["test.js"], dist,
                             system="linux", arch="aarch64"), [str(loader), "qjs.exe", "test.js"])

    def test_linux_does_not_fall_back_to_wrong_cpu(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "ape-x86_64.elf").touch()
            with self.assertRaises(FileNotFoundError):
                host_runtime.ape_command("qjs.exe", [], directory, system="linux", arch="arm64")

    def test_macos_uses_shell_instead_of_linux_elf(self):
        self.assertEqual(host_runtime.ape_command("qjs.exe", ["test.js"], ".", system="darwin"),
                         ["/bin/sh", "qjs.exe", "test.js"])

    def test_windows_uses_pe_entry(self):
        self.assertEqual(host_runtime.ape_command("qjs.exe", ["test.js"], ".", system="windows"),
                         ["qjs.exe", "test.js"])

    def test_arm_windows_reports_emulation_separately(self):
        with mock.patch.object(host_runtime.platform, "system", return_value="Windows"), \
             mock.patch.object(host_runtime, "windows_arches", return_value=("arm64", "x86_64")):
            info = host_runtime.host_info()
        host_runtime.check_host(info, "win32", "arm64", "x86_64")
        self.assertEqual(info["python_arch"], "x86_64")
        with self.assertRaises(ValueError):
            host_runtime.check_host(info, "win32", "arm64", "arm64")

    def test_wrong_os_fails_before_acceptance(self):
        with self.assertRaises(ValueError):
            host_runtime.check_host(dict(platform="linux"), expected_platform="darwin")


class BundleTransportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.settings = SimpleNamespace(root=self.root, data=dict(
            quickjs=dict(version="2026-06-04", commit="quickjs-pin"),
            cosmopolitan=dict(commit="cosmocc-pin")))
        self.archive = self.root / "bundle.tar.gz"

    def create_bundle(self, files=None, *, corrupt=None, extra=None, symlink=False, versions=None):
        files = files or {"dist/qjs.exe": b"payload"}
        records = {name: dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
                   for name, data in files.items()}
        metadata = json.dumps(dict(format=1, versions=versions or self.settings.data, files=records)).encode()
        members = [(ci_artifact.MANIFEST, metadata), *files.items()]
        if extra:
            members.append(extra)
        with tarfile.open(self.archive, "w:gz") as bundle:
            for name, data in members:
                info = tarfile.TarInfo(name)
                data = b"corrupt" if name == corrupt else data
                info.size = len(data)
                info.mode = 0o755
                bundle.addfile(info, io.BytesIO(data))
            if symlink:
                info = tarfile.TarInfo("dist/symlink")
                info.type, info.linkname = tarfile.SYMTYPE, "../README.md"
                bundle.addfile(info)
        checksum = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.archive.with_suffix(".gz.sha256").write_text(f"{checksum}  {self.archive.name}\n")

    def test_restore_preserves_executable_mode(self):
        self.create_bundle()
        with mock.patch.object(ci_artifact, "verify") as verify:
            ci_artifact.unpack(self.settings, self.archive)
        verify.assert_called_once_with(self.settings)
        target = self.root / "dist/qjs.exe"
        self.assertEqual(target.read_bytes(), b"payload")
        if os.name == "posix":
            self.assertEqual(target.stat().st_mode & 0o777, 0o755)

    def test_corruption_is_rejected_before_any_overwrite(self):
        target = self.root / "dist/qjs.exe"
        target.parent.mkdir()
        target.write_bytes(b"existing")
        self.create_bundle(corrupt="dist/qjs.exe")
        with self.assertRaisesRegex(ValueError, "payload mismatch"):
            ci_artifact.unpack(self.settings, self.archive)
        self.assertEqual(target.read_bytes(), b"existing")

    def test_reject_path_traversal(self):
        self.create_bundle(files={"dist/../../outside": b"payload"})
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            ci_artifact.unpack(self.settings, self.archive)
        self.assertFalse((self.root / "dist").exists())

    def test_cannot_overwrite_checkout_scripts(self):
        self.create_bundle(files={"scripts/test.py": b"payload"})
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            ci_artifact.unpack(self.settings, self.archive)

    def test_symlink_is_rejected(self):
        self.create_bundle(symlink=True)
        with self.assertRaisesRegex(ValueError, "regular files"):
            ci_artifact.unpack(self.settings, self.archive)

    def test_duplicate_tar_entry_is_rejected(self):
        self.create_bundle(extra=("dist/qjs.exe", b"payload"))
        with self.assertRaisesRegex(ValueError, "unique"):
            ci_artifact.unpack(self.settings, self.archive)

    def test_unlisted_file_is_rejected(self):
        self.create_bundle(extra=("dist/extra.exe", b"payload"))
        with self.assertRaisesRegex(ValueError, "inventory"):
            ci_artifact.unpack(self.settings, self.archive)

    def test_different_pinned_inputs_are_rejected(self):
        self.create_bundle(versions={"quickjs": "different"})
        with self.assertRaisesRegex(ValueError, "different pinned"):
            ci_artifact.unpack(self.settings, self.archive)

    def test_transport_checksum_is_required(self):
        self.create_bundle()
        self.archive.with_suffix(".gz.sha256").write_text("invalid bundle.tar.gz\n")
        with self.assertRaisesRegex(ValueError, "checksum"):
            ci_artifact.unpack(self.settings, self.archive)


class PinnedMirrorTests(unittest.TestCase):
    def test_mirror_still_rejects_the_wrong_toolchain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = dict(url="https://official.invalid/archive.zip", artifact_id=1,
                          sha256=hashlib.sha256(b"pinned").hexdigest())
            def download(arguments, **options):
                Path(arguments[arguments.index("--output") + 1]).write_bytes(b"different build")
            extractor = mock.Mock()
            with mock.patch.object(bootstrap.subprocess, "run", side_effect=download):
                with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                    bootstrap.prepare(config, root / "archive.zip", root / "toolchain", extractor,
                                      False, "https://mirror.invalid/archive.zip")
            extractor.assert_not_called()
            self.assertFalse((root / "archive.zip").exists())

    def test_offline_never_downloads_from_mirror(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = dict(sha256="a" * 64)
            with mock.patch.object(bootstrap.subprocess, "run") as download:
                with self.assertRaisesRegex(ValueError, "cached archive"):
                    bootstrap.prepare(config, root / "archive.zip", root / "toolchain", mock.Mock(),
                                      True, "https://mirror.invalid/archive.zip")
                download.assert_not_called()

    def test_unencrypted_mirror_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = dict(sha256="a" * 64)
            with self.assertRaisesRegex(ValueError, "HTTPS"):
                bootstrap.prepare(config, root / "archive.zip", root / "toolchain", mock.Mock(),
                                  False, "http://mirror.invalid/archive.zip")


if __name__ == "__main__":
    unittest.main()
