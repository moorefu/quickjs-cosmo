# M3-02 异步 fs 与算法

本阶段把已准入的同步后端接入 M3-01 任务池。后台只处理快照、arena 和宿主调用，结果在提交 Context 的线程交付。接口保持 ESM 与 Node v24.21.0 风格，不增加 require/npm 加载或自定义 `crypto/promises`、`zlib/promises` 命名空间。

## 文件系统

`node:fs` 的 callback 子集覆盖 readFile/writeFile/appendFile、access、目录/元数据/重命名/删除、realpath/copyFile/mkdtemp，以及 open/close/read/write/fstat/ftruncate/fsync。`fs.promises` 与 `node:fs/promises` 默认导出是同一对象，裸 `fs/promises` 复用模块实例。

Promise 的 open 返回 FileHandle，提供 fd、read/write、readFile/writeFile/appendFile、stat/truncate/sync/close 与 Symbol.asyncDispose。关闭等待已提交操作；关闭期间新操作拒绝，重复关闭复用同一 Promise。回调 read/write 保留三参数结果及原输入对象；util.promisify 使用其多返回值适配。

FileHandle 与 readFile/writeFile/copyFile 内部打开的文件持有原生 fd guard。尚未交付的 open 结果、包装失败及 GC/Runtime 清理均有 fd 所有者；关闭入队前把所有权交给关闭任务，取消或销毁也不会遗失 fd。关闭任务无法创建时直接回收 guard。原生 guard 不暴露为 Node 模块导出。GC 关闭暂不生成 Node 的警告。callback open 返回的裸 fd 由调用者负责关闭。

提交时复制路径字节和写入数据；后台不保留 JS 缓冲区裸指针。读取结果先落到任务内存，再在 JS 线程复制到目标视图。读写保留 byteOffset、部分 I/O、EINTR 和 64 位位置处理。内部为在途描述符操作保留共享文件描述的副本，避免外部关闭/复用 fd 号后操作落到另一个文件；裸 fd 的这种竞态行为不声称逐步等同 Node。FileHandle 的关闭计数提供确定的时序。

readFile/writeFile 分块提交真实原生工作，文件内容长度仍受 Buffer 与 Runtime 配额限制。支持这两个方法的 AbortSignal，取消在 I/O 步骤之间生效，不强行打断内核中尚未返回的系统调用。目录扫描结果使用有界 arena，超出其约 4 MiB 的结果预算按内存不足失败。相对路径仍受宿主进程全局 cwd 影响。

Windows 对只读句柄 fsync 的 EACCES→EPERM 映射已按 Node 基线修正，同步路径也使用该修正。文件 URL 等待 URL 阶段；Windows 盘符绝对路径及 UNC 的 realpath/入口问题继续列为 M6 必须解决项，当前 realpath 对照覆盖简单相对路径。流与 AsyncIterable 文件数据在流阶段扩展。

## 随机、派生与压缩

crypto 启用 callback hkdf、pbkdf2、randomBytes 与 randomFill，保留 hkdf 的 ArrayBuffer 和 pbkdf2/randomBytes 的 Buffer 结果。输入在调用时复制；randomFill 在 JS 线程写回原视图。保留 Node 零长度随机填充回调同步触发的边界，不把全部回调强行延后。

PBKDF2 仍编译固定 Nightly 的 pkcs5.c，只在 HMAC reset 调用处加入私有取消检查。迭代、计数器及 XOR 逻辑不重写；原始文件摘要、适配器与双架构闭包进入构建证据。取消只用于原生任务生命周期，不给 hkdf/pbkdf2 添加 Node 没有的 signal 参数。线程局部分配器切换到任务 arena，结束后恢复；敏感暂存及输出保持既有清零合同。

zlib 启用 gzip/gunzip/deflate/inflate/deflateRaw/inflateRaw/unzip/zstdCompress/zstdDecompress 的 callback 形式；cosmo:compression 同时提供 LZ4 Frame/bzip2 的四个 callback 扩展。同步和异步共用参数解析、错误与格式后端，包含字典、Zstd 参数、输出限制和尾随数据规则。支持 callback 的 signal，后台在输出步骤间检查取消。引擎对象、info:true 与 Transform 在流阶段接入；Zstd 自带工作线程仍不启用。

全部异步任务受 64 槽及总计 64 MiB 预留限制。算法按输入和工作区估算预付 arena，单任务最多 64 MiB；不能在后台扩展 JS 配额。压缩工作区或输出超过其预付 arena 时可能早于 maxOutputLength 触发内存不足。资源上限属于本项目明确差异，未伪装为 Node 方法的长度限制。同步路径的原有配额合同不变。

## 验收与后续

- FS-003：callback/Promise 身份与返回值、DataView、promisify、FileHandle 并发关闭与其他方法、目录/复制、错误、AbortSignal。
- KDF-002：六个摘要的异步派生向量、输入快照、随机填充类型/边界、零长度回调时序及长 PBKDF2 期间定时器推进。
- ZIP-005：九个 Node callback 编解码方法、字典、视图、错误、输出限制、AbortSignal 及长 gzip 期间定时器推进。
- LIFE-002：源脚本、Worker、qjsc 内嵌 Worker 与扩展格式；SDK 注入短读写/EINTR、读取失败、随机源失败、结果分配失败，验证未交付 open、已交付 FileHandle 与运行中 PBKDF2 的关闭清理。

所有 Node 测试使用同一 `.mjs` 文件在同宿主的固定 Node 与 qjs 比较。算法仍使用 M2 的固定来源和独立格式互操作验收；新 SDK 程序断言后台不进入 JS 分配器。类型声明覆盖已导出接口，并保留未实现流/Brotli 等负向检查。

本地验收：Linux 完整回归 85/85；Windows 完整回归 66/66，跳过一项 Unix 专用检查；两端 Node 差分均为 29/29、调度生命周期均为 19/19。Python 80 项检查、TypeScript 5.9.3 的 ES2022/ES2022+DOM 声明检查及运行包/CI 传输包完整性检查通过。API 清单共 416 项、29 个模块、41 个测试条目，异步接口继续标为 partial，并记录本阶段范围和配额差异。

完整 CI 全绿后进入 M3-03 Stream。阶段状态及 CI 链接统一见 [实施状态](RUNTIME_IMPLEMENTATION_STATUS.md)。
