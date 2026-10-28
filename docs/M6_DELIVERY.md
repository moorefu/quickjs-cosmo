# M6-01 全入口交付

## 范围

沿用固定 QuickJS 2026-06-04、Cosmopolitan Nightly 802 和 Node v24.21.0 基线，不新增第三方库。已有模块继续通过源码、Worker、qjsc 和手工链接 SDK 的验收；本批补齐标准流与入口边界，并检查对象和运行时销毁后的资源回收。

`process.stdin`、`stdout`、`stderr` 及 `node:process` 对应命名导出分别为 Readable/Writable，保留 fd 0/1/2。支持二进制输入、流背压、pipe/pipeline、写回调和 EPIPE。pipe/pipeline 不自动结束标准输出。stdin 的 ref/unref 控制事件循环存活。TTY 只提供 isTTY，不声明 raw mode、光标控制和窗口事件。

输入复用现有事件循环，通过固定 Nightly 的 poll/read 检查就绪；一个进程同时只允许一个 Context 订阅读取。竞争者得到 ERR_STDIN_BUSY。Worker 可以写标准输出和标准错误，读取共享 stdin 得到 ERR_WORKER_UNSUPPORTED_OPERATION。关闭流和运行时只撤销订阅，不关闭宿主 fd 0/1/2。

输出按最多 64 KiB 一段同步写入宿主描述符，写成功后的回调进入 nextTick。Unix 管道也使用同步写入，因此慢速接收方可能阻塞；这是与 Node 部分宿主上异步 stdio 的差异。继承的非阻塞描述符出现 EAGAIN 时返回错误。写入临时抑制并消耗本次 EPIPE 产生的 SIGPIPE，保留原信号设置。macOS 管道沿用固定 Nightly 的 F_SETNOSIGPIPE 路径，Windows 使用其已验证的模拟信号实现。

## 入口和回收

Windows 用户参数使用同一 Nightly 的 GetDosArgv 重新读取原始命令行，避免启动层将业务参数中的 DOS 路径改为内部斜杠路径。Windows realpath 复用 Nightly 的路径转换、CreateFile/GetFinalPathNameByHandle 封装，支持盘符、目录、链接与 UNC 路径，保留宿主拼写；异步线程不调用 JSContext。Unix 沿用原 realpath。

文件模块提供 import.meta.filename 和 dirname。qjsc 主模块指向可执行文件；嵌入模块仍采用 qjs:embedded URL。qjs:eval、qjs:internal 和其他非 file URL 不虚构文件名。模块说明符在 QuickJS 的完整字符串转为宿主 C 字符串前检查 NUL，覆盖静态链接、动态 import 与 qjsc，防止截断后加载其他模块。

QuickJS 的 WeakMap 值会强引用其内容；当值回指键时，旧状态表会保留 EventTarget、AbortSignal、流及压缩器。相关状态改为随实例保存，维持冻结实例的内部状态更新和严格品牌检查。子进程关闭后释放 signal 与定时器引用。SDK 测试在预热后执行三批循环，每批进行三次 GC，要求新增保留内存低于 64 KiB；覆盖监听闭包、自引用 abort reason、流、定制 fs、背压中的 Gunzip 与已退出子进程。

## 验收入口

- `tests/node/process-stdio.mjs`、`entry-boundaries.mjs`：相同源码对照固定 Node，覆盖参数、标准流、模块错误、文件元数据和 realpath。
- `tests/runtime_delivery.mjs` 与其 Worker：源码及 qjsc 的元数据、NUL 拒绝、冻结信号和 Worker 标准流限制。
- `scripts/test_stdio.py`：父进程持有独立管道，逐一检查解释器、qjsc、手工 SDK 的二进制输入、引用计数、输出生命周期及断管错误。
- `tests/native/stdio.c`、`lifecycle.c`：手工 SDK 初始化、事件循环与销毁，以及循环对象的回收上限。
- `scripts/test.py` 和 `ci_artifact.py`：将同一批独立 APE 传到七平台验证，构建与运行结果写入现有报告。

本地验收：Linux 构建及完整回归 139/139；最终共享 APE 复核 92/92；Windows 94/94，另有 1 项 Unix 命令测试按既定规则跳过；两端 Node 差分 58/58；Python 97 项；TypeScript 5.9.3 的 ES2022 与 ES2022+DOM 均通过。CI 传输清单包含 45 个独立 APE，三文件 ZIP 与 SDK/源码/产物哈希核验均通过。

完整 CI 已通过：`256ee8b`，[七平台及总门禁](https://github.com/moorefu/quickjs-cosmo/actions/runs/40714828461)。首轮发现的 unref 标记文件创建/写入竞态已修正为等待完整内容，未放宽超时和结果比较。现进入 M6-02。
