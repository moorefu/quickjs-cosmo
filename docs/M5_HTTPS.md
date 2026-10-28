# M5-05 HTTPS

状态：实现及本地验收完成，等待完整 CI；本项完整 CI 全绿后进入 M6-01。

## 接入范围

`node:https` / `https` 共享实例，提供 request/get、Agent 和 globalAgent。HTTP/1.0/1.1 的消息解析、请求写入、IncomingMessage、ClientRequest、队列和背压沿用 M5-04；返回对象具有 `node:http` 的真实类身份。TLS 连接来自 M5-03 的客户端，握手及证书/身份验证完成前不发送应用数据。Fetch 同时处理 http: 和 https:，支持两种协议间的重定向、敏感头清除、流式解码与 signal 取消。

HTTPS 按 DNS 主机自动提供 SNI，IP 目标不发送 SNI，仍验证 IP SAN；显式 servername 决定 SNI 和验证身份。Agent 的池键包含实际目标、CA、验证身份和 SNI。排队前保存连接选项及 CA 字符串快照，避免 Agent.options 或调用方 CA 数组后续修改使连接策略与池键脱节。错误 CA、错误 SNI/证书不能借用另一个策略的连接。两端协议及 Agent 需要匹配；不声明 Node 按 Agent 覆盖模块协议的全部隐式行为。

默认 globalAgent 的 keepAlive=false；显式 keepAlive 可顺序复用连接，空闲连接 unref 并回收。每 Runtime 总连接上限 32，Agent 队列上限 128。不提供服务端、代理、升级、HTTP/2、ALPN、客户端证书、TLS session 导入/缓存或自定义认证。maxCachedSessions 只接受 0；默认也是 0。协议和套件、mandatory verification、CA 清单及来源限制继续遵守 [TLS 审计](M5_TLS_AUDIT.md)和 [TLS 客户端](M5_TLS_CLIENT.md)。

完整响应已收到且对端 EOF 时，释放传输和原生连接，同时保留 IncomingMessage 中尚未被消费的字节。Fetch body 的取消独立于传输关闭；已缓存但尚未消费的 body 及其 clone 仍响应 signal.reason，监听器在 body 关闭/失败时移除，并通过弱引用避免信号反向保活 body。调用方仍须消费或取消有背压的大响应；不提供依靠不确定 GC 时机取消网络请求的保证。

## 额外 CA

每个 Context 初始化时读取 NODE_EXTRA_CA_CERTS，支持不超过 3 MiB 的有效 PEM 文件。验证文件后追加到固定的 118 个 Mozilla 根；不读取宿主证书库。显式 ca 替换全部默认/额外 CA。现存 Context 初始化后修改环境变量不会改变已加载的信任集，QuickJS Worker 按自己的启动环境初始化。文件不可读、无效或超过配额时发出 warning 并保持固定默认根。拒绝整份存在解析错误的额外 PEM，不提供 Node 对混合损坏输入的全部容错行为。

额外 CA 的读取、预付 arena 及 JS 对象分配在 owner 线程执行。PEM 检查使用现有私有 TLS 后端，arena 仍为有界的 8 MiB；不增加第三方源码或通用 TLS SDK 接口。默认 CA 字节和校验入口只通过内部 vtable/native 对象传递，公共 node:tls 导出仍为 connect/TLSSocket。

## 验收

同源测试包括 HTTPS 模块身份、HTTP 类身份、Agent 继承、连接复用、CA/SNI 池隔离、证书失败、跨协议重定向、gzip/损坏、握手 abort/timeout、读取取消、未消费完整 body 的退出、CA 环境快照和额外 CA 文件失败。

Node 服务使用动态生成的短期本机证书、TLS1.2 和关闭 session ticket 的完整握手，不把 Node 的 session cache 与本项目未启用的缓存混为同一能力。独立 Python ssl 服务另验 IPv4/IPv6、源码、Worker、qjsc 和手工 SDK。SDK 包含 owner 分配、EINTR/EAGAIN、部分 I/O、循环 GC、异步关闭与存活 Context teardown；不以定时器到期代替 fd 释放断言。

类型与正反向编译例位于 types/https.d.ts、tests/types/https.ts。

本地最终验收（2026-10-28）：

- 固定输入完整离线构建通过；原生 SDK 与 qjsc 编译检查通过。夹具修正后，Linux 使用最终 41 个独立 APE 再执行全入口检查，87/87 通过、无跳过；同一批 APE 在 Windows 89/89 通过，仅跳过 Unix shell 用例，该项已在 Linux 通过。
- Node v24.21.0 同源差分两端均 56/56，含直接/克隆 body 的延后取消；调度生命周期均 19/19。
- HTTPS 源码、Worker、qjsc、手工 SDK 与双架构 SDK 边界通过，包含 IPv4/IPv6、owner 分配、部分 I/O、EINTR/EAGAIN、GC、异步关闭和 Context 销毁。
- Python 工具测试 97 项通过；TypeScript 5.9.3 的 ES2022 与 ES2022+DOM 正向/反向类型检查通过。
- 三文件 ZIP 为 9,095,328 字节，SHA-256 `04228a0c737e459bdd413c25fc8a6deff02e2a84de1f9a73f5406bd812badd50`；CI 传输清单及完整性校验通过。
- API 清单为 29 个模块、65 个全局条目、682 个 API、70 个测试记录；条目数不表示 Node 兼容率。

报告位于 build/test-results/、build/node-compat/ 与 build/native/https/probes.json；最终七平台结果以本项完整 CI 为准。
