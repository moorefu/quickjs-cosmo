# M3-04 异步子进程

依赖已通过完整 CI 的 M2-05 启动/等待路径与 M3-03 Stream：[Stream CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40546141176)。新增 `spawn`、`execFile`、`exec`、ChildProcess 与标准 stdio 流，不增加第三方库。启动、Windows 命令行引用、cwd/env/PATH、uid/gid、共享文件游标仍复用固定 Nightly 的既有适配。

## 所有权与事件循环

每个子进程由 Runtime 登记的原生对象持有，保存其所属 Context、回调、进程和管道；不占用 ContextOpaque/RuntimeOpaque。每个 Runtime 最多 16 个子进程，超过时以异步 EAGAIN 失败。原生数据和三个 64 KiB I/O 块在 JS 线程预付 Runtime 配额，后台线程不调用 JS API 或分配器。线程栈来自宿主线程实现，其数量受上述并发上限约束。

输出 pump 同时监督 stdout/stderr 和进程退出；独立 stdin writer 处理阻塞写，避免双流大输出与大输入互相等待。stdin 按 64 KiB 分块复制，写完成后再提交下一块；输出被 JS 线程复制后释放原生块。JS Writable 保留输入直到回调，调用者仍须遵守 Node 的“回调前不修改写入缓冲”合同。JS Stream 的排队空间继续受 Runtime 配额和用户是否遵守背压影响。

复用任务调度器的现有 waker，在所属 Context 的 JS 线程交付事件。任务完成与子进程进度交替调度，子进程之间轮转，定时器保持优先级。子进程 I/O 使用独立线程，不占用 fs/KDF 的两个任务线程。关闭/失败先停读写、取消并 join 写线程、终止与回收进程，再释放回调和 Context。异常 wait 失败也走强制回收，不能假定子进程已经结束。

Linux 上的 APE 目标先使用固定 Nightly execve-sysv.c 的原生 loader 回退；否则 WSL 可能直接接受 APE 的 Windows PE 入口，使 Linux 父进程启动出 win32 子程序。只调整 APE 的分派顺序，其他 ELF/脚本和其他平台沿用原路径；原始来源摘要与嵌套启动用例进入证据。

原生 fd/HANDLE、未交付结果和 native guard 都有唯一关闭路径；Runtime/Context 关闭在释放 waker 前完成线程清理。SDK/Worker 关闭会终止并回收其拥有的子进程。CLI 上无引用的子进程不阻止正常退出；Unix 退出时可移交没有引用的子进程，Windows 的常规子进程保留平台退出行为。该行为有实际父进程退出的 Node 同源用例，完整 detached 仍不在本批范围。

## Node 接口

ChildProcess 提供 pid/spawnfile/spawnargs、exitCode/signalCode/killed、stdin/stdout/stderr/stdio、kill/ref/unref 和 Symbol.dispose。ref/unref 返回 void；stdio 流的 ref/unref 返回自身。支持 signal 0 的存活检查、标准 killSignal、spawn timeout、AbortSignal 和 reason。默认 stdio 为三个 pipe；支持 ignore/inherit、fd 及现有 fd 对象。IPC、fork、额外 fd、完整 detached 未启用。

spawn 在调用时完成原生启动，spawn/error 事件异步交付。exit 表示进程已结束；close 等待相关 stdio 的 close 事件和原生清理，不能以流的 closed 属性提前代替事件。子进程退出时按 Node 行为处理 stdin 与输出排空。Windows 重定向文件的游标在 exit 交付前同步，既支持 exit 监听器读取，也支持 close 后读取。

已经完成的 stdin 写入及关闭先于进程 exit 通知交付，避免较慢宿主先处理 exit、销毁 stdin 后吞掉写入失败或回调结果。SDK 故障用例显式延迟 JS 事件处理，覆盖写入 EIO 与子进程退出同时到达的情况。

execFile/exec 捕获两条输出并调用 error-first 回调。maxBuffer 按每条流单独计数，与同步接口既有的合计合同区分；默认 1 MiB，0 表示零容量，Infinity 不设捕获上限但仍受 Runtime 配额约束。字符串解码使用 Stream 边界解码器；encoding:null/显式 undefined/非编码字符串按 Node 返回 Buffer。超限、启动失败、超时终止与 AbortError 保留各自字段，不能统一成一种错误形状。util.promisify 返回 `{stdout, stderr}`，其 Promise 的 child 为真实 ChildProcess。

Stream 集成同时补上 readable 监听存在时的 resume 行为，以及异步迭代期间持续保留 readable 监听，避免退出排空丢掉尚未被迭代器消费的数据。

## 验收与范围

- PROC-003：模块/实例身份、二进制 I/O、参数引用、cwd/env/argv0、文件重定向和 exit 游标、exec/promisify。
- PROC-004：启动失败、退出错误、逐流 maxBuffer、编码、超时、kill 和前后两种 AbortSignal 时序。
- PROC-005：双流大输出、大输入、流管线/迭代、背压、并发子进程与 fs/KDF、signal 0、真实 unref 退出。
- PROC-006：源脚本、Worker、qjsc 内嵌 Worker；SDK 注入各 pipe、writer/pump 创建、poll/read/write/wait、原生对象/guard/输出分配失败，验证部分 I/O/EINTR、回调一次、ContextOpaque、线程归属和反复 Runtime 关闭。

配额、三条 stdio 与尚未启用的功能在 API 清单中明确标为 partial。终止整个后代进程树、进程组/会话和 Windows 全部控制台信号不在本批声明范围；不能将杀死一个 pid 宣称为整棵树的取消。操作系统中无法返回的等待仍可能延迟回收。

M6 入口审计继续跟踪 Windows 通用 argv 中绝对路径被 Cosmopolitan 改写为 `/D/...` 的问题，以及低内存配合现有 assert.throws 时的 TDZ 异常；SDK 低内存资源验收采用直接 try/catch。unref 夹具通过环境传递子程序路径，独立验收子进程退出合同；这不等于已经解决入口 argv 问题。

完整 CI 全绿后进入 M3-05 文件/算法流。状态及证据见 [实施状态](RUNTIME_IMPLEMENTATION_STATUS.md)。

本地验收：Linux 完整回归 95/95，Windows 72/72（另跳过一项 Unix 专用检查）；两端 Node 同源对照均为 35/35，调度生命周期均为 19/19。Python 80 项检查、TypeScript 5.9.3 的 ES2022/ES2022+DOM 声明检查、运行包和包含 26 个 APE 的 CI 传输包校验通过。API 清单现有 448 项、29 个模块和 48 个测试条目。
