# M3-01 原生任务调度

本阶段交付原生任务基础，不增加异步 Node 方法的兼容声明。异步 fs、随机/KDF 和压缩绑定在下一项接入；本项完整 CI 全绿后再开始 M3-02。

## 所有权与配额

每个使用任务的 JSRuntime 延迟创建一个含两个 pthread 的任务池。多个 Context 共享该池，QuickJS Worker 使用自己的 Runtime 和池。最多保留 64 个任务，所有任务的 arena 预留总量最多 64 MiB；准备中、排队、执行、等待分发及正在完成的任务均受限制。任务完成释放 arena 后才归还预留额度。

arena 在提交线程一次分配并计入 QuickJS 内存配额；后台使用独立的对齐分配/重分配和释放器，不调用 QuickJS 分配函数。arena 不可在后台扩容。释放块及销毁 arena 清零，支持后续算法的敏感临时数据。队列满或预留不足时同步报告 `ERR_TASK_QUEUE_FULL` / `ERR_TASK_MEMORY_LIMIT`，实际分配失败按内存不足传播。任务不会无界排队。

`qjs-tasks.h` 随双架构 SDK 交付。C 绑定先创建任务，在其 arena 中复制所有需要的输入，填写不依赖 JS 内存的 payload，再提交并取得 Promise 与任务 ID。调用方可注册原生 cleanup，所有完成、取消、准备失败的 discard 和关闭路径恰好执行一次；cleanup 不执行 JS。

后台 work 只能访问任务数据、arena 与宿主 API，必须配合取消检查。完成函数回到提交 Context 的线程，返回结果或异常；引用 arena 的结果必须先复制。完成函数及 Promise 结算后释放并清零 arena，再推进 nextTick/Promise 检查点。后台不能访问 JSContext、原始 ArrayBuffer 地址或 JS 分配器。

## 循环、取消与关闭

复用 QuickJS 已有的 Atomics 异步唤醒器，不创建第二套事件循环，也不以短间隔定时轮询伪装通知。完成队列由原有 poll 路径分发，运行中的任务阻止正常退出；定时器继续推进。每次 poll 分发一个完成项并执行所属 Context 的检查点，避免完成队列独占循环。

取消设置原子标志，排队任务跳过 work，运行任务合作退出，完成项只交付一次。原生基础报告 ECANCELED，具体 Node 绑定负责使用该方法对应的错误合同；不为 Node 没有取消参数的 API 增设 JS 参数。

宿主可用 `js_cosmo_tasks_close_context` 同步取消、等待并丢弃一个 Context 的任务与回调，其他 Context 继续运行。普通 `JS_FreeContext` 仍遵循 QuickJS 引用计数：待完成任务保留 Context；需要立即放弃工作时先调用显式关闭接口。

`js_std_free_handlers` 在销毁唤醒器之前取消所有任务并 join 两个线程，释放 JS 引用；`JS_FreeRuntime` 也有最终任务清理保护。SDK 仍须按既有合同初始化和释放标准事件处理器。关闭要求 work 配合取消；本阶段不声称能强制中断任意第三方阻塞调用。后台没有通用的 JS 回调能力。

## 验收与交付

`LIFE-001` 通过 SDK 测试专用的 C 函数提交原生工作，不向产品导出探针。`tests/native/task-pool.mjs` 同一夹具以源码和 qjsc 生成的字节码执行，连同 C 驱动嵌入一个 APE 后传输到全部 CI 平台。

测试包括：

- 原生工作期间计时器推进，完成顺序及 nextTick/微任务检查点。
- 提交后修改、分离输入 ArrayBuffer，原生端读取提交时的副本。
- 对齐、重分配、释放清零和 arena 耗尽；64 个任务及总预留上限。
- 排队/运行取消、重复取消、回调一次；持有的真实 fd 在取消、discard、正常完成和 Runtime 关闭时释放。
- 第一个及第二个线程创建失败、arena 分配失败、部分创建池的 join。
- Worker 独立池，以及同一 Runtime 下不同 opaque 的两个 Context：由另一 Context 的循环分发，关闭一个不会破坏另一个。
- 不运行 JS 循环直接关闭仍有原生工作的 Runtime，重复创建/销毁；断言后台不进入 JS 分配器。

SDK 探针和公开 Node 兼容方法的差分证据分开记录，本项不会把测试探针计算为 Node API。全量 Node 差分、现有调度生命周期、旧 std/os 与 qjsc 程序仍需全部通过。

## M6 入口验收待解决项

Windows 盘符绝对路径经过固定 Nightly 的 POSIX `realpath` 时，可能产生重复盘符路径，并在 Worker 模块初始化中留下异常。当前任务夹具对 legacy `os.Worker` 使用其支持的 `/D/...` 形式，任务所有权与取消测试不依赖该缺陷。M6 必须修复并覆盖 `fs.realpathSync` 与 Worker 的盘符绝对路径、UNC、符号链接/重解析点及异常传播，不能以本项任务池测试代替这些入口路径的验收。

本地验收：Linux 80/80，Windows 63/63（另 1 项原有 Unix shell 测试跳过），Node 差分各 26/26；Python 80 项和 TypeScript 5.9.3 通过。三文件 ZIP 与包含双架构 SDK、20 个测试 APE 的 CI 包完整性通过。

阶段状态与完整 CI 结果见 [实施状态](RUNTIME_IMPLEMENTATION_STATUS.md)。
