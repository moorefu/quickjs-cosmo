# M2-04 同步压缩

生产后端全部来自固定 Cosmopolitan Nightly #802。实际版本为 zlib 1.2.11、Zstd 1.5.5、LZ4 1.8.3、bzip2 1.0.8；不将它们伪装成 Node 自带库的版本。Node 合同以固定 v24.21.0 的内嵌 JS、原生 node_zlib.cc 和可执行文件差分为准。

## 模块与接口

`node:zlib` 与裸别名 `zlib` 同实例，默认/具名导出 gzipSync/gunzipSync、deflateSync/inflateSync、deflateRawSync/inflateRawSync、unzipSync、zstdCompressSync/zstdDecompressSync、crc32、constants、codes。unzip 自动识别 gzip/zlib，不解析 ZIP 归档。Brotli 不在本次范围。

zlib 系列接收字符串、ArrayBuffer/SharedArrayBuffer 或视图，保留视图偏移。选项接入 level、windowBits、memLevel、strategy、dictionary、chunkSize、flush、finishFlush、maxOutputLength、rejectGarbageAfterEnd；同步结束实际使用 finishFlush。解压错误保留 Node 的 Error、code、errno；结果超限为 RangeError/ERR_BUFFER_TOO_LARGE；严格尾随检查为 TypeError/ERR_TRAILING_JUNK_AFTER_STREAM_END。全局 Buffer 和单次结果仍受当前 2 GiB-1 上限约束。

Zstd 使用 params/constants 结构、字典、pledgedSrcSize 和共同的缓冲/结束选项。参数检查失败与此 Node 基线一致，为 ERR_ZLIB_INITIALIZATION_FAILED；数据错误使用具体 ZSTD_error_* 名称及数字 errno，截断为 Z_BUF_ERROR。非零 nbWorkers 明确报 ERR_NOT_SUPPORTED，避免原生库线程调用 QuickJS 分配器。编译仍保留固定后端原有多线程代码；启用它需要后续任务分配器合同。info:true 需要真实流引擎，当前明确拒绝，类型也不声明支持。

constants 仅列当前 zlib/Zstd 合同，ZLIB_VERNUM 来自实际原生头文件；不导出未接入的 Brotli 常量。codes 提供 zlib 名称和数字的双向只读映射。

## 帧与边界

| 格式 | 当前同步合同 |
| --- | --- |
| gzip | 默认解码拼接成员；首个零填充字节后停止；非零垃圾按下一成员尝试并报错。严格模式拒绝首个成员后剩余内容，包括其他成员和零填充 |
| zlib / raw deflate | 默认停在首个流结束，允许剩余内容；严格模式拒绝剩余内容。支持对应格式的预置字典 |
| Zstd | 跟随 v24.21.0 同步缓冲循环：输出缓冲区未填满时停在当前帧，包括可跳过帧；填满时继续处理剩余输入。因此串联结果会受到 chunkSize 影响。严格模式拒绝未消费输入；要求完整结束时拒绝截断 |
| LZ4 扩展 | 标准 Frame，接收串联帧和可跳过帧；拒绝损坏、截断及非帧尾随数据，不接受 raw block |
| bzip2 扩展 | 接收串联完整流；拒绝损坏、截断及非流尾随数据 |

不要求不同版本后端产生相同压缩字节；互操作验证解码内容。CRC、帧校验和及头部损坏测试独立于往返测试。允许 Z_SYNC_FLUSH 等非最终结束选项时，zlib 可以返回截断输入的已解码前缀，保持基线行为。

`cosmo:compression` 提供 lz4CompressSync/lz4DecompressSync、bzip2CompressSync/bzip2DecompressSync、crc32c、adler32、codecInfo。LZ4 压缩选项为 level 0—12、checksum、blockSize 0/4/5/6/7；bzip2 为 level 1—9，解压可选 small。共同支持 maxOutputLength/chunkSize。扩展字典、params、flush/finishFlush 不支持，传入会明确拒绝；bzip2 的块格式/校验和不能通过 LZ4 选项更改。CRC32C 初始值默认 0，Adler32 默认 1，都可用上次结果续算；CRC32C 与 node:zlib 的 IEEE CRC32 分开。

