# M5-04 HTTP/Fetch

状态：实现及本地验收完成，等待完整 CI；本项完整 CI 全绿后进入 M5-05 HTTPS。

## 传输与 HTTP 合同

`node:http` / `http` 共享模块实例，提供 request/get、ClientRequest、IncomingMessage、Agent、globalAgent、头值验证及默认头大小。只提供 HTTP/1.0/1.1 客户端；不提供服务端、CONNECT、升级、代理、HTTP/2、IPC 或宽松解析模式。

HTTP 响应头使用固定 Nightly `aefad27c09ff` 的 ParseHttpMessage/GetHttpHeader。六份源码/头文件及许可由 `native/http/sources.json` 锁定，原始源码不变。适配层为 RFC 9110 / Node 允许的 C1 obs-text 保留原始 Latin-1 值，验证时映射为等长 obs-text；名称、版本、状态仍拒绝这些字节。JS 层额外要求 CRLF、合法 token、无折叠、单一 Content-Length，拒绝 CL/TE 冲突和歧义的 chunked 顺序。

解析器的 realloc/free 仅在调用期间使用 owner 的 JS 分配器。Nightly 的 leaf 声明会影响编译器对回调的假设，分配器作用域写入显式保留；SDK 回归包含未知头分配失败，禁止静默丢失头。后端部分链接后本地化符号，只保留项目内部绑定，通用解析器符号和头文件不交付。

ClientRequest 具有 Node 可写行为，但按 Node 合同不属于 Writable 的 instanceof 品牌。IncomingMessage 是真实 Readable，解析固定长度、chunked/trailer 和关闭定界消息；不会先缓存完整响应。暂停读取会暂停 socket，部分消息和截断分别处理。HTTP 不自动跟随重定向或解压。

Agent 支持按目标排队、maxSockets/maxTotalSockets、取消排队项、keepAlive 的顺序连接复用及 destroy；不使用 pipelining。默认 globalAgent 的 keepAlive 为 false，与 Node v24 的默认策略不同；显式 keepAlive 的空闲 socket 不维持事件循环，默认 5 秒回收。每 Runtime 原生 TCP/TLS 总上限仍为 32，每 Agent 排队上限 128。响应头默认 16 KiB，可设 16—32767 字节；trailer 和 chunk 元数据也有 16 KiB 边界。

请求写入等待实际传输并遵守背压。可一次性 end(body) 自动确定长度，也可用 chunked 流上传。请求 CL/TE 冲突、无效长度、实际长度不符均拒绝，不能用 Node 同名接口悄悄发送歧义消息；这是比 Node 默认宽松发送更严格的声明子集。字段序列化只使用一次经校验的快照。

## Fetch 与 Web body

全局 fetch、Headers、Request、Response 独立处理 Fetch 语义，复用上述传输。当前只启用 http:；https: 由 M5-05 接入。支持 Headers 的重复值、Set-Cookie、迭代和网络响应不可变头，Request 的基本元数据、依赖 signal、克隆与 body 转移，Response 的静态构造、克隆和一次性 body 消费。

响应 body 为默认 reader 的 Web ReadableStream 子集，具备锁、read/cancel/releaseLock/closed、异步迭代、tee、拉取与取消；它不是 Node Readable。Request 可发送字节/字符串/URLSearchParams，或带 duplex:half 的 Web stream/异步可迭代输入。支持 text/json/bytes/arrayBuffer；一次性消费上限 32 MiB，流式读取不预缓存完整 body。tee 遵循消费者速率，慢分支仍可能在 JS 堆中积累队列。

Fetch 支持 follow/manual/error 重定向、最多 20 跳、POST/303 方法转换、307/308 字节 body 重放、跨 origin 清除认证和 cookie。流 body 不能在需重放的跳转中重试。gzip、zlib 包装及原始 deflate 以流解码，保留线上 Content-Encoding/Content-Length 头；Brotli、Blob/FormData、完整 Web Streams、Undici dispatcher 和浏览器 CORS/cookie/referrer 策略未声明支持。默认 User-Agent 为 quickjs-cosmo，不继承 Node 的默认连接池/超时策略；应用可使用 AbortSignal.timeout。

取消保持 signal.reason，包含响应读取中的自定义 reason。上传取消主动对输入 reader 调用 cancel(reason) 并释放锁；固定 Node v24.21.0 在本机观察到该情形可不调用输入的 cancel 且保留锁。本项目保留资源清理行为，使用 `fetch-upload-policy.mjs` 单独记录两端结果；不把这项差异计作同语义兼容通过。

## 验收要求

当前同源测试覆盖 HTTP 头/状态、信息响应、Latin-1、分块/trailer、暂停读取、EOF/截断、连接复用、队列取消、超时和 chunked 上传；Fetch 覆盖基础类、body 使用/克隆、Web reader、上传/读取取消、重定向、压缩/损坏及并发。原生 SDK 另验解析器 OOM、分片、部分 I/O、EINTR/EAGAIN、owner 分配、循环 GC、取消与存活 Context 销毁。GC 检查在预热和关闭回调完成后取样，并完成 QuickJS 弱引用/循环对象的后续回收阶段；三组 Runtime 各增加 24 轮混合请求，保持 64 KiB 分配增长及对象数量上限，不以放宽阈值处理回收阶段差异。

本地最终验收（2026-10-28）：

- 完整离线构建通过；Linux 126/126，无跳过；Windows 88/88，仅跳过 Unix shell 上游用例，该用例已在 Linux 通过。
- 固定 Node v24.21.0 同源差分两端均 53/53，调度生命周期两端均 19/19；上传取消差异另存报告，不计入同语义通过数。
- qjs 源码、Worker、qjsc 独立程序和手工 SDK 均通过 HTTP/Fetch 合同，含本机 IPv4/IPv6；同一批独立产物在 Windows 交叉验收。
- Python 工具测试 97 项通过；固定 TypeScript 5.9.3 在 ES2022 与 ES2022+DOM 下的正向/反向类型检查均通过。
- CI 传输包含 39 个独立 APE、两种架构的 SDK、HTTP/TLS 来源报告及许可，打包和完整性验证通过。
- 三文件 ZIP 为 9,088,665 字节，SHA-256 `169364b62dafedaea3ce16e0175c90fab431862b1dab031e384933eb34763ed7`；API 清单为 29 个模块、65 个全局条目、677 个 API、66 个测试记录，数量不表示 Node 兼容率。

报告位于 `build/test-results/`、`build/node-compat/`、`build/native/http/probes.json`；全平台结果继续以本项完整 CI 为准。
