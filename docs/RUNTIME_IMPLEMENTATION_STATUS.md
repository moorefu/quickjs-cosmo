# 运行时实施状态

以 [NODE_COMPAT_RUNTIME_PLAN.md](NODE_COMPAT_RUNTIME_PLAN.md) 为范围。执行规则：按顺序逐项实现与本地验收，提交推送，确认该提交完整 CI 全绿后再开始下一项；失败先修复当前项，不绕过门禁。

| 任务 | 状态 | 证据/交付 |
| --- | --- | --- |
| M0-01—M0-04 | 完成，CI 全绿 | `17204b6`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40426810729)，[记录](M0_FOUNDATION.md) |
| M1-01 模块注册 | 完成，CI 全绿 | `33ea75f`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40430982438)，[记录](M1_MODULE_REGISTRY.md) |
| M1-02 Buffer/编码 | 本地验收完成，等待本项提交的 CI | [记录](M1_BUFFER_ENCODING.md)；本项通过前不开始 M1-03 |
| M1-03 公共基础 | 待实现 | process/path/os、console、EventEmitter、util/assert |
| M1-04 调度合同 | 待实现 | 任务/微任务顺序、定时器、存活与 ref/unref |
| M2-01 原生构建 | 待实现 | 固定同提交后端，双架构 E1/E2 |
| M2-02 同步 fs | 待实现 | 高层、目录、描述符、元数据 |
| M2-03 摘要与 KDF | 待实现 | 哈希、HMAC、派生、随机与比较 |
| M2-04 同步压缩 | 待实现 | zlib、Zstd、LZ4、bzip2 与校验和 |
| M2-05 同步子进程 | 待实现 | spawnSync/execFileSync/execSync |
| M3-01 原生任务调度 | 待实现 | 有界队列、唤醒、取消与销毁 |
| M3-02 异步 fs/算法 | 待实现 | callback、Promise 与非阻塞验收 |
| M3-03 Stream | 待实现 | 流对象、背压、pipeline/finished |
| M3-04 异步子进程 | 待实现 | ChildProcess、stdio、事件与终止 |
| M3-05 文件/算法流 | 待实现 | 文件、Hash/Hmac、压缩 Transform |
| M4-01 密钥与 AEAD | 待实现 | KeyObject/DER/PEM、Ed/X25519、Cipher |
| M4-02 扩展摘要 | 待实现 | SHA3/SHAKE/BLAKE2s |
| M5-01 DNS/TCP/URL | 待实现 | lookup、Socket 与 URL |
| M5-02 TLS 审计 | 待实现 | 新 Nightly、旧缺陷、CA 与 SDK 范围 |
| M5-03 TLS 接入 | 待实现 | 客户端 TLS、证书、SNI 与取消 |
| M5-04 HTTP/Fetch | 待实现 | HTTP/1.1 与 Fetch 声明子集 |
| M5-05 HTTPS | 待实现 | TLS/HTTP 集成与故障清理 |
| M6-01 全入口交付 | 待实现 | 全部已启用能力的 Worker/qjsc/SDK/包验收 |
| M6-02 CI 与发布 | 待实现 | 全目标矩阵、能力清单与发布产物 |
| M6-03 文档与类型 | 持续更新，最终验收待完成 | 已增加 Buffer 与 cosmo:runtime 类型 |

局部实现与平台差异由 `compat/node-api.json` 描述；本表不以“已有同名导出”替代任务退出条件。未完成任务继续保持待实现，TLS 如遇真实准入阻碍需按规划记录并解决，不能伪造通过。
