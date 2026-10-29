# Deployment regression contract

This extends [the implementation plan](ISSUES_1_4_PLAN.md) for issue #3. Keep QuickJS `1ec58aaa769a992213ec2b871b0228074169904b` and Cosmopolitan Nightly 802 `aefad27c09ffda64c6ac64bd69f758e9f9c7b91d` locked. A source patch alone is insufficient evidence that a precompiled driver, loader or linker contains the change.

## DEPLOY-01: toolchain closure

Verify the original archive and the installed compiler drivers, wrappers, headers, both libcosmo archives, CRT objects, loaders and apelink against that archive. Record each component's identity and role. Build any necessary 64K overrides from the same source lock in a separate directory, with exact patch/command/input/output fingerprints. Retain the original installation. Subsequent compilation, qjsc, SDK metadata and artifact validation must select the reviewed overrides consistently; a missing or stale override is an error.

The initial Nightly ARM64 loader has 0x4000 LOAD alignment and a segment whose virtual/file offsets differ by 0x4000. The ARM64 cosmocc link flags also select 16384-byte pages. Acceptance requires actual layout inspection, including the loaders embedded in fat programs.

## DEPLOY-02: entry and immutable payloads

Exercise source, qjsc, Worker and hand-linked SDK entries, nested APE execution, custom argv[0], installation paths and cache reuse. Distinguish the real executable from a loader and a caller-supplied argv[0]. Compare native file identities where applicable. Run explicit-loader/no-binfmt, disposable assimilated copies and available binfmt deployment paths. Never assimilate a release master.

Before and after execution and packaging, verify master qjs/qjsc/test programs, both SDK archives, source locks, headers, loaders and the three-file release ZIP. Retain the identity ledger with each host's report.

## DEPLOY-03: arguments, handles and environment

Use the locked native Node executable as an independent native-process oracle. Test native-to-APE and APE-to-native launches, synchronous/asynchronous Node processes, legacy os.exec, inherited disk descriptors and shared cursors. Verify read/write offsets after child exit and failure paths. Round-trip empty strings, whitespace, backslashes, quotes, Unicode and trailing backslashes through both native and APE children. Reserved temporary fd protocols must not leak into application environments or mutate the parent environment.

## DEPLOY-04: Windows paths and security

Extend the existing realpath/Hidden/temp tests with drive roots, case, slash forms, junctions/symlinks and real UNC/extended UNC fixtures. An unavailable share cannot count as UNC coverage. Controlled fixtures must stay in the workspace and be removed after use.

Provide executable Low/Medium/High integrity and scheduled-task acceptance. Prepare appropriately labeled temporary directories rather than weakening system directories. Report the integrity actually exercised. Distinguish missing paths, denied access, unsupported operations, unobservable processes and confirmed exits. A failed process query must not imply that a known live target exited. Retain native and legacy PID identities and the evidence used for classification.

## DEPLOY-05: real 64K-page ARM64

Use checksum-locked official ARM64 kernel inputs and full-system QEMU. Record the actual kernel release, ARM64 architecture and kernel-provided AT_PAGESZ=65536; user-mode QEMU and fabricated getconf results are insufficient. Inspect ELF/PE/fat machine types, loader identities, modern APE flags and 64K virtual/file offset congruence.

Run the loader, bare ELF and fat entries, compiled and SDK programs, nested execution and immutable-file checks in that kernel. Test no-binfmt and binfmt where the controlled kernel supports it. Missing required inputs, layouts or runtime evidence must fail acceptance.

## DEPLOY-06: capabilities and release gate

Generate per-host, per-layer capability results for /dev/zero, FIFO, CPU counts, signals, TTY, device files and permissions. Keep implemented behavior, ENOSYS, host restrictions and permission failures distinct. Reuse [real terminal evidence](TERMINAL_CONTRACT.md). Stabilize unref observations with bounded independent child/lifetime observations, preserving failures.

Require seven matching native-host records, the 64K kernel record and the CI gate on the committed payload. User scripts and documentation must describe commands, required privileges, result classifications and material deployment limits. Do not close #3 until that evidence succeeds.

## Implemented mechanisms

`prepare_toolchain.py` creates a separate `*-runtime64k` installation from the verified ZIP. Its ledger records every original/installed file or symlink, component roles, commands and source/patch fingerprints. It rebuilds the ARM64 loader and apelink, selects 65536-byte ARM64 link pages, and preserves the ELF boot headers' modern APE flags. The original archive/installation remain available. Precompiled compiler executables retain their original build-host page requirements; 64K acceptance concerns runtime/compiler outputs and SDK programs.

