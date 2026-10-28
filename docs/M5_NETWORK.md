# M5-01 DNS、TCP 与 URL

使用固定 QuickJS 2026-06-04 与 Cosmopolitan Nightly #802；Node 差分工具仍为 v24.21.0。状态及完整 CI 证据见 [实施状态](RUNTIME_IMPLEMENTATION_STATUS.md)。

## 交付范围

- `node:dns` / `dns`：异步 `lookup`、`promises`、结果顺序与三种 hints 常量。`node:dns/promises` / `dns/promises` 共享同一个 Promise 外观和 Context 内的默认顺序。
- `node:net` / `net`：TCP 客户端 `Socket`、`connect/createConnection`、IP 检查、自动地址选择默认设置。Socket 继承 Duplex，支持连接前写入、背压、半关闭、超时、AbortSignal、取消、ref/unref、keepalive/noDelay、端点与字节统计。
- `node:url` / `url` 与同实例全局 `URL/URLSearchParams`：绝对/相对 URL、组件与 setter、实时查询参数、文件 URL、Punycode 域名转换。fs 同步/异步路径接受运行时 URL。

接口清单与逐方法差异位于 `compat/node-api.json`，声明位于 `types/network.d.ts`。不引入公开 `require()`、npm 加载或旁挂 JS。

## 后端与资源合同

DNS 使用同一 Nightly 的 `getaddrinfo/freeaddrinfo`，放入已有的两个后台工作线程和有界任务队列。输入在所有者线程复制，结果最多保留 64 个去重地址，JS 对象在所有者线程生成。运行中的系统 resolver 无法被强行中断；取消连接会丢弃后续结果，Context/Runtime 销毁等待系统调用结束。

TCP 使用同一 Nightly 的非阻塞 socket、poll、send/recv、shutdown 和宿主错误转换。每个 Runtime 最多 32 个原生连接，每个连接使用一个原生泵线程，以及读写方向各 64 KiB 的缓冲区。所有 JS 分配与回调留在所有者线程；关闭先停止并 join 线程，再释放 Context、回调与缓冲区。队列、流缓冲和 QuickJS 总内存配额继续生效。地址选择采用顺序回退和尝试超时，不承诺 Node Happy Eyeballs 的全部时序。

固定 Nightly 的 Windows `SO_ERROR` 存在返回原始 Winsock 数值的路径，绑定显式使用同版本错误转换；macOS 的该输出也转换到内部 errno。Windows 管道轮询会让任务唤醒多等待一个采样周期，主事件循环等待上限收紧为 10ms，以通过强制短读写场景。

GC 回归发现了已结束写回调和 Timer 状态的回指：销毁流会清除活动写入，Timer 私有状态改由实例持有，使已取消/结束的回调循环可由 QuickJS 回收；保留定时器 refresh/ref/unref 合同。

## URL 与来源边界

Nightly 无现成 Punycode 后端；复用固定 Node v24.21.0 原始 `lib/punycode.js`（实现版本 2.1.0），源码和许可摘要锁定在 `compat/node-sources.json`，MIT 声明随 SDK 交付。该私有实现已有 Node 使用与上游测试基础，本项目另以同源 JS 验证非 ASCII 域名、URL、参数与文件路径。

URL 是经测试的 WHATWG 子集，尚未实现完整 WPT/UTS46/Bidi 表。域名转换包含 NFKC、大小写、点分隔符及常见忽略字符映射、Punycode 与 IP 规范化；不接受 contextual joiner。不能将它当作完整 Unicode 域名安全策略或浏览器 URL 一致性保证。提供 HTTP(S)/FTP/WS(S)/file、非特殊层级和 opaque URL 的声明范围；不提供旧 `url.parse/format/resolve` 或 Blob URL。

TCP 服务端、UDP、IPC、外部 fd、带 zone 的 IPv6 连接和已销毁 Socket 重连均不在本项子集。IPv6 字符串识别与 IPv6 loopback 客户端受测试。TLS、HTTP 与 Fetch 等待后续独立任务。

## 验收

- NET-001：字面 IP、空主机、family/hints/order/all、回调和 Promise、localhost、验证和 NUL。
- NET-002：IPv4/IPv6 动态端口回显、事件、端点、字节、拒绝连接、空闲超时、IP 与默认设置。
- NET-003：1 MiB 数据、暂停/恢复、drain、半关闭后写入、AbortSignal、迟到 lookup、地址回退、并发、慢接收端取消和 RST。
- NET-004：URL 组件、相对路径/setter、实时参数、百分号/UTF-8、Punycode、Windows/POSIX 文件路径与错误。
- NET-005：Python 动态 loopback 服务驱动 source、Worker 和 qjsc 内嵌程序，包含取消 ref 后正常退出；fs 双模式文件 URL。
- SDK：原生 loopback 服务，强制短 send/recv、EINTR/EAGAIN；延迟 DNS 期间定时器推进、EAI_AGAIN 与 EAI_SYSTEM 权限错误映射；分配线程归属、重复循环 GC、32 连接配额、连接 OOM、带活动 DNS/Socket 的 Context 和 Runtime 销毁。测试专用包装不进入产品。

差分服务由锁定 Node 工具启动，源文件、Worker/qjsc 的服务由 Python 标准库启动。生产运行包不依赖这些工具，也不依赖公网服务。

最终本地验收：Linux 113/113；Windows 83/83，另跳过一项 Unix 专用检查。两端 Node 同源差分均为 46/46、调度生命周期均为 19/19。Python 83 项检查和 TypeScript 5.9.3 的 ES2022、ES2022+DOM 声明用例通过。三文件发行包、双架构 SDK、31 份独立程序与两份后端探测 APE 的传输包完整性校验通过。接口清单包含 29 个模块、548 项 API 与 60 个测试条目，不以条目数量表示兼容率。等待本项提交的完整七平台 CI。
