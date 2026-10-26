# QuickJS + 固定版 Nightly cosmocc

用锁定的 [Nightly cosmocc #802](https://github.com/jart/cosmopolitan/actions/runs/40271229025) 编译 [bellard/quickjs](https://github.com/bellard/quickjs) 的固定提交，生成同时包含 **x86_64 与 ARM64** 代码的 Actually Portable Executable（APE）。

QuickJS 固定为提交 [`1ec58aaa769a992213ec2b871b0228074169904b`](https://github.com/bellard/quickjs/commit/1ec58aaa769a992213ec2b871b0228074169904b)（提交时间：北京时间 2026-10-26 23:00:14），cosmocc 固定为提交 `aefad27c09ffda64c6ac64bd69f758e9f9c7b91d` 的 Nightly #802。完整版本、下载地址和 SHA-256 统一记录在 `versions.json`；构建不会追随 master 或后续 Nightly 自动更新。上游 `VERSION` 为 `2026-06-04`，用于官方格式的发布包命名。

## 直接运行

构建产物位于 `dist/`：

- `qjs.exe`：解释器，支持 REPL、`std`、`os`、Worker、BigInt；通过 `--experimental` 启用 Temporal/Intl。
- `qjsc.exe`：把 JS 编译为 C 字节码数组或独立 APE 程序。
- `run-test262.exe`：上游 Test262 测试工具；完整 Test262 数据集需另外获取。
- `libquickjs.a`、`.aarch64/libquickjs.a`、头文件：两种架构的嵌入开发文件；请保留目录结构。
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

默认构建直接使用该快照，保留四项 QuickJS 补丁、运行时兼容修复、Temporal/Intl、`-O2` 和双架构 APE。

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

`bootstrap.py` 下载官方源码与固定版本工具链，先验证 SHA-256，再保留执行权限和符号链接解包。`upstream/` 中的源码保持原样；构建副本应用 `patches/` 下的四个兼容补丁，使用自带的 `CONFIG_COSMO=y`，保留 Temporal/Intl。补丁修正运行时 `os.platform`、Windows `poll` 句柄边界、异步唤醒器索引、入口模块路径和进程调用。

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
| `tests/runtime_process.js` | 阻塞/异步进程、WNOHANG、原生退出码、PATH、工作目录、环境变量、标准流重定向、APE 调用链；由 Python 驱动并严格断言结果 |

还运行上游语言、内建对象、循环、BigInt、循环模块、Worker、I/O 回调、Intl 等测试。Windows 下仅跳过依赖 Unix `/bin/sh`、`true`、`cat` 的上游 `test_std.js`，该测试在 WSL 内运行；自编的跨平台文件 I/O 测试在两端运行。

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

## Windows 进程行为

Windows 使用 `posix_spawn` 启动子进程，避免 Windows `fork/exec` 故障；系统无法返回描述符上限时使用有限回退值。启动失败会抛出异常，等待失败只对 `EINTR` 重试；Windows 不支持的 `uid/gid` 参数明确报错。显式跟踪 `options.env` 数组的所有权，继承环境通过 `NULL` 交给运行时处理，避免 `posix_spawn` 更新 `environ` 后 QuickJS 误释放或使用旧数组。

向原生 Windows 程序传递环境时，清除 `_COSMO_FDS`、`_COSMO_FDS_V2`、`_MASK` 三个内部变量，保留其他用户变量。直接启动 APE 时保留句柄协议；接收旧协议时保护当前进程的标准句柄。原生程序使用文件重定向时，提供同步文件句柄。

信号文件改放到用户临时目录下的 `quickjs-cosmo-sig/`，目录不可用时报告错误并退出，避免无限重试；这套 Nightly 信号文件命名空间与未修补的官方运行时不同。

Windows 上返回**原始退出码**：`std.exit(7)` 为 `7`，语法错误/未处理异常为 `1`。阻塞 `os.exec` 和异步 `os.waitpid` 的状态均保留完整 unsigned DWORD，包括 `0xC0000005`、`0xC0000142`。Unix 保留 POSIX 语义：阻塞 `os.exec` 返回逻辑退出码，`os.waitpid` 返回 wait status（例如退出 `7` 对应 `1792`）。

## 兼容范围与验证边界

[固定工具链的文档](https://github.com/jart/cosmopolitan/blob/aefad27c09ffda64c6ac64bd69f758e9f9c7b91d/tool/cosmocc/README.md)声明支持 Linux、macOS、Windows、FreeBSD、OpenBSD 7.3、NetBSD，覆盖 x86_64 / AArch64。具体系统与架构的可用组合及版本限制以官方说明为准；这不包括浏览器、Android/iOS 或任意 32 位系统。

本机验证范围和结果记录在 `VALIDATION.md`。不能把生成了双架构 APE 等同于已在所有系统上实测。部分 Linux 的 binfmt_misc/Wine 配置会误识别 APE；可先尝试 `sh ./dist/qjs.exe examples/hello.js`，参阅[官方故障说明](https://github.com/jart/cosmopolitan/blob/aefad27c09ffda64c6ac64bd69f758e9f9c7b91d/tool/cosmocc/README.md#gotchas)。macOS 可能需要按系统规则处理下载文件的隔离属性，Apple Silicon 的默认启动过程可能需要系统 C 编译器来准备 APE loader。

QuickJS 不提供 Node.js 的 `fs`、`process`、npm 模块系统或浏览器 DOM。这里的运行时 API 是 QuickJS 的 `std`/`os`。原生动态模块通常与操作系统和架构相关，不属于这里的跨平台交付范围。QuickJS 和 Cosmopolitan 的许可证保留在上游源码及工具链内，产物中的 Cosmopolitan 许可声明由官方工具链嵌入。

Windows 的原始退出码约定是本项目的兼容修正，与未经修补的 4.0.2 的 `status << 8` 编码不同。测试严格核对返回值，非零错误仍视为失败。
