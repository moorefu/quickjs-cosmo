# Repository Guidelines

## Project Structure & Module Organization

- `src/js/`: embedded JavaScript builtins and adapters; `native/`: C bindings and backend integrations.
- `patches/`: QuickJS patches; `compat/`: compatibility contracts, source locks, and release-check inventories.
- `tests/`: runtime scripts, `node/` differential fixtures, `native/` SDK tests, and `types/` declaration checks.
- `types/`: declarations through `node-compat.d.ts`; `examples/` and `docs/`: runnable examples and implementation records.
- `scripts/`: build, verification, packaging, and release tooling.

Treat `.cache/`, `upstream/`, `toolchains/`, `build/`, `dist/`, and `releases/` as generated or downloaded content. Keep upstream sources pristine; change patches or maintained adapters instead.

## Build, Test, and Development Commands

Run from the repository root in Linux/WSL:

```sh
sh scripts/build.sh --offline
./dist/qjs -m examples/portable-core.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/test.py --upstream --compile --node-compat
python3 scripts/check_types.py --offline
python3 scripts/package.py --validate
```

These build the SDK, run examples, check tooling/runtime/types, and package runtime, SDK, and tests separately. Select `QUICKJS_COSMO_RUNTIME_PROFILE=base` (default) or `full`; rebuild and retest after switching. Offline commands require cached inputs; omit `--offline` to bootstrap downloads. Compilation tests require the pinned cosmocc `bin/` on `PATH`; prepare the Node oracle with `python3 scripts/prepare_native.py --node`. Windows builds use `./scripts/build.ps1 -Offline`; native execution uses `dist/qjs.exe`.

## Coding Style & Naming Conventions

Preserve LF endings and surrounding formatting. Expanded Python, C, and JavaScript use four spaces. Use snake_case for Python/C helpers and Node-style camelCase for public JavaScript APIs. Prefer ESM and explicit `node:` imports; reserve `cosmo:` for extensions. Bare `os` retains QuickJS semantics. No formatter is configured; run `git diff --check`. Preserve vendor formatting and license notices.

## Testing Guidelines

Use Python `unittest`, executable JS assertions, pinned Node differential tests, native failure-injection tests, and TypeScript positive/negative checks. Name Python tests `test_*.py`; place compatibility fixtures under `tests/node/`. Cover errors, cancellation, resource cleanup, and applicable Worker/qjsc/SDK entries. Update `compat/node-api.json` for API changes, `compat/release-checks.json` for required checks, and `scripts/ci_artifact.py` for new standalone APEs. Never bypass missing evidence or unexpected skips.

## Commit & Pull Request Guidelines

Use scoped messages such as `feat(runtime): ...`, `test(tls): ...`, and `docs(runtime): ...`. PRs explain behavior, compatibility differences, and validation; link issues or plan tasks. For sequential implementation tasks, require all seven platform checks for both profiles and the CI gate before starting the next task.

## Dependency & Security Configuration

Keep versions and checksums locked. New backends require source provenance, admission tests, and license updates. Never silently substitute algorithms or weaken TLS verification. CommonJS and npm loading remain separate scope.