The pinned x86 `tlsasm.S` getters replaced MOV instructions but changed arithmetic flags. A compiler-inserted TLS getter between `test` and `jcc` could reverse a Worker initialization branch. The reviewed overlay preserves flags with `pushfq`/`popfq`, in both derived x86 libcosmo archives and the SDK. Thirty independent CF/PF/AF/ZF/SF/OF vectors cover all fifteen getters; the original toolchain is the failing negative control. Logging or delays cannot supply the fix.

The shared Unix exec overlay resolves the current Linux interpreter before vfork, checks its identity against the payload, and tries it with literal argv[0] before installed/cache fallback. Node and legacy exec share that overlay. Linux enforces execute permission and avoids WSL's PE handler. Native Node invokes the reviewed ELF loader on Linux and the isolated extracted Mach-O loader on macOS; direct MZ execution by an unrelated native program remains subject to host binfmt/shell configuration.

Each deployment entry runs 261 argument strings through native/APE children and sync/async/legacy launches, eight inherited-disk shared-cursor cases (including nonblocking legacy waitpid), native-to-APE execution, Worker/nested identity and native PID comparisons. Legacy Windows command generation flushes/doubles pending backslashes before a literal quote; its existing drive-path conversion remains separate from the Node producer. Installed copies use Unicode/space paths. Unix shell entry extracts/reuses an isolated loader cache; only disposable copies are assimilated. Payloads, SDK archives, locks and existing release ZIPs are hashed before/after.

Fresh APE fd records restore the original overlapped handles and shared cursor mappings, even when early Windows startup has replaced standard handles. Invalid and pseudo handles are ignored. Startup removes the protocol from both libc and Win32 environment tables. Native children instead receive synchronous handles grouped by their original shared cursor; libc harvest synchronizes their offsets and releases retained handles/cursors before reporting the logical child as exited. Node supervision retains its existing native-PID contract.

Capability records keep native libc, Node/Worker results and host CPU observations distinct, using the native runtime's errno constants. A native `/dev/zero` shim does not imply Windows Node fs implements that path. FIFO/CPU failures retain their actual unsupported/permission/error classifications.

## Reproduce acceptance

After the normal build and compiled test suite:

```sh
python3 scripts/test_deployment.py --qjs dist/qjs.exe \
  --compiled build/test-linux/deployment-standalone.exe \
  --sdk build/test-linux/deployment-sdk.exe
python3 scripts/test_kernel64k.py --offline
```

Kernel acceptance needs full-system `qemu-system-aarch64` and cached Ubuntu kernel packages; omit `--offline` to fetch the locked inputs. It constructs a freestanding PID 1/initramfs and requires raw auxv, `uname`, all eight entry cases and guest/host immutable hashes. The disposable guest installs its matching loader and binfmt module/registration; host binfmt is untouched. Kernel package identities came from the [signed Ubuntu noble index](https://ports.ubuntu.com/ubuntu-ports/dists/noble/Release), verified with archive key `F6ECB3762474EDA9D21B7022871920D1991BC93C`. Syscall numbers follow [Linux v6.8's ARM64 generic table](https://github.com/torvalds/linux/blob/v6.8/include/uapi/asm-generic/unistd.h).

On native Windows, use the same transported build:

```powershell
python scripts/test_windows_deployment.py --qjs dist/qjs.exe `
  --compiled build/test-linux/deployment-standalone.exe `
  --sdk build/test-linux/deployment-sdk.exe `
  --fs-compiled build/test-linux/host-filesystem-standalone.exe `
  --fs-sdk build/test-linux/host-filesystem-sdk.exe
./scripts/test-deployment-task.ps1
```

Low/Medium/High use restricted versions of the caller's own token and verify its actual integrity SID. Only disposable temp subtrees receive Low labels. An owned, retained live process denies query access: restricted observers must report permission-denied, never exited. No elevation or privilege grants occur. Interactive users may lack High/token-launch/share rights; those remain explicit restrictions. The release gate requires actual coverage on all Windows CI hosts. [CreateProcessAsUser requirements](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw) explain the launch boundary.

UNC acceptance creates a unique current-user-only loopback SMB share, removes it, and restores a service started on the disposable CI host. `--unc-root \\server\existing-share` instead creates/removes only a unique child in an existing writable share. Missing shares cannot count as coverage. The task wrapper runs a hidden, limited interactive-token task, unregisters only its task, and retains logs under `build/quickjs-cosmo-acceptance-*`. Use an elevated console for High/share coverage; run the task wrapper or direct command under a restricted account to inspect that context's actual limits. PTY/ConPTY and redirected-pipe/log acceptance remain in `test_terminal.py`.

Records live in `build/deployment/<host>/`, `build/kernel64k/` and `build/terminal/<host>/`. CI aggregates exactly seven native-host attestations plus the separate kernel attestation. Missing, stale, restricted or failed required coverage cannot produce a release.
