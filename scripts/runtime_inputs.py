"""The source inventory used both when building and accepting runtime artifacts."""


def runtime_source_names(root):
    names = {"compat/host_tls.S", "compat/patches/tls-flags.patch", "tests/native/tls_flags.h", "scripts/test-deployment-task.ps1", "scripts/windows_security.py", "scripts/test_windows_deployment.py", "scripts/prepare_toolchain.py", "scripts/prepare-host.py", "scripts/bootstrap.py", "scripts/ape_layout.py", "compat/patches/apelink-64k.patch", "scripts/prepare_kernel64k.py", "scripts/test_kernel64k.py", "scripts/test_deployment.py", "tests/native/kernel64k_init.c", "tests/native/deployment.c", "tests/runtime_deployment.mjs", "tests/fixtures/deployment-worker.mjs", "tests/fixtures/deployment-child.mjs", "scripts/terminal_harness.py", "scripts/test_terminal.py", "tests/runtime_terminal.mjs", "tests/fixtures/terminal-worker.mjs", "tests/native/terminal.c", "examples/terminal.mjs", "scripts/generate_runtime_config.py", "scripts/embed_js.py", "scripts/runtime_inputs.py", "scripts/runtime_capabilities.py", "scripts/release_evidence.py", "scripts/artifact_manifest.py", "scripts/ci_artifact.py", "scripts/package.py", "scripts/check_types.py", "scripts/test_examples.py", "examples/portable-core.mjs", "examples/portable-fetch.mjs", "scripts/test_host_filesystem.py", "scripts/test_bundle.py", "tools/qjb-pack.mjs", "tests/runtime_bundle.mjs", "tests/native/bundle.c", "tests/runtime_host_filesystem.mjs", "tests/fixtures/host-filesystem-probe.mjs", "tests/fixtures/host-filesystem-worker.mjs", "tests/native/host_filesystem.c",
             "scripts/build_config.py", "scripts/build.sh", "scripts/build_crypto_extra.py",
             "scripts/build_native.py", "scripts/build_crypto.py", "scripts/build_compression.py", "scripts/prepare_native.py", "scripts/probe_native.py",
             "scripts/probe_backends.py", "scripts/native_provenance.py", "scripts/build_tls.py", "scripts/build_tls_client.py", "scripts/probe_tls.py", "scripts/build_http.py", "scripts/probe_http.py", "scripts/probe_https.py"}
    for folder, suffixes in (("native", {".c", ".h", ".json", ".pem", ".patch"}), ("src/js", {".js", ".mjs"}), ("types", {".ts"})):
        names.update(path.relative_to(root).as_posix() for path in (root / folder).rglob("*")
                     if path.is_file() and (path.suffix in suffixes or path.name == "LICENSE"))
    names.update(path.relative_to(root).as_posix() for path in (root / "tests/fixtures/qjb-app").rglob("*") if path.is_file())
    return sorted(names)
