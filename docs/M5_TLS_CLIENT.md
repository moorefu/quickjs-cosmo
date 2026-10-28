# M5-03 TLS 客户端

状态：本地完整验收通过，等待本项提交的完整七平台 CI。

`node:tls` 与裸 `tls` 使用同一模块实例，导出 `connect`、`TLSSocket`。接口以固定 [Node v24.21.0 合同](https://nodejs.org/download/release/v24.21.0/docs/api/tls.html)为参照。TLS1.2、算法及证书策略继承 [M5-02 审计](M5_TLS_AUDIT.md)。

## 已接入范围

- `connect(options, callback)` 与 TCP 端口重载；异步 DNS、IPv4/IPv6、连接回退及取消复用 `node:net`。
- `TLSSocket` 继承 `Socket` / `Duplex`；`connect` 表示 TCP 建立，`secureConnect` 表示证书与握手验证成功。应用写入等待握手完成，读取的是解密数据。
- `ca` 接受 PEM 字符串、Buffer 或数组，并替换默认 CA。默认信任仅为固定的 118 个 Mozilla 根；不读取宿主证书库及 Cosmo 开发证书。
- 证书的有效期、用途、签名、链、DNS 名称/IP SAN 均验证。DNS 验证复用固定 Nightly 的名称匹配器；IP 只匹配对应地址族的 iPAddress SAN。
- `servername` 提供 DNS SNI 并作为验证身份；省略时按 `host` 验证且不发送 SNI。IP 身份不发送 SNI。
- `getProtocol`、`getCipher`、`isSessionReused`、`encrypted`、`authorized` 和 Socket 的流、超时、ref/unref 接口。

## 边界与明确差异

- 仅 TLS1.2 和审计中的四个 ECDHE + AES-GCM 套件；不协商 TLS1.3、CBC、RSA 密钥交换。协议配置只接受 TLS1.2。
- 必须验证证书。`rejectUnauthorized:false`、自定义身份回调、客户端私钥/证书、PSK、会话导入、ALPN、套件修改、包装已有 Socket/STARTTLS 和服务端接口均未启用。
- 对端未发送 TLS close_notify 的裸 TCP EOF 作为截断错误；错误文本与 OpenSSL 不同。证书错误尽量采用对应 Node code，多个同时存在的证书故障可能具有不同优先级。
- 根证书仅接受严格完整解析的 PEM，输入上限 4 MiB；不会默默忽略其中损坏的条目。
- `getProtocol()` 在握手成功前返回 null；Node 可能返回其配置的最大协议版本。未连接构造对象的状态字段尚未逐项对齐。单个 TLSSocket 仅允许一次 connect。

## 原生资源与 SDK

每个 TLS 连接在 owner 线程预付 8 MiB 工作区，由同一 Socket pump 线程解析根证书、握手和收发。后端的 malloc/calloc/free 及 Nightly MPI 的 realloc_in_place 都限定在该区内；释放时擦除。工作线程不调用 QuickJS 分配器或 JS 回调。

主动关闭先请求工作线程停止，由 owner 收到完成通知后释放连接并结束流的关闭回调。Context/Runtime 销毁会停止并 join 工作线程。连接数沿用 TCP 每 Runtime 32 个的限制；工作区受 JS 内存上限约束。

双架构 `qjs-tls.o` 通过部分链接及符号本地化仅导出项目内部 vtable；通用 mbedTLS 归档、头文件及符号不交付。固定 CA 的 MPL2 许可加入 SDK 原生许可汇总。原始上游源码不变。

## 验证入口

`scripts/test_tls_client.py` 使用固定 Node 生成临时证书，通过本机 Python TLS 服务比较 Node 与 qjs 的同源测试；服务使用动态端口且证书和私钥仅保存在临时测试目录。

- 12 组同源场景：240123 字节双向传输、RSA/ECDSA、无 SNI、IPv6、DNS/IP SAN/CN 错误、有效期、不可信链、AbortSignal 与超时。
- qjsc 独立程序执行相同 12 组；源程序与独立程序均包含 Worker 握手/收发与裸别名身份检查。
- 手工 SDK：强制部分 send/recv、EINTR/EAGAIN、RNG 失败、工作区预付 OOM、非法 CA；32 KiB—8 MiB 后端工作区的耗尽与两端 canary；循环 GC 和握手中 Context 销毁，验证 fd 回收及 JS 分配器线程归属。
- M5-02 的 73 条安全断言与 31 组协议、套件和证书策略用例继续运行；SDK 两个架构仍禁止通用后端符号/头文件/归档。

最终本地回归：Linux 120/120；Windows 86/86，另跳过一项 Unix 专用检查。两端 Node 差分 47/47、调度生命周期 19/19；Python 94 项检查及 TypeScript 5.9.3 的 ES2022、ES2022+DOM 声明用例通过。

38 份独立/探测 APE、双架构 SDK、来源/许可/符号闭包及三文件发行包的 CI 传输完整性验证通过。发行 ZIP SHA-256：`6230f478c93ba8458b60f74394f58694df4b4d91b98f1157e074704482105aee`。待该提交完整 CI 全绿后进入 M5-04。

首轮 `3c62faf` CI 有 6/7 平台通过，macOS Intel 的独立程序取消用例先于 TCP connect 触发了 40 ms 定时器，事件轨迹因此与已建立连接的 Node 不同。测试现改为 connect 后再取消/超时，固定验收握手中的取消，不依赖宿主启动耗时；取消用例还强制 lookup 延迟 100 ms，断言已经建立 TCP，仍逐项比较完整事件、错误和关闭状态。
