# QuickJS + Cosmopolitan 4.0.2 / Nightly

用 [Cosmopolitan 4.0.2](https://github.com/jart/cosmopolitan/releases/tag/4.0.2) 编译 [bellard/quickjs master](https://github.com/bellard/quickjs)，生成同时包含 **x86_64 与 ARM64** 代码的 Actually Portable Executable（APE）。

源码锁定到 2026-10-26 获取的 master 提交 [`1ec58aaa769a992213ec2b871b0228074169904b`](https://github.com/bellard/quickjs/commit/1ec58aaa769a992213ec2b871b0228074169904b)（提交时间：北京时间 2026-10-26 23:00:14）。上游 `VERSION` 的值为 `2026-06-04`；它是版本标签，不能用来判断是否为最新主干。完整版本、下载地址和 SHA-256 记录在 `versions.json`。

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

`readme.txt` 来自上游 `readme-cosmo.txt`；其余两个文件为不带扩展名的 APE 二进制。Windows 下可将 `qjs`、`run-test262` 重命名为 `qjs.exe`、`run-test262.exe` 运行。源码、构建脚本、自编测试、验证报告和 `qjsc` 等开发文件保留在项目中，不加入这个精简发布包。WSL 若把无扩展名的 APE 交给 Windows 启动，可使用项目里的 loader，例如 `dist/ape-x86_64.elf <解压目录>/qjs examples/hello.js`。

## 使用 Nightly cosmocc

`versions-nightly.json` 锁定[官方 Nightly #802](https://github.com/jart/cosmopolitan/actions/runs/40271229025)，提交 `aefad27c09ffda64c6ac64bd69f758e9f9c7b91d`（2026-10-26），artifact ID `12629850103`。下载的工具链 ZIP 必须匹配官方 SHA-256：

```text
7f8a0bfd991401e027f794d516bf52a5184b5089e5dd1a50cf9e9ade54b5bb06
```

Nightly 使用相同的 QuickJS 提交和三项兼容补丁，保留 Temporal/Intl、`-O2` 和双架构 APE。工具链、对象文件、产物、报告和发布包分开存放，默认构建仍为 4.0.2。

Windows PowerShell：

```powershell
.\scripts\build.ps1 -Nightly -Offline
.\dist\nightly\qjs.exe .\examples\hello.js
python scripts/test.py --nightly --upstream
python scripts/package.py --nightly
```

WSL / Linux：

```sh
sh scripts/build.sh --nightly --offline
./dist/nightly/qjs examples/hello.js
PATH="$PWD/toolchains/cosmocc-nightly-2026-10-26-aefad27c09ff/bin:$PATH" \
    python3 scripts/test.py --nightly --upstream --compile
python3 scripts/package.py --nightly
```

| 内容 | Nightly 路径 |
| --- | --- |
| 工具链 | `toolchains/cosmocc-nightly-2026-10-26-aefad27c09ff/` |
| 构建文件 | `build/quickjs-nightly/` |
| 可执行文件与清单 | `dist/nightly/` |
| 验证报告 | `build/test-results/nightly/` |
| 官方格式的发布包 | `releases/nightly/quickjs-cosmo-2026-06-04.zip` |

在其他机器上，可从上述 Actions run 下载 `cosmocc` artifact，保存为 `.cache/cosmocc-nightly-2026-10-26.zip`；也可在已登录 GitHub CLI 的环境去掉 `--offline`，由 bootstrap 使用 `gh api` 获取锁定的 artifact。解压时会恢复 Actions ZIP 丢失的执行权限。Nightly 是锁定的构建快照，后续运行不会自动切换到另一晚的工具链。

Nightly 调整了 Windows 命令行路径处理，入口路径如 `tests\modules.js` 需要由 QuickJS 自行规范化。第三项补丁修复了这种路径下的相对模块导入、Worker 和 `qjsc -m`；脚本其余参数保持原样。Windows 测试额外覆盖这三种行为。

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

`bootstrap.py` 下载官方源码与固定版本工具链，先验证 SHA-256，再保留执行权限和符号链接解包。`upstream/` 中的源码保持原样；构建副本应用 `patches/` 下的三个兼容补丁，使用自带的 `CONFIG_COSMO=y`，并保留默认的实验性 Temporal/Intl 支持。补丁修正运行时 `os.platform`、4.0.2 Windows `poll` 的 64 句柄边界问题、QuickJS 异步唤醒器的 poll 数组索引，以及 Windows 入口文件路径的模块解析。

Linux 构建会用官方 `assimilate` 将项目内的构建工具转换为本机 ELF，避免 WSL 把工具误交给 Windows 启动；原始 ZIP 缓存和最终双架构 APE 均保留。整个过程不修改系统 binfmt_misc 配置。

Windows 上若系统已设置本地 HTTP 代理，而命令行没有继承代理，可先在 **PowerShell 7+** 中用以下脚本下载约 442 MB 的官方工具链。它读取 Windows 现有代理设置并进行分段下载；不会新建或改变代理配置。

```powershell
.\scripts\fetch-toolchain.ps1
.\scripts\build.ps1
```

WSL 内也可按实际网络配置设置 `HTTPS_PROXY`，再运行构建。下载缓存可通过 `.cache/cosmocc-4.0.2.zip`、`.cache/quickjs-source.tar.gz` 预先提供；缓存内容仍须通过锁文件校验。

## 测试

Windows 原生测试使用 Windows 的 Python，直接启动同一份 `dist/qjs.exe`：

```powershell
python scripts/test.py --upstream
```

WSL / Linux 测试，同时验证 `qjsc` 编译独立程序：

```sh
PATH="$PWD/toolchains/cosmocc-4.0.2/bin:$PATH" python3 scripts/test.py --upstream --compile
```

也可在 PowerShell 直接调用：

```powershell
wsl -d Ubuntu-22.04 --cd /mnt/d/Workspace/dairn/quickjs-cosmo --exec /bin/sh -c 'PATH="$PWD/toolchains/cosmocc-4.0.2/bin:$PATH" python3 scripts/test.py --upstream --compile'
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

还运行上游语言、内建对象、循环、BigInt、循环模块、Worker、I/O 回调、Intl 等测试。Windows 下仅跳过依赖 Unix `/bin/sh`、`true`、`cat` 的上游 `test_std.js`，该测试在 WSL 内运行；自编的跨平台文件 I/O 测试在两端运行。

## 将 JS 编译为独立程序

WSL / Linux 中：

```sh
export PATH="$PWD/toolchains/cosmocc-4.0.2/bin:$PATH"
./dist/qjsc -o build/hello.exe examples/hello.js
./dist/ape-x86_64.elf build/hello.exe # ARM64 使用 ape-aarch64.elf
```

生成的 `build/hello.exe` 同样包含两种架构，复制到 Windows 可直接启动。仅输出 C 文件无需安装编译器：

```powershell
.\dist\qjsc.exe -c -o build\hello.c examples\hello.js
```

`qjsc` 的独立程序输出仍需 `cosmocc` 工具链、旁边的头文件和两种架构的静态库。

## 兼容范围与验证边界

[Cosmopolitan 4.0.2 工具链文档](https://github.com/jart/cosmopolitan/blob/4.0.2/tool/cosmocc/README.md)声明支持 Linux、macOS、Windows、FreeBSD、OpenBSD 7.3、NetBSD，覆盖 x86_64 / AArch64。具体系统与架构的可用组合及版本限制以官方说明为准；这不包括浏览器、Android/iOS 或任意 32 位系统。

本机验证范围和结果记录在 `VALIDATION.md`。不能把生成了双架构 APE 等同于已在所有系统上实测。部分 Linux 的 binfmt_misc/Wine 配置会误识别 APE；可先尝试 `sh ./dist/qjs.exe examples/hello.js`，参阅[官方故障说明](https://github.com/jart/cosmopolitan/blob/4.0.2/tool/cosmocc/README.md#gotchas)。macOS 可能需要按系统规则处理下载文件的隔离属性，Apple Silicon 的默认启动过程可能需要系统 C 编译器来准备 APE loader。

QuickJS 不提供 Node.js 的 `fs`、`process`、npm 模块系统或浏览器 DOM。这里的运行时 API 是 QuickJS 的 `std`/`os`。原生动态模块通常与操作系统和架构相关，不属于这里的跨平台交付范围。QuickJS 和 Cosmopolitan 的许可证保留在上游源码及工具链内，产物中的 Cosmopolitan 许可声明由官方工具链嵌入。

Cosmopolitan 4.0.2 在 Windows 向原生父进程返回 POSIX wait status：例如 `std.exit(7)` 的 `$LASTEXITCODE` 是 `1792`（`7 << 8`），语法错误的值为 `256`；成功为 `0`。[官方实现](https://github.com/jart/cosmopolitan/blob/4.0.2/libc/intrin/exit.c)明确执行此编码。测试保留并核对原始返回码；不会把非零错误当成成功。Unix 端正常得到 `7` 和 `1`。
