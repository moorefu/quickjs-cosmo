# 固定版本的构建与验证记录

验证日期：北京时间 **2026-10-27**。

当前仓库仅使用 `versions.json` 中的这一组输入，构建不会自动更新源码或工具链：

| 组件 | 固定值 |
| --- | --- |
| QuickJS | `1ec58aaa769a992213ec2b871b0228074169904b`，VERSION `2026-06-04` |
| cosmocc | Nightly #802，提交 `aefad27c09ffda64c6ac64bd69f758e9f9c7b91d` |
| Nightly artifact | `12629850103`，419,652,152 字节 |
| 工具链 ZIP SHA-256 | `7f8a0bfd991401e027f794d516bf52a5184b5089e5dd1a50cf9e9ade54b5bb06` |
| QuickJS 源码归档 SHA-256 | `eb308d46654ae345f2396922dfb24656abf63990ff8c2ba7f155e4c08c8ef0f1` |

工具链来源为[官方 Nightly #802](https://github.com/jart/cosmopolitan/actions/runs/40271229025)。原来的双配置已经合并，默认命令和兼容的 `--nightly` / `-Nightly` 参数使用相同输入和输出目录。4.0.2 不再是当前构建选项。

构建环境为 Ubuntu 22.04.5 / WSL2，Linux `6.6.87.2-microsoft-standard-WSL2`，x86_64，GCC 14.1.0。保留 `CONFIG_COSMO=y`、`-O2`、无 LTO、Temporal/Intl 和双架构 APE。构建文件在 `build/quickjs-nightly/`，当前产物在 `dist/`。

## 测试结果

| 环境 | 结果 |
| --- | --- |
| WSL2 / Linux x86_64 | 29/29 通过 |
| Windows 11 x86_64，build 22000 | 29/29 通过，1 项跳过 |
| 受限 Windows 账户 | 30 个进程回归场景通过 |

主测试包含原有 8 组自编 JS（376 个断言）、示例、退出处理、上游快速测试、qjsc 生成 C，以及进程回归。Linux 编译、执行独立 APE，并将含进程调用的 JS 编译成独立程序；Windows 执行这些 Linux 生成的独立程序，并验证反斜杠模块路径、参数保持和 `qjsc -m`。

进程回归作为主测试中的一项，在 Linux 内部验证 **17 个场景**，Windows 内部验证 **31 个场景**，均包含独立 APE 调用原生子进程。受限账户另外验证自然退出、qjsc、子进程和标准流。

Windows 唯一跳过的上游测试为 `test_std.js`，依赖 Unix `/bin/sh`、`true`、`cat`；该测试在 WSL 通过。未运行完整 Test262 数据集。

当前报告路径：

- `build/test-results/linux.json`、`windows.json`
- `build/runtime-audit/nightly-regression-linux.json`、`nightly-regression-windows.json`
- `build/runtime-audit/nightly-restricted-final-windows.json`

报告包含 qjs 的 SHA-256、工具链元数据和各场景退出码。旧诊断目录保留的历史结果不代表当前产物。

## 保留的兼容修复

四项 QuickJS 补丁修复运行时 `os.platform`、Windows poll 句柄边界、异步唤醒器索引、入口模块路径和进程调用。`compat/` 使用同一 Nightly 提交的少量 Cosmopolitan 源文件，原始文件、补丁和修改后文件均按 SHA-256 校验；构建还检查兼容源提交与工具链锁定提交一致。未引入新的第三方库。

进程验证覆盖：

- 使用 `posix_spawn` 启动 cmd、Python、Git，有限的描述符上限回退。
- 等待错误仅重试 EINTR，WNOHANG 未完成时返回 `[0, 0]`。
- 明确跟踪自建环境数组的所有权，继承环境传 NULL，避免 environ 重分配后的错误释放；测试固定 `TZ=UTC`、`LC_ALL=C`。
- 同步与异步保留完整 DWORD，包括受控原生进程返回的 `0xC0000005`、`0xC0000142`。
- 原生边界清理 `_COSMO_FDS`、`_COSMO_FDS_V2`、`_MASK`，直接 APE 保留协议，接收端保护标准句柄。
- 原生标准流使用同步磁盘句柄，验证 UTF-8 输入、独立 stderr 和 1 MiB stdout。
- 中文和空格工作目录、引号/反斜杠/Unicode 参数、PATH、替换环境、用户 `_COSMO_USER` 变量、缺失程序错误，以及不支持的 Windows uid/gid。
- 信号文件放入用户临时目录 `quickjs-cosmo-sig/`，非 PID 碰撞错误明确退出，避免进入 main 前无限重试；保留退出清理。

修复对象链接到解释器、编译器、run-test262 和开发静态库，qjsc 生成的独立程序同样包含修复。参考代码的单独许可文件与声明已移除；QuickJS、Cosmopolitan 的上游许可保留。

## 退出码与发布包

Windows 中 `std.exit(7)` 返回 **7**，语法错误、未处理异常、未处理 rejection 返回 **1**；阻塞 `os.exec` 与异步 `os.waitpid` 返回完整 unsigned DWORD。Unix 保持 POSIX 语义：阻塞 os.exec 返回逻辑退出码，os.waitpid 返回 wait status，退出 7 对应 1792。

当前发布包为 `releases/quickjs-cosmo-2026-06-04.zip`。ZIP 根目录按官方顺序仅含 `readme.txt`、`run-test262`、`qjs`；readme 保留官方正文并附加两个组件的固定提交标识。SHA-256 校验文件在 ZIP 外，产物清单为 `dist/manifest.json`。

验证 ZIP CRC、名称顺序、readme、二进制哈希和解压后在 Windows / Linux 的启动。从 qjs、run-test262 副本分别提取 ELF，确认每个程序均包含 x86_64（machine 62）和 AArch64（machine 183）；ZIP 内仍保留双架构 APE。

尚未在 macOS、FreeBSD、OpenBSD、NetBSD 或 ARM64 硬件上运行。信号文件命名空间与未修补的官方运行时不同；用户临时路径过长时回退到原始 ProgramData 路径，失败会报错而非挂起。

## CI 配置验证

工作流 `.github/workflows/build-ape.yml` 复用现有构建、测试和发布包脚本，定义 Linux x86_64/ARM64、macOS Intel/ARM64、Windows 2022/2025 x64，以及 Windows ARM64 的 x64 兼容运行共 7 个矩阵项。所有项消费同一构建产物，汇总门禁要求全部成功。Actions 依赖锁定到官方提交 SHA。

本地验证通过 actionlint 1.7.12 的工作流语法与表达式检查、18 项 CI 辅助单元测试、Windows/WSL 各 29 项完整回归。另在没有 cosmocc 的干净目录中演练传输包恢复、离线源码恢复和跨主机独立程序测试：Windows 29/29（另跳过 1 项），Linux 27/27；执行前后均复核哈希。演练日志与报告在 `build/ci-rehearsal/build/`，构建任务日志在 `build/ci-build.log`、`build/ci-test-linux.log`。新异步用例使用父进程释放标记同步 WNOHANG 检查，避免依赖固定休眠时间。

提交 `3ff8091` 的[首轮远端 CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40386676718)已全部通过，覆盖上述 7 个 GitHub 托管矩阵项，包括 macOS 和 ARM64。Windows ARM64 项为 x64 PE 的系统兼容运行；这些结果与本地 WSL/Windows 演练分别记录。BSD 和 ARM64 Windows 原生 PE 未纳入该矩阵。

## Tag 发布流程

`v` 开头的版本 tag 会运行同一组构建与矩阵，只有 `CI gate` 成功后才创建 GitHub Release。Release 的版本和标题取完整 tag（例如 `v2026-06-04.1`）；ZIP 名使用去掉 `v` 的版本号（`quickjs-cosmo-2026-06-04.1.zip`），并额外提供 SHA-256 与构建清单。引擎提交和 VERSION 保持锁定。

发布先创建草稿，校验服务端附件摘要和 tag 的提交指向后再公开。测试覆盖 tag 移动、附件损坏、草稿恢复、已有同版本的幂等重跑，以及拒绝修改不同内容的已发布版本。当前发布脚本的本机 `--dry-run` 只校验和生成发布说明，不写 GitHub Release。
