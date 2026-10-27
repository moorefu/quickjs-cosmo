# M2-05 同步子进程

本项实现 `node:child_process` 与裸别名 `child_process` 的 ESM 同步子集：`spawnSync`、`execFileSync`、`execSync`。Node 对照版本固定为 v24.21.0。本地 Linux/Windows 验收通过后提交；完整 CI 全绿前不进入 M3-01。

## 接口与范围

- 直接执行保持 argv 边界；只有显式 `shell` 或 `execSync` 才经过 shell。支持 Unicode、空参数、引号、反斜杠、`argv0`、`cwd`、`env`、PATH 搜索和 Windows verbatim/hide。
- 支持三个标准描述符的 pipe、ignore、inherit、数字 fd 和 `{fd}`。输入支持字符串及带偏移的 ArrayBufferView。输出默认 Buffer，也可指定编码；同一结果的 `stdout/stderr` 与 `output` 元素保持身份。
- 同时排空 stdout/stderr，并用原生线程传递 stdin，避免“大输出后读输入”的互锁。输出合计应用 `maxBuffer`；默认 1 MiB，0 表示不设该上限，运行时内存配额仍生效。
- timeout 使用单调时钟；首次终止关闭标准管道，等待并回收子进程。支持 `killSignal`，宿主不支持的终止信号回退 SIGKILL。`exec*Sync` 在失败时抛出带完整结果的 Error，默认转发 stderr。
- Unix 使用真实子进程 PID、退出状态与信号。Windows 使用真实系统 PID，完整保留 DWORD 退出码，例如 4294967295；不将其误作 POSIX wait status。
- Unix 显式 uid/gid 按 Node 验证 int32，仅修改请求的身份并尝试清除附加组。Windows 返回 ENOTSUP。缺失文件、cwd、权限、timeout/maxBuffer 的 errno 按各宿主 Node 合同转换。

`detached:true`、IPC、超过三个 stdio 描述符尚未启用，明确拒绝。cwd 当前支持字符串与 Uint8Array；URL 等待 URL 模块。异步 ChildProcess、流、fork/IPC 不在本阶段。Windows 不直接启动 `.cmd/.bat`，须由调用方选择 shell。模块保持 `partial`。

## 固定后端与生命周期

复用当前固定 Nightly 的 `posix_spawn.c` 及已有兼容补丁后的 `ntspawn.c`，以私有名称编译；原始上游文件不修改，无新原生依赖。源文件摘要进入 `native/versions.json`，ISC 许可进入 SDK 与运行包 readme。

Windows 私有适配使用 MSVCRT/libuv 风格参数转义，保留 `/C/...` 等普通参数文本。标准句柄显式继承；磁盘句柄同步重开，同一文件描述共享游标，退出后同步父 fd 位置。不会将 APE 临时 fd/信号协议环境传给普通原生程序。

JS 参数在启动前完成规范化，后台输入线程不访问 QuickJS、不分配 JS 内存。读取工作区与输出缓冲计入当前 JSRuntime 配额；Worker 的 80 KiB 原生线程栈不承载 64 KiB I/O 数组。每条失败路径关闭 fd/句柄、取消并 join 输入线程、终止并回收仍运行的子进程，再向 JS 传播错误。嵌入方的 Runtime/Context opaque 保持可用。

## 验收

- `PROC-001`：参数、Unicode、cwd/env/PATH、输入视图、编码、stdio 文件共享游标、shell/直接执行、PID、原始状态、错误与参数校验。
- `PROC-002`：同时传入 1 MiB、分别排出 1 MiB、合计 maxBuffer、零上限、超时与 SIGKILL。
- Node 差分两端都使用驱动验证过的同宿主 Node 可执行文件作为测试子程序，避免将子程序所需的 JS 能力混入进程语义比较。运行时、Worker、qjsc 与 SDK 测试独立使用系统 shell/原生 APE 子程序，运行时不依赖 Node。
- `tests/native/child_process.c` 自身作为原生测试子程序，验证双向管道、每一次原生输出分配失败、pipe/thread/poll 故障、EINTR/短读写、阻塞输入超时、输入提前关闭；验证返回后所有已建管道关闭、运行时分配无残留，多次 Runtime 销毁。
- source/Worker、qjsc 内嵌 Worker、手工 SDK 均进入统一测试驱动；两个独立 APE 进入 CI 传输清单。类型覆盖同步导出与选项。

本地完整结果：Linux 77/77，Windows 61/61（另有 1 项原有 Unix shell 专属测试跳过），两端 Node 差分各 26/26；Python 80 项通过，TypeScript 5.9.3 两种 lib 配置通过。三文件 ZIP、含双架构 SDK 与 19 个测试 APE 的 CI 包完整性通过。

CI 结果与后续任务入口统一记录于 [实施状态](RUNTIME_IMPLEMENTATION_STATUS.md)。
