# QuickJS + 固定版 Nightly cosmocc

用锁定的 [Nightly cosmocc #802](https://github.com/jart/cosmopolitan/actions/runs/40271229025) 编译 [bellard/quickjs](https://github.com/bellard/quickjs) 的固定提交，生成同时包含 **x86_64 与 ARM64** 代码的 Actually Portable Executable（APE）。

QuickJS 固定为提交 [`1ec58aaa769a992213ec2b871b0228074169904b`](https://github.com/bellard/quickjs/commit/1ec58aaa769a992213ec2b871b0228074169904b)（提交时间：北京时间 2026-10-26 23:00:14），cosmocc 固定为提交 `aefad27c09ffda64c6ac64bd69f758e9f9c7b91d` 的 Nightly #802。完整版本、下载地址和 SHA-256 统一记录在 `versions.json`；构建不会追随 master 或后续 Nightly 自动更新。上游 `VERSION` 为 `2026-06-04`，用于官方格式的发布包命名。

Node 风格运行时扩展的模块命名、目标范围、算法来源、实施任务与验收标准见 [实施规划](docs/NODE_COMPAT_RUNTIME_PLAN.md)。已交付范围与后续任务以[实施状态](docs/RUNTIME_IMPLEMENTATION_STATUS.md)及机器接口清单为准。

已完成 [M0 验收基础](docs/M0_FOUNDATION.md)、[M1-01 模块注册](docs/M1_MODULE_REGISTRY.md)，并实现 [M1-02 Buffer/编码](docs/M1_BUFFER_ENCODING.md)：`node:buffer`、全局 Buffer、TextEncoder/TextDecoder 共享同一份内嵌实现，覆盖 qjs、qjsc、Worker 和嵌入 SDK。当前新增 [M1-03 公共基础](docs/M1_FOUNDATION.md)：process/path/os、EventEmitter、util/assert 和 console 的初始子集。并提供 [M1-04 调度合同](docs/M1_SCHEDULING.md)：定时器、Promise 定时器、nextTick/queueMicrotask 和取消信号。完整范围、差异与逐项 CI 门禁见[实施状态](docs/RUNTIME_IMPLEMENTATION_STATUS.md)。

## 直接运行

构建产物位于 `dist/`：

- `qjs.exe`：解释器，支持 REPL、`std`/`qjs:std`、`os`/`qjs:os`、`cosmo:runtime`、`node:buffer`、process/path/os、EventEmitter、util/assert、console、定时器/微任务与取消信号、Buffer 与编码全局、Worker、BigInt；通过 `--experimental` 启用 Temporal/Intl。
- `qjsc.exe`：把 JS 编译为 C 字节码数组或独立 APE 程序。
- `run-test262.exe`：上游 Test262 测试工具；完整 Test262 数据集需另外获取。
- `libquickjs.a`、`.aarch64/libquickjs.a`、头文件：两种架构的嵌入开发文件；请保留目录结构。
- `node-compat.d.ts`、`cosmo.d.ts`：已实现的模块类型子集。
- `qjs`、`qjsc`、`run-test262` 与两个小型 APE loader：Unix 启动入口，确保 WSL 使用 Linux 运行方式。
- `manifest.json`：产物大小、SHA-256、构建版本和补丁信息。

Windows PowerShell，在项目目录运行：

```powershell
.\dist\qjs.exe .\examples\hello.js
.\dist\qjs.exe -m .\examples\system-info.js hello
.\dist\qjs.exe --experimental -m .\tests\experimental.js
.\dist\qjs.exe -i
```

Linux / WSL / macOS / BSD：

```sh
./dist/qjs examples/hello.js
./dist/qjs -m examples/system-info.js hello
./dist/qjs --experimental -m tests/experimental.js
```

`.exe` 后缀在 Unix 上不影响运行。Unix 入口会启动同目录的 `.exe` APE；Windows 直接启动 `.exe`。无需为 Windows、Linux 分别编译。

## 官方格式的发布包

```powershell
python scripts/package.py
```

生成 `releases/quickjs-cosmo-2026-06-04.zip` 及外置 SHA-256 校验文件。文件名中的日期取自 QuickJS `VERSION`，遵循[官方二进制发布包](https://bellard.org/quickjs/binary_releases/quickjs-cosmo-2026-06-04.zip)的命名方式；本包仍由上述 master 提交和本项目兼容补丁自行构建。

tag 构建改用发布版本号：例如 `v2026-06-04.1` 生成 `quickjs-cosmo-2026-06-04.1.zip`。GitHub Actions 自动识别当前 tag；本地可执行 `python scripts/package.py --tag v2026-06-04.1`。这不改变固定的 QuickJS 源码提交或引擎 VERSION。

ZIP 根目录只有三个文件，与官方包相同，无外层目录：

```text
readme.txt
run-test262
qjs
```

`readme.txt` 保留上游 `readme-cosmo.txt`，末尾追加 QuickJS、cosmocc 的固定提交标识；其余两个文件为不带扩展名的 APE 二进制。Windows 下可将 `qjs`、`run-test262` 重命名为 `qjs.exe`、`run-test262.exe` 运行。源码、构建脚本、自编测试、验证报告和 `qjsc` 等开发文件保留在项目中，不加入这个精简发布包。WSL 若把无扩展名的 APE 交给 Windows 启动，可使用项目里的 loader，例如 `dist/ape-x86_64.elf <解压目录>/qjs examples/hello.js`。

## 固定的工具链与构建路径

`versions.json` 锁定[官方 Nightly #802](https://github.com/jart/cosmopolitan/actions/runs/40271229025)，提交 `aefad27c09ffda64c6ac64bd69f758e9f9c7b91d`（2026-10-26），artifact ID `12629850103`。工具链 ZIP 的 SHA-256 为：

```text
7f8a0bfd991401e027f794d516bf52a5184b5089e5dd1a50cf9e9ade54b5bb06
```

默认构建直接使用该快照，应用项目 QuickJS 补丁与运行时兼容修复，保留 Temporal/Intl、`-O2` 和双架构 APE。

| 内容 | 路径 |
| --- | --- |
| 工具链 | `toolchains/cosmocc-nightly-2026-10-26-aefad27c09ff/` |
| 构建文件 | `build/quickjs-nightly/` |
| 可执行文件与清单 | `dist/` |
| 验证报告 | `build/test-results/` |
| 官方格式的发布包 | `releases/quickjs-cosmo-2026-06-04.zip` |

在其他机器上，从上述 Actions run 下载 `cosmocc` artifact，保存为 `.cache/cosmocc-nightly-2026-10-26.zip`；也可在已登录 GitHub CLI 的环境运行构建，由 bootstrap 下载锁定的 artifact。Windows PowerShell 7+ 可运行 `./scripts/fetch-toolchain.ps1`，校验缓存或通过已认证的 `gh` 下载。解压时会恢复 Actions ZIP 丢失的执行权限。

旧命令中的 `--nightly` / `-Nightly` 参数仍可使用，效果与默认命令相同。

## Windows 上使用现有 WSL

此机器已安装 **Ubuntu-22.04 / WSL2**。开始菜单的 WSL 快捷方式默认进入 Linux 用户主目录；项目在 Linux 中对应 `/mnt/d/Workspace/dairn/quickjs-cosmo`。

```powershell
# 列出发行版并进入 Ubuntu
wsl --list --verbose
wsl -d Ubuntu-22.04 --cd /mnt/d/Workspace/dairn/quickjs-cosmo
```

也可以从 Windows 直接构建：

```powershell
.\scripts\build.ps1
# 官方依赖已在 .cache/ 时，不访问网络
.\scripts\build.ps1 -Offline
```

脚本只使用项目内的 `toolchains/`、`upstream/`、`build/`、`dist/`，不需要管理员安装，不会修改系统的编译器或 WSL 配置。另一个发行版可通过 `-Distro <名称>` 选择。

## 在 Unix / WSL 中重新构建

需要 Python 3.9+、GNU Make、patch、curl，以及 POSIX shell。Linux 构建不需要预先安装系统级 APE loader。

```sh
sh scripts/build.sh
# 离线、4 个并行任务（默认值）
JOBS=4 sh scripts/build.sh --offline
```

`bootstrap.py` 下载官方源码与固定版本工具链，先验证 SHA-256，再保留执行权限和符号链接解包。`upstream/` 中的源码保持原样；构建副本应用 `patches/` 下的兼容补丁，使用自带的 `CONFIG_COSMO=y`，保留 Temporal/Intl。补丁修正运行时 `os.platform`、Windows `poll` 句柄边界、异步唤醒器索引、入口模块路径和进程调用，并接入统一模块注册层。

`prepare_compat.py` 另外获取所选工具链**同一版本**的少量 Cosmopolitan 源文件，按 `compat/versions.json` 验证原始文件、补丁及修改后文件的 SHA-256，再将修复对象链接到程序和开发库中。没有新增第三方库，也不修改工具链归档。离线构建还需预先缓存这些文件到 `.cache/cosmo-compat/nightly/`，目录结构按锁文件中的 `path` 保留。

Cosmopolitan 原文件的许可头保留在构建源文件中。QuickJS、Cosmopolitan 的上游许可随源码与工具链保留。

Linux 构建会用官方 `assimilate` 将项目内的构建工具转换为本机 ELF，避免 WSL 把工具误交给 Windows 启动；原始 ZIP 缓存和最终双架构 APE 均保留。整个过程不修改系统 binfmt_misc 配置。

下载缓存可通过 `.cache/cosmocc-nightly-2026-10-26.zip`、`.cache/quickjs-source.tar.gz` 预先提供；缓存内容仍须通过锁文件校验。工具链缓存也可用 `scripts/fetch-toolchain.ps1` 校验。WSL 内可按实际网络配置设置 `HTTPS_PROXY`，再运行构建。

## 测试

Windows 原生测试使用 Windows 的 Python，直接启动同一份 `dist/qjs.exe`：

```powershell
python scripts/test.py --upstream
```

WSL / Linux 测试，同时验证 `qjsc` 编译独立程序：

```sh
PATH="$PWD/toolchains/cosmocc-nightly-2026-10-26-aefad27c09ff/bin:$PATH" python3 scripts/test.py --upstream --compile
```

也可在 PowerShell 直接调用：

```powershell
wsl -d Ubuntu-22.04 --cd /mnt/d/Workspace/dairn/quickjs-cosmo --exec /bin/sh -c 'PATH="$PWD/toolchains/cosmocc-nightly-2026-10-26-aefad27c09ff/bin:$PATH" python3 scripts/test.py --upstream --compile'
```

每个用例独立进程、有超时限制，并检查退出码；自编 JS 用例还要求输出成功标记。报告保存到 `build/test-results/windows.json` 和 `build/test-results/linux.json`。

| 脚本 | 测试内容 |
| --- | --- |
| `tests/language.js` | 私有字段、BigInt、TypedArray、DataView、Unicode、正则、生成器、Proxy、异常 |
| `tests/modules.js` | ES 模块、动态 import、JSON 模块、顶层 await |
| `tests/async.js` | Promise、异步迭代器 `return()` 等待、定时器与取消 |
| `tests/io.js` | Unicode 路径、UTF-8、读写、stat、readdir、rename、错误码和清理 |
| `tests/io-events.js` | 100 对管道、读写回调、完整消息传输、超时检测 |
| `tests/worker.js` | Worker 消息、BigInt/TypedArray 传递、SharedArrayBuffer、Atomics |
| `tests/experimental.js` | Intl 数字/日期/复数、Temporal 日期/时长/时间戳 |
| `tests/platform.js` | 同一个二进制返回实际运行系统 |
| `tests/runtime_modules.mjs` | 模块别名身份、具名导出、路径归一化、未知内建错误与 Worker 注册 |
| `tests/runtime_buffer.mjs`、`tests/node/buffer*.mjs`、`tests/node/text-encoding.mjs` | Buffer 视图/复制、编码、整数/浮点、搜索与全局编码；同源 Node 差分及 qjsc 独立程序 |
| `tests/runtime_metadata_oom.mjs` | 元数据分配失败后的异常与恢复 |
| `tests/native/module_registry.c` | SDK 多 runtime/context 生命周期、Unix/Windows 路径与模块导入 |
| `tests/runtime_process.js` | 阻塞/异步进程、WNOHANG、原生退出码、PATH、工作目录、环境变量、标准流重定向、APE 调用链；由 Python 驱动并严格断言结果 |

还运行上游语言、内建对象、循环、BigInt、循环模块、Worker、I/O 回调、Intl 等测试。Windows 下仅跳过依赖 Unix `/bin/sh`、`true`、`cat` 的上游 `test_std.js`，该测试在 WSL 内运行；自编的跨平台文件 I/O 测试在两端运行。

## GitHub Actions CI

[构建与验证工作流](.github/workflows/build-ape.yml) 在 push、pull request 和手动运行时触发，采用[参考仓库 CI](https://github.com/moorefu/quickjs-cosmo/blob/main/.github/workflows/build-ape.yml)的单次构建、多主机验收方式，输入始终取自 `versions.json`。

构建任务在 Ubuntu x86_64 执行现有 `scripts/build.sh`、`scripts/test.py --upstream --compile --node-compat` 和 `scripts/package.py`，编译33 份独立 APE 测试程序及两份原生后端探测 APE，覆盖普通脚本、进程、模块、Buffer、公共基础、入口身份与嵌入 SDK。矩阵任务下载同一个产物，执行现有测试、上游快速测试、跨主机独立程序、进程回归和 Node 差分用例。各任务通过 `scripts/prepare_native.py --node` 准备校验过的固定 Node 测试工具；运行 qjs 本身不依赖 Node。构建机另以 `scripts/check_types.py` 调用锁定的官方 QuickJS TypeScript 5.9.3 工具进行 strict/noEmit 验收，该开发工具不进入交付包。

| Runner | 主机 | APE 执行方式 |
| --- | --- | --- |
| `ubuntu-24.04` | Linux x86_64 | x86_64 ELF loader |
| `ubuntu-24.04-arm` | Linux ARM64 | AArch64 ELF loader |
| `macos-15-intel` | macOS Intel | APE shell 入口 |
| `macos-15` | macOS ARM64 | APE shell 入口 |
| `windows-2022` | Windows x64 | x64 PE |
| `windows-2025` | Windows x64 | x64 PE |
| `windows-11-arm` | Windows ARM64 | 系统的 x64 兼容层；PE 入口为 x64 |

Runner 标签对应 [GitHub 官方支持列表](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)。测试报告分别记录主机架构、Python 架构和启动策略选择的执行架构。Windows ARM 项会检查实际宿主为 ARM64，单独标明 APE 的 x64 兼容运行。

`scripts/ci_artifact.py` 打包、恢复并校验 SDK、源码归档、33 份独立程序、两份原生探测程序及其构建记录和官方格式发布 ZIP。传输使用 tar 保留执行权限与 `.aarch64` 目录；下载端先验证固定输入、完整文件清单与 SHA-256，再执行测试。矩阵用 `bootstrap.py --source-only --offline` 恢复上游测试源码，无需下载 cosmocc；macOS 的 APE 启动过程可使用 runner 预装的系统 C 编译器。Linux 构建任务包含编译步骤，各矩阵项还运行 API 清单与 Node 差分验收；Windows 保留一个 Unix 专用用例的跳过记录，实际用例数量以报告为准。

每个任务保存主测试报告和进程汇总报告，产物名称为 `reports-*`。仅汇总报告会被上传，临时用例配置保留在任务工作目录。全部矩阵通过后，`CI gate` 保存 `quickjs-cosmo-release` Actions 产物，包含 ZIP、外置 SHA-256 与构建清单。构建或任一矩阵项失败、取消或跳过时，门禁不能成功；可将 `CI gate` 设为分支的必需检查。

推送 `v` 开头的版本 tag 时，同一工作流会在 `CI gate` 成功后执行 `Publish tagged release`，以完整 tag 作为 GitHub Release 的版本和标题。例如首个版本 `v2026-06-04.1`；后续可递增末尾编号。普通分支和 PR 运行只保存 Actions 产物。

发布附件为 `quickjs-cosmo-2026-06-04.1.zip`、对应的 `.sha256` 和 `manifest.json`。ZIP 文件名使用去掉前导 `v` 的 tag 版本号，内部三文件布局保持不变。CI 传输清单同时绑定发布 tag、版本和文件名，各矩阵项校验它们与当前 ref 一致。发布脚本 `scripts/publish_release.py` 先建立草稿，上传后核对 GitHub 返回的附件 SHA-256，并再次确认 tag 指向本次 CI 的提交，然后公开发布。重跑相同版本时，匹配的已发布附件直接复用；不同内容的已发布版本会被拒绝覆盖。本工作流创建的未完成草稿可以继续上传、校验和发布。

```sh
git tag -a v2026-06-04.1 -m "Release v2026-06-04.1"
git push origin main refs/tags/v2026-06-04.1
```

发布任务单独使用 `contents: write` 权限，其余构建和验证任务保持只读。本地可在 `package.py --tag v2026-06-04.1`、`ci_artifact.py pack --tag v2026-06-04.1` 之后，用 `python scripts/publish_release.py --tag v2026-06-04.1 --dry-run` 校验附件并预览发布说明。

若原有 tag 的构建和完整矩阵已通过、但发布步骤需要修复，可在默认分支运行 `Retry verified tag release`，填写原 tag 和原 `Build and verify APE` 的 run ID。重试入口核对 tag 的提交、工作流来源和成功的 CI gate，再下载原始产物；仅发布工具采用当前工作流提交的版本。它保留 tag 和已经测试的二进制，仍核对全部附件摘要，拒绝覆盖内容不同的已发布版本。草稿通过包含草稿的发布列表查找，随后按 release ID 校验。

工具链缓存只保存原始归档及已校验的兼容源码，不缓存改成 ELF 的构建工具。默认通过任务的 `GITHUB_TOKEN` 下载固定的上游 Nightly artifact；如需其他凭据，可设置仓库 secret `COSMOCC_ARTIFACT_TOKEN`。Actions artifact 有保留期限，归档不可用时可把相同 ZIP 放入 HTTPS 镜像，并设置仓库变量 `COSMOCC_ARCHIVE_URL`；镜像仍须匹配锁文件的 SHA-256，不能替换为其他 Nightly。

可在本机演练产物传递：

```sh
# 先执行构建、--compile 测试和 package.py
python3 scripts/ci_artifact.py pack
python3 scripts/ci_artifact.py verify
# 在干净的 checkout 中，放入 build/ci/ 下的 tar.gz 与其 .sha256
python3 scripts/ci_artifact.py unpack
python3 scripts/bootstrap.py --source-only --offline
python3 scripts/test.py --upstream --standalone build/test-linux/hello-standalone.exe
```

CI 辅助与合同门禁测试使用 `python -m unittest discover -s tests -p 'test_*.py' -v`，覆盖主机选择、ARM Windows 的架构区分、传输损坏、目录越界、重复文件、符号链接、镜像版本，以及 Node 基线、差分结果与原生输入校验。

## 将 JS 编译为独立程序

WSL / Linux 中：

```sh
export PATH="$PWD/toolchains/cosmocc-nightly-2026-10-26-aefad27c09ff/bin:$PATH"
./dist/qjsc -o build/hello.exe examples/hello.js
./dist/ape-x86_64.elf build/hello.exe # ARM64 使用 ape-aarch64.elf
```

生成的 `build/hello.exe` 同样包含两种架构，复制到 Windows 可直接启动。仅输出 C 文件无需安装编译器：

```powershell
.\dist\qjsc.exe -c -o build\hello.c examples\hello.js
```

`qjsc` 的独立程序输出仍需 `cosmocc` 工具链、旁边的头文件和两种架构的静态库。

`qjsc` 会自动为独立程序链接兼容对象。手动使用本项目 `libquickjs.a` 嵌入 QuickJS 时，还需传入链接参数 `-Wl,--wrap=_Exit,-u,__wrap__Exit`，使 Windows 的退出和进程修复同样生效。

嵌入时保留 SDK 的 `qjs-cosmo.h`，每个新 context 调用一次 `js_cosmo_init_modules(ctx)`，并在 runtime 上安装 `js_cosmo_module_normalize`。Worker 的 context 工厂也采用同样初始化步骤。完整调用方式见 [M1 实施记录](docs/M1_MODULE_REGISTRY.md)与 [SDK 测试](tests/native/module_registry.c)。

## Windows 进程行为

Windows 使用 `posix_spawn` 启动子进程，避免 Windows `fork/exec` 故障；系统无法返回描述符上限时使用有限回退值。启动失败会抛出异常，等待失败只对 `EINTR` 重试；Windows 不支持的 `uid/gid` 参数明确报错。显式跟踪 `options.env` 数组的所有权，继承环境通过 `NULL` 交给运行时处理，避免 `posix_spawn` 更新 `environ` 后 QuickJS 误释放或使用旧数组。

向原生 Windows 程序传递环境时，清除 `_COSMO_FDS`、`_COSMO_FDS_V2`、`_MASK` 三个内部变量，保留其他用户变量。直接启动 APE 时保留句柄协议；接收旧协议时保护当前进程的标准句柄。原生程序使用文件重定向时，提供同步文件句柄。

信号文件改放到用户临时目录下的 `quickjs-cosmo-sig/`，目录不可用时报告错误并退出，避免无限重试；这套 Nightly 信号文件命名空间与未修补的官方运行时不同。

Windows 上返回**原始退出码**：`std.exit(7)` 为 `7`，语法错误/未处理异常为 `1`。阻塞 `os.exec` 和异步 `os.waitpid` 的状态均保留完整 unsigned DWORD，包括 `0xC0000005`、`0xC0000142`。Unix 保留 POSIX 语义：阻塞 `os.exec` 返回逻辑退出码，`os.waitpid` 返回 wait status（例如退出 `7` 对应 `1792`）。

## 兼容范围与验证边界

[固定工具链的文档](https://github.com/jart/cosmopolitan/blob/aefad27c09ffda64c6ac64bd69f758e9f9c7b91d/tool/cosmocc/README.md)声明支持 Linux、macOS、Windows、FreeBSD、OpenBSD 7.3、NetBSD，覆盖 x86_64 / AArch64。具体系统与架构的可用组合及版本限制以官方说明为准；这不包括浏览器、Android/iOS 或任意 32 位系统。

本机验证范围和结果记录在 `VALIDATION.md`。不能把生成了双架构 APE 等同于已在所有系统上实测。部分 Linux 的 binfmt_misc/Wine 配置会误识别 APE；可先尝试 `sh ./dist/qjs.exe examples/hello.js`，参阅[官方故障说明](https://github.com/jart/cosmopolitan/blob/aefad27c09ffda64c6ac64bd69f758e9f9c7b91d/tool/cosmocc/README.md#gotchas)。macOS 可能需要按系统规则处理下载文件的隔离属性，Apple Silicon 的默认启动过程可能需要系统 C 编译器来准备 APE loader。

当前产物提供已声明的 Node 基础、同步/异步文件、子进程、流、摘要/KDF、密钥/AEAD、压缩、[DNS/TCP/URL 子集](docs/M5_NETWORK.md)与 [TLS1.2 客户端](docs/M5_TLS_CLIENT.md)。HTTP/Fetch、npm 模块系统和完整浏览器 DOM 仍按规划推进。运行时 API 同时保留 QuickJS 的 `std`/`os` 及项目元数据模块 `cosmo:runtime`。原生动态模块通常与操作系统和架构相关，不属于这里的跨平台交付范围。QuickJS 和 Cosmopolitan 的许可证保留在上游源码及工具链内，产物中的 Cosmopolitan 许可声明由官方工具链嵌入。

Windows 的原始退出码约定是本项目的兼容修正，与未经修补的 4.0.2 的 `status << 8` 编码不同。测试严格核对返回值，非零错误仍视为失败。

原生算法构建范围、双架构来源锁和 E1/E2 探测见 [M2-01 实施记录](docs/M2_NATIVE_BUILD.md)。构建生成的候选档案保留在 build/native/backends；尚未作为 SDK 通用库导出。CI 同时保留完整原生许可及各平台探测报告。

同步 node:fs 已接入文件/目录/描述符与 Stats/Dirent，支持范围、原生路径适配和 SDK 故障注入见 [M2-02 实施记录](docs/M2_FS.md)。异步 fs/promises 和文件流分别留在 M3-02/M3-05。

同步 node:crypto 提供七种摘要、真实增量复制、HMAC/KDF、随机数和比较，cosmo:crypto 提供 BLAKE2b256；具体算法集合、SDK 内存/符号范围及后续任务见 [M2-03 实施记录](docs/M2_CRYPTO.md)。

同步 node:zlib 与 cosmo:compression 接入六种压缩格式及校验和，帧/选项合同、bzip2 工作空间适配和独立互操作见 [M2-04 实施记录](docs/M2_COMPRESSION.md)。
