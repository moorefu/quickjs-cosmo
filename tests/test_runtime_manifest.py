"""SDK transport must reject unbuilt runtime sources and incomplete headers."""
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import ci_artifact


class RuntimeManifestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for name in ("compat", "native", "scripts", "dist", "patches"):
            (self.root / name).mkdir()
        self.compat = {"ref": "toolchain-pin"}
        self.data = {"quickjs": {"commit": "quickjs-pin"}, "cosmopolitan": {"commit": "toolchain-pin"}}
        (self.root / "compat/versions.json").write_text(json.dumps(self.compat))
        names = ("native/module_registry.c", "native/module_registry.h", "native/versions.json",
                 "native/build-inputs.json", *ci_artifact.runtime_source_names(self.root))
        for name in names:
            (self.root / name).parent.mkdir(parents=True,exist_ok=True)
            (self.root / name).write_text("original")
        self.manifest = dict(self.data, compatibility=self.compat, patches={}, files={},
                             compatibility_sources={"compat/versions.json": ci_artifact.sha256(self.root / "compat/versions.json")},
                             runtime_sources={name: ci_artifact.sha256(self.root / name) for name in names})
        self.settings = SimpleNamespace(root=self.root, dist=self.root / "dist", data=self.data)

    def write_manifest(self):
        (self.root / "dist/manifest.json").write_text(json.dumps(self.manifest))

    def test_source_changed_after_build_is_rejected(self):
        self.write_manifest()
        (self.root / "native/module_registry.c").write_text("modified")
        with self.assertRaisesRegex(ValueError, "runtime sources"):
            ci_artifact.verify_dist(self.settings)

    def test_runtime_provenance_is_required(self):
        del self.manifest["runtime_sources"]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "runtime sources"):
            ci_artifact.verify_dist(self.settings)

    def test_new_javascript_source_after_build_is_rejected(self):
        self.write_manifest()
        source = self.root / "src/js/node/buffer.js"
        source.parent.mkdir(parents=True)
        source.write_text("modified")
        with self.assertRaisesRegex(ValueError, "runtime sources"):
            ci_artifact.verify_dist(self.settings)

    def test_native_build_lock_changed_after_build_is_rejected(self):
        self.write_manifest()
        (self.root / "native/build-inputs.json").write_text("changed source selection")
        with self.assertRaisesRegex(ValueError, "runtime sources"):
            ci_artifact.verify_dist(self.settings)

    def test_missing_public_registry_header_rejects_sdk(self):
        required = {"qjs.exe", "qjsc.exe", "run-test262.exe", "libquickjs.a", ".aarch64/libquickjs.a",
                    "quickjs.h", "quickjs-libc.h", "ape-x86_64.elf", "ape-aarch64.elf", "qjs", "qjsc",
                    "run-test262", "versions.json", "QUICKJS-LICENSE", "NODE-MODULES-LICENSE", "NATIVE-MODULES-LICENSES",
                    "node-compat.d.ts", "fs.d.ts", "cosmo.d.ts"}
        self.manifest["files"] = {name: {} for name in required}
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "Incomplete SDK"):
            ci_artifact.verify_dist(self.settings)


if __name__ == "__main__":
    unittest.main()
