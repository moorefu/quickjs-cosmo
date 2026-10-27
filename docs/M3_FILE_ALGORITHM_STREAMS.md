# M3-05 文件与算法流

前置 M3-04 已通过完整 CI：`dab3a8a`，[运行记录](https://github.com/moorefu/quickjs-cosmo/actions/runs/40569582305)。本项沿用固定 Nightly 的 zlib/Zstd 和既有摘要核，无新第三方算法依赖。Node 基线仍为 v24.21.0。

## 接口

`fs.createReadStream/ReadStream` 与 `createWriteStream/WriteStream` 继承已交付的 Readable/Writable。覆盖编码、水位、flags/mode、包含 end 的范围、position、bytesRead/bytesWritten、open/ready/end/finish/close、fd/pending、autoClose、signal、写入 flush 和显式 close。支持数值 fd、FileHandle、FileHandle 的两个 createStream 方法及 callback 风格的 fs 替换接口。

默认打开的文件持有现有 FileHandle 原生守卫。销毁等待正在进行的 I/O，再按 autoClose 关闭；写操作处理短写，范围读取接受短读。自定义 fs 的资源所有权由其 callback 实现承担。autoClose:false 在自然结束时保留描述符，显式 destroy/close 仍关闭它。ReadStream.close(cb) 按 Node 的 finished 语义交付回调，流已 end 时回调可能早于底层关闭；需要关闭屏障时观察实际 close 事件。URL 路径与 Windows realpath/入口路径问题仍属于 M5/M6。

Hash/Hmac 继承 Transform，沿用原生增量状态，写入不缓存全部历史数据，flush 只输出一个摘要。保留 update/digest、Hash.copy、输出编码、链式调用和流结束后的错误合同。Hash.copy 初始化独立流状态并复制原生摘要状态。

`node:zlib` 增加 Deflate/Inflate、Gzip/Gunzip、DeflateRaw/InflateRaw、Unzip、ZstdCompress/ZstdDecompress 及对应 create 函数。保留字典、窗口、级别、策略、Zstd params、pledgedSrcSize、flush/finishFlush、串联 gzip/Zstd 和错误传播。提供 flush、reset、close，压缩 deflate 家族提供 params；bytesWritten 统计后端消费的输入字节。一次性 Node 接口支持 info 返回 buffer 与相应类型的 engine 元数据。

## 原生执行与资源边界

压缩句柄保存真实后端增量状态。JS 每次最多提交 64 KiB 输入并获取最多 64 KiB 输出；输入复制到任务 arena，输出在 owner 线程复制回 JS。后台工作仅执行 C 后端，不调用 JS API 或 QuickJS 分配器。下游水位暂停期间不继续排队，destroy 释放背压等待，等待当前小块任务后关闭句柄。

持久状态使用 owner 预付、可合并的内存 arena：每个 zlib 引擎 1 MiB，每个 Zstd 引擎 16 MiB，均计入 Runtime 内存配额。超过 arena 的字典或 Zstd 窗口/压缩工作区会产生 OOM，不绕过配额。每个任务仍受 M3-01 的队列/总保留内存上限约束。一个引擎最多一个进行中的任务；任务持有句柄根引用，Context/Runtime 关闭先停止并等待任务，然后释放状态。GC/finalizer 不执行 JS。

SDK 的 GC 压力测试同时修复了公共 EventEmitter 的状态所有权：固定 QuickJS 会强标记 WeakMap 的值，监听闭包回指实例时，模块全局 WeakMap 会长期保留整个管线。监听表改为实例拥有的私有 Symbol 属性，保留监听行为并允许普通循环 GC 回收；不通过放宽内存增长断言掩盖该问题。

不提供 Brotli、LZ4/bzip2 Transform、Zstd 后端自建线程、Node 私有状态字段或完整的全部 Node stream 参数组合。流 chunk 边界可能与 Node 不同；maxOutputLength 维持一次性 API 的 Node 合同。info 的 engine 用于类型与消费量元数据，不保留一次性调用已结束的原生状态。兼容清单保持 partial。

## 验收

- STR-005：文件—压缩—文件、文件—摘要管线，范围、fd/FileHandle 所有权、定位写、短读短写、打开失败及取消。
- STR-006：Hash/Hmac/copy、全部九个压缩流、慢速下游、计时器推进、字典、逐字节串联 gzip、flush 和 info。
- STR-007：损坏/截断/字典缺失、Hash finalized、AbortSignal、进行中 destroy、params 和 reset。
- STR-008：相同能力进入 source、Worker、qjsc 内嵌 Worker 与 SDK；SDK 验证反复 GC、工作线程无 QuickJS 分配、arena OOM、配额回收和有任务时销毁 Runtime。

本地最终验收：Linux 100/100；Windows 75/75，另跳过一项 Unix 专用检查。两端 Node 同源差分均为 38/38，调度生命周期为 19/19。SDK 三轮 Runtime 的循环 GC 增长约 6.7 KiB，保持 64 KiB 的回归上限；进行中任务关闭与 arena 分配失败通过。独立压缩互操作为 50 组、双向通过。

Python 80 项检查、TypeScript 5.9.3 的 ES2022/ES2022+DOM 正反向声明检查通过。三文件运行包、双架构 SDK 与包含 28 个测试/探针 APE 的 CI 传输包校验通过。清单现有 469 项 API、29 个模块和 52 个测试条目。

本项完整 CI 已通过：`f90d02d`，[运行记录](https://github.com/moorefu/quickjs-cosmo/actions/runs/40581885448)。后续进入 M4-01。

首次 CI 中 macOS ARM 的 STR-005 揭示了上述 close 回调竞态。修复对齐显式 destroy 的 fd 关闭，并以实际 close 事件验证释放；补充了 autoClose:false 的读/写流销毁、WriteStream.close 和提前关闭回调的同源测试。
