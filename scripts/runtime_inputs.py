"""The source inventory used both when building and accepting runtime artifacts."""


def runtime_source_names(root):
    names = {"scripts/generate_runtime_config.py", "scripts/embed_js.py", "scripts/runtime_inputs.py",
             "scripts/build_native.py", "scripts/prepare_native.py", "scripts/probe_native.py",
             "scripts/probe_backends.py", "scripts/native_provenance.py"}
    for folder, suffixes in (("native", {".c", ".h", ".json"}), ("src/js", {".js", ".mjs"}), ("types", {".ts"})):
        names.update(path.relative_to(root).as_posix() for path in (root / folder).rglob("*")
                     if path.is_file() and (path.suffix in suffixes or path.name == "LICENSE"))
    return sorted(names)