codecInfo() 每次返回新数组，依次列 zlib/zstd/lz4/bzip2 的 name、format、backend、version；传名称返回对应新记录。不存在的名称抛 ERR_INVALID_ARG_VALUE。扩展格式错误使用 ERR_COMPRESSION_DATA，输出超限与 Node 侧同为 ERR_BUFFER_TOO_LARGE。

## 内存、SDK 与 bzip2 适配

计算 core 不依赖 JSContext，分配器通过参数传递；绑定仅在所属运行时线程执行。后端工作区和输出堆分配计入 QuickJS 的真实配额，显式对齐原生数据，每块内存记录所属分配器，最终 ArrayBuffer 直接持有该内存。输出动态增长，最多多留一个探测字节；不依据不可信的帧内容大小预分配完整输出。maxOutputLength 限制结果，工作内存同时受运行时总配额约束。

zlib/bzip2 用各自分配回调，Zstd 用 customMem；旧 LZ4 的 malloc/calloc/realloc/free 仅在私有链接闭包中包装。结果或分配失败后释放上下文、部分输出和后端缓冲。SDK 对两个架构都只公开 js_cosmo_compression_api，后端定义局部化；不交付原始候选档案，不含 CLI、BZ2 文件接口或未受配额控制的 malloc/free 引用。build.json 记录命令、输入、对象哈希、未解析依赖和两个 bzip2 包含源的校验值。

Nightly 的 huffman.c 和 blocksort.c 将六个固定小数组改成 gc(calloc(...))，既未检查分配失败，又由 libc GC 按普通堆指针释放。直接包装堆分配会导致非空压缩崩溃。私有翻译单元对这两份校验过的源恢复固定自动工作空间：单数组编译期上限 2064 字节，Huffman 合计 5168 字节，排序合计 3072 字节。没有修改算法或原始上游目录；状态和大块缓冲仍走配额分配器。构建拒绝变化的源哈希、非固定/变大的数组以及遗留的 libc GC 依赖。SDK 分配失败测试覆盖压缩主排序路径，验证无未检查的堆失败。

运行时模块不依赖宿主动态库。三文件发布 ZIP 仍保留全部库许可于 readme，SDK 保留 NATIVE-MODULES-LICENSES。

## 验收

三组同源 Node 差分覆盖格式、偏移视图/ArrayBuffer、字典、参数、返回值、错误类别/代码/errno、拼接、跳过帧、尾随内容、截断、校验和及结果边界。runtime_compression 追加 LZ4 Frame/bzip2 的空输入、块边界、多帧、损坏、校验和、输出上限、增量校验和与 Worker；同一用例还编译为独立 APE。

手工 SDK 对六种格式的压缩/解压逐次注入每一个原生分配失败，核对部分分配立即清理、运行时配额、输出超限、宿主 opaque 保留和多次运行时销毁。生产 bzip2 测试输入大于 10000 个非重复字节，覆盖主排序工作空间。

独立互操作在 Linux 构建机运行，30 个长度/格式组合双向比较。zlib/gzip/raw/bzip2 使用 Python 标准库；Zstd 与固定 Node 双向交换帧；LZ4 使用独立的官方 1.10.0 源。该测试工具的归档及官方 SHA256 锁在 compat/dev-tools.json，仅以宿主 C 编译器构建测试共享库，不链接或分发到运行时。报告记录来源、源文件/工具哈希、编译器及每组方向，矩阵继续使用同一生产 APE 做运行时验收。

参考：[Node v24.21.0 zlib](https://nodejs.org/download/release/v24.21.0/docs/api/zlib.html)、[相同版本原生适配](https://github.com/nodejs/node/blob/v24.21.0/src/node_zlib.cc)、[独立 LZ4 1.10.0](https://github.com/lz4/lz4/releases/tag/v1.10.0)。异步接口留在 M3-02，流留在 M3-05；完整 CI 通过后才进入 M2-05。

本地最终验收：Linux 72/72；Windows 同一批产物 58/58，另保留一个既有 Unix 专用跳过；两端 Node 差分各 24/24。独立互操作 30 组双向通过，80 项 Python 门禁、TypeScript 两种 lib 配置、17 个 APE 的传输清单和三文件发布 ZIP 校验通过。提交 `af6ddca` 的[完整 CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40493866543)已通过构建、七个平台和最终门禁。
