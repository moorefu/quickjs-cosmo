# Issues #1–#4 implementation and acceptance

Scope comes from the four GitHub issues read on 2026-10-29. Preserve the fixed QuickJS/Cosmopolitan inputs and the existing ESM/Node compatibility contract. Each issue gets a reproducer, maintained implementation, regression evidence, commit/push, and successful seven-platform CI gate before the next issue starts.

## Order and deliverables

1. **#1 — Windows filesystem and startup.** Recheck current HEAD rather than the historical release. Share Windows realpath resolution with legacy os APIs while retaining their slash-path result convention. Fix dotfile creation and existing Hidden/System truncation attributes in the pinned open backend. Extend and validate signal paths across creation, fork cleanup and exit; reject invalid/unwritable temp roots and bound retries. Verify paths using native file identity, not string agreement. Exercise source, Worker, qjsc and SDK; preserve logical PID directory conventions.
2. **#2 — QJB v1.** Freeze format/resolver/budget rules before implementation. Add an independent, bounded ZIP snapshot/index with STORE/DEFLATE, CRC/size/range validation and explicit ZIP64/encryption/symlink rejection. Integrate --bundle, canonical qjb module identities, ESM/script entry modes, dynamic import, TLA, argv/import.meta, cosmo:bundle resources and Worker ownership. Provide a qjs-hosted deterministic packer. Test independent ZIP interoperability, corruption/quotas, source removal and the same packages across all CI hosts.
3. **#4 — Terminal interfaces.** Pair raw enable/restore, including nested use and runtime teardown; retain legacy os APIs. Add declared node:tty and readline/readline/promises subsets, process TTY methods/sizes and bounded resize notifications. Exercise actual Unix PTYs and Windows ConPTY plus pipe fallback. Cover keys, resize, Ctrl-C, exception/exit cleanup, and source/qjsc/SDK entries; retain input/output traces.
4. **#3 — Integration and deployment regressions.** Consolidate loader/argv/PID, handles/protocol environment, filesystem/temp, terminal and toolchain identity contracts. Add static fat/ELF/PE and 64K alignment checks plus an actual 64K-page kernel run. Produce machine-readable deployment/capability results, distinguish permissions/unsupported/unavailable/exited states, and verify unchanged payload/library/archive hashes after execution.

## Evidence and completion

Required regression check names belong in compat/release-checks.json; new transport programs/packages belong in scripts/ci_artifact.py. Update API inventories, types, source/patch hashes and licenses when applicable. Preserve the runtime's three-file release ZIP. Kernel/page-size and PTY/ConPTY requirements require real execution evidence; unsupported or unavailable fixtures cannot be reported as successful tests.

Link each completed issue to its committed change and exact successful workflow run. Keep deferred subrequirements visible until verified; do not close an issue based solely on a build or documentation.
