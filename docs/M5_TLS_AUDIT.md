# M5-02 固定 Nightly TLS 安全准入

审查日期：2026-10-28。固定输入仍为 Cosmopolitan Nightly #802 / `aefad27c09ffda64c6ac64bd69f758e9f9c7b91d`，其定制 Mbed TLS 版本标签为 2.26.0。本项不更换工具链或密码库版本。

## 结论与范围

本项审查已交付的 JS crypto、实际 SDK 闭包，以及供 M5-03 复用的私有 TLS 1.2 策略候选。通用 Mbed TLS 仍有 14 项未修复的旧报告问题，**不准入通用静态库、通用头文件或任意 Mbed TLS 用法**。这些问题未被改写成“已经修复”。

当前 SDK 在两个架构均没有公开 `mbedtls_*`、`Hacl_*` 或 `Everest_*` 后端符号，交付目录也不含通用后端归档或头文件。`scripts/probe_tls.py` 将此边界作为失败即停止的检查。TLS 候选归档只保留在 `build/native/tls/`，用于安全探针和后续封闭 binding；本项仍不注册 `node:tls`。M5-03 必须继续保持该边界，并使用本项策略及回归。

审查覆盖官方目录中 2021 年起的 55 条公告、固定编译配置和所声明调用路径；不构成整个密码库、早期公告继承、长期模糊测试或侧信道形式化验证的认证。官方输入来自[公告目录](https://mbed-tls.readthedocs.io/en/latest/security-advisories/)及[固定文档提交](https://github.com/Mbed-TLS/mbedtls-docs/tree/abe4067e3f2069efc394ea362c46ce7d8998c5ce/security-advisories)。其中 54 份原文摘要与旧审查一致；TLS 1.3 HRR 公告原文摘要有变化，重新核对后仍不适用于本项未启用 TLS 1.3 的配置。

## 与旧快照逐项对照

`native/tls/reference-comparison.json` 比较 4.0.2 与 Nightly 的 168 个顶层 Mbed TLS 源文件/头文件：仅 endian.h、everest.c、gcm.c、ssl_tls.c、x509.h 不同。关键 x509_crt.c、ecdh.c、ssl_internal.h 与旧快照未修复版本逐字节相同，不能因 Nightly 较新便视作已修复。

`native/tls/advisories.json` 按公告分别记录原始后端、JS crypto、SDK 与客户端候选的结论，保留全部来源摘要。分类为 14 项原始后端残余、4 项补丁、27 项版本/配置不适用、8 项集成约束及 2 项 Cosmo 特有路径。下列四项及 Cosmo PRF 的 NULL 清理均在私有源码覆盖层修复：

| 问题 | 本项处理与负向证据 |
| --- | --- |
| CVE-2025-27810 / Finished 错误传播 | Finished 回调返回 int；发送/解析先检查结果，SHA256/384 hash 与动态 PRF 错误逐级传播，失败不消费握手状态 |
| Cosmo PRF 分配失败 | 三个分配点故障注入；清理前检查临时缓冲指针，避免 NULL 与非零长度擦除 |
| CVE-2021-44732 / 会话 ticket 所有权 | 会话复制后立即断开目标 ticket 别名；证书分配失败后两个会话可独立释放 |
| CVE-2026-35336 / ECDH 输出边界 | 按曲线固定输出长度检查容量；前导零秘密的 31 字节输出拒绝，金丝雀不变，32 字节成功 |
| CVE-2026-49300 / basicConstraints | 严格 SEQUENCE 边界，不把 INTEGER 当作 CA BOOLEAN；直接 DER 与完整签名证书分别覆盖畸形输入 |

补丁 `native/tls/mbedtls-security.patch` 已重新基于实际 Nightly 生成，保留其序列化宏变化。Unified diff 的空上下文行保留必需的空格前缀，按该文件设置 whitespace 例外，避免格式整理改变已锁定字节。原始/修改后摘要、配置、167 文件候选源码闭包、补丁和 CA 锁位于 `native/tls/security.json`。构建拒绝混合或未知覆盖层、额外遮蔽文件、源码/补丁/CA/许可摘要变化；不修改 pristine 上游目录。

## 当前 JS crypto 与旧报告的区别

当前 Ed25519/X25519 使用已准入 HACL 路径；没有开放 RSA 私钥、长期 Mbed TLS ECDH、证书写入或加密私钥解析。TLS 只使用证书公钥验证和每次新生成的 ECDHE。

当前 JS ChaCha20-Poly1305 使用 Nightly Mbed TLS，不能复制旧分支的 HACL 排除理由。原始 ChaCha 计数器问题仍存在；`native/crypto/aead.c` 在调用后端前限制整个消息不超过 `(2^32-1)*64` 字节。新增原生边界回归直接验证超限拒绝、状态与输出金丝雀；AES-GCM 的总长度界限也纳入同一检查。已有 Node 同源向量与分块合同继续保留。该约束保护绑定，不代表修复通用 ChaCha 库。

## 已编译并验证的客户端策略

`native/tls/policy.c` 是后续 binding 的私有实现，覆盖：

- TLS 1.2，仅四个 ECDHE-RSA/ECDHE-ECDSA AES128/256-GCM 套件；协商组为 X25519、P-256、P-384。
- 强制证书链、时间与身份验证；同时限制握手签名 hash 和证书 profile 为 SHA256/384/512、RSA 至少 2048 位。SHA1 叶证书和 RSA1024 均有实际拒绝用例。
- DNS 检查 `set_hostname` 返回值并发送 DNS SNI；IP 不发送 DNS SNI，叶证书回调强制匹配相同类型、相同长度的 IP SAN。CN 或 DNS SAN 中的 IP 文本不能替代 IP SAN；回调只清除身份位，保留过期、不可信和弱算法等错误。
- 关闭 ticket、会话复用、TLS 压缩和重协商。TLS 1.0/1.1/1.3、CBC、RSA 密钥交换不在允许集合。
- 每次从宿主获取随机数，Linux 使用 GRND_RANDOM，处理短读/EINTR，失败终止；不持有可跨克隆复用的进程级 DRBG。活跃网络期间跨 fork 和 VM 克隆熵恢复的约束继续适用。

这仅批准策略候选。JS 异步连接、取消、上下文销毁、输出流和内存配额仍由 M5-03 接入与验收，不能以本报告替代。

## CA 数据合同

固定 [curl CA Extract 的 Mozilla NSS 快照](https://curl.se/ca/cacert-2026-10-20.pem)，版本日期 2026-10-20，SHA-256 `796f1389bfea13c0ed78f663b765baaff54a508e5483786bd6ece73c5e3e3cbe`，118 张根证书；原字节和 MPL-2.0 声明保留于 `native/tls/ca-bundle.pem` 与 `LICENSE`。

该快照包含 P-521 的 e-Szigno TLS Root CA 2023；固定 Nightly 的默认配置无法解析它。本项仅在私有 TLS 配置中启用 P-521 证书运算，并用独立签名的 P-521 根—RSA 叶证书链及坏签名验证，全部 118 张根可解析。握手组选用仍由上述策略限制。

默认信任拟采用这一固定 Mozilla 集合，不加载 Cosmo 的 redbean 开发根或隐式宿主证书库。更新通过显式版本/摘要变更、重新审查与 CI 完成。M5-03 的用户 `ca` 参数须替换默认集合、严格拒绝解析失败，保留固定默认根与自定义 CA 的差异；本项已经验证用户私有 CA 的成功和默认根对其的拒绝。

## 验收与后续门禁

- 73 条原生断言：Finished、分配失败、会话释放、ECDH、basicConstraints、AEAD 计数器边界。
- 31 组独立 TLS 端点用例：四个允许套件、DNS/IPv4/IPv6、SNI、时间/链/身份/弱算法、禁止版本/套件、RNG 失败、P-521 与坏签名；没有 IPv6 缺失跳过。
- 证书由固定 Node v24.21.0 生成；服务端用 Python 标准 TLS 实现；不新增第三方 Python 证书包或公网测试依赖。私钥只用于临时测试目录。
- 双架构候选和 SDK 全局符号闭包检查。两个安全 APE 加入同产物 CI 传输与七平台验收。

最终本地回归：Linux 116/116；Windows 85/85，另跳过一项 Unix 专用检查。两端 Node 同源差分 46/46、调度生命周期 19/19；Python 90 项检查和 TypeScript 两套 lib 验收通过。35 个独立/探测 APE、TLS 来源与 SDK 闭包记录、双架构 SDK、三文件发行包的传输完整性校验通过。当前 qjs 不启用 TLS，本项发行 ZIP 与 M5-01 字节相同；新的安全候选与探针保持独立。本项等待完整七平台 CI，结果以实施状态和对应报告为准。
