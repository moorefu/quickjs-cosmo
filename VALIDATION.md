# 构建与验证记录

验证日期：北京时间 **2026-10-27**。

- QuickJS：`master`，提交 `1ec58aaa769a992213ec2b871b0228074169904b`，获取时为最新主干。
- Cosmopolitan：官方 **4.0.2** 工具链；归档 SHA-256 为 `85b8c37a406d862e656ad4ec14be9f6ce474c1b436b9615e91a55208aced3f44`。
- 构建：Ubuntu 22.04.5 LTS / WSL2，Linux `6.6.87.2-microsoft-standard-WSL2`，x86_64；GCC 14.1.0；`CONFIG_COSMO=y`、默认 `-O2`、无 LTO、保留 Temporal/Intl。
- 所有交付 `.exe` 都保留双架构 APE 格式。辅助 ELF 检查确认包含 x86-64 与 AArch64 两条编译链的结果；没有将交付程序 assimilate 为单一系统格式。

## 实测结果

| 实际运行环境 | 结果 | 说明 |
| --- | --- | --- |
| WSL2 / Ubuntu 22.04.5 x86_64 | **27/27 通过** | 8 组自编测试、2 个示例、4 项退出/错误处理、qjsc 生成 C/编译/运行、10 项上游测试 |
| Windows 11 x86_64，build 22000 | **25/25 通过，1 项跳过** | 相同的 8 组自编测试、示例、退出处理、qjsc 生成 C、运行 Linux 编译的独立程序、9 项上游测试 |

8 组自编 JS 测试在每端共执行 **376 个断言**。包含 100 对管道、逆序注册的写回调、逐条数据校验与关闭，以及 Worker/SharedArrayBuffer/Atomics、BigInt、UTF-8 文件与路径、JSON 模块、顶层 await、Temporal/Intl。

Windows 跳过的唯一上游用例为 `test_std.js`：它需要 Unix `/bin/sh`、`true`、`cat`。该用例已在 WSL 完整通过；Windows 自编文件 I/O、定时器、Worker、100 对管道测试均已通过。

具体输出、耗时和原始退出码：

- `build/test-results/linux.json`
- `build/test-results/windows.json`
- 官方格式的精简二进制 ZIP 不包含测试报告；报告保留在上述项目路径中。

另已验证：PowerShell `scripts/build.ps1 -Offline` 入口、Python/PowerShell 语法、Unix `dist/qjs` 启动入口、产物清单 SHA-256。`qjsc` 在 WSL 编译的 `build/test-linux/hello-standalone.exe` 已在 WSL 和 Windows 各运行一次。

## 必要的兼容修正

1. `patches/0001-runtime-platform.patch`：上游 `os.platform` 依据编译宏初始化，Cosmopolitan 构建在 Windows 上也会报告 `linux`。改为使用 Cosmopolitan 的运行时平台检测，实测分别返回 `linux` 与 `win32`。
2. `patches/0002-windows-poll-batches.patch`：官方 4.0.2 `poll-nt.c` 的慢路径每批传入 64 个描述符，但实际实现为信号保留一个句柄，只接受 63 个文件句柄。原版在上游 100 对管道测试中返回错误并挂起。QuickJS 事件循环在 Windows 大批量监听时改为每批最多 63 个描述符，扫描所有批次后最多休眠 10 ms；其他系统沿用原生 `poll`。同时修正上游将唤醒器 fd 误用为 poll 数组下标的问题。
3. WSL 启动：项目内的构建工具用官方 `assimilate` 转换为本机 ELF；运行时入口显式使用附带 APE loader，避免 WSL 的 `MZ` 注册项把测试误交给 Windows。未修改 WSL 全局配置。

补丁摘要和产物哈希保存在 `dist/manifest.json`，原始上游源码仍保留在 `upstream/quickjs/`。

## 4.0.2 的 Windows 退出码约定

该版本官方 `libc/intrin/exit.c` 将 Windows 进程状态编码为 `status << 8`，用于 Cosmopolitan 父进程的 POSIX wait 语义。因此 `std.exit(7)` 在 Windows 原生 Python/PowerShell 下是 `1792`，语法错误/未处理异常是 `256`；Unix 下分别为 `7`、`1`，成功均为 `0`。

测试严格核对这一约定，并保存原始返回码。未修改底层 libc 的退出机制。

## 尚未实测

macOS、FreeBSD、OpenBSD、NetBSD，以及 ARM64 硬件运行。本环境没有这些系统或 QEMU；没有把编译成功描述为这些平台的测试通过。兼容目标来自 Cosmopolitan 4.0.2 的官方支持范围。

已构建 `run-test262.exe`，但未下载、运行完整 Test262 数据集。这里的通过数量是自编与上游快速测试数量，不是 ECMAScript 全规范认证结果。
