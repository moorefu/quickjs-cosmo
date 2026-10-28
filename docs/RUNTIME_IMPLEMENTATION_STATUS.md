# 运行时实施状态

以 [NODE_COMPAT_RUNTIME_PLAN.md](NODE_COMPAT_RUNTIME_PLAN.md) 为范围。执行规则：按顺序逐项实现与本地验收，提交推送，确认该提交完整 CI 全绿后再开始下一项；失败先修复当前项，不绕过门禁。

| 任务 | 状态 | 证据/交付 |
| --- | --- | --- |
| M0-01—M0-04 | 完成，CI 全绿 | `17204b6`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40426810729)，[记录](M0_FOUNDATION.md) |
| M1-01 模块注册 | 完成，CI 全绿 | `33ea75f`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40430982438)，[记录](M1_MODULE_REGISTRY.md) |
| M1-02 Buffer/编码 | 完成，CI 全绿 | `c41097f`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40434897922)，[记录](M1_BUFFER_ENCODING.md) |
| M1-03 公共基础 | 完成，CI 全绿 | `0bd7b38`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40448736721)，[记录](M1_FOUNDATION.md) |
| M1-04 调度合同 | 完成，CI 全绿 | `1f467a4`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40454177787)，[记录](M1_SCHEDULING.md) |
| M2-01 原生构建 | 完成，CI 全绿 | `d2fdfc2`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40462993919)，[记录](M2_NATIVE_BUILD.md) |
| M2-02 同步 fs | 完成，CI 全绿 | `3d743bc`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40476137441)，[记录](M2_FS.md) |
| M2-03 摘要与 KDF | 完成，CI 全绿 | `4b19b83`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40487013603)，[记录](M2_CRYPTO.md) |
| M2-04 同步压缩 | 完成，CI 全绿 | `af6ddca`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40493866543)，[记录](M2_COMPRESSION.md) |
| M2-05 同步子进程 | 完成，CI 全绿 | `c676727`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40509058444)，[记录](M2_PROCESS.md) |
| M3-01 原生任务调度 | 完成，CI 全绿 | `d413b69`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40516679598)，[记录](M3_TASK_POOL.md) |
| M3-02 异步 fs/算法 | 完成，CI 全绿 | `5877ce7`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40537555777)，[记录](M3_ASYNC.md) |
| M3-03 Stream | 完成，CI 全绿 | `362a2af`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40546141176)，[记录](M3_STREAMS.md) |
| M3-04 异步子进程 | 完成，CI 全绿 | `dab3a8a`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40569582305)，[记录](M3_CHILD_PROCESS_ASYNC.md) |
| M3-05 文件/算法流 | 完成，CI 全绿 | `f90d02d`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40581885448)，[记录](M3_FILE_ALGORITHM_STREAMS.md) |
| M4-01 密钥与 AEAD | 完成，CI 全绿 | `111ec61`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40603741483)，[记录](M4_KEYS_AEAD.md) |
| M4-02 扩展摘要 | 完成，CI 全绿 | `a7e6da7`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40609066017)，[记录](M4_EXTRA_DIGESTS.md) |
| M5-01 DNS/TCP/URL | 完成，CI 全绿 | `df2e2f8`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40628025488)，[记录](M5_NETWORK.md) |
| M5-02 TLS 审计 | 完成，CI 全绿 | `c254a54`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40639261668)，[记录](M5_TLS_AUDIT.md) |
| M5-03 TLS 接入 | 完成，CI 全绿 | `f1494c1`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40648737327)，[记录](M5_TLS_CLIENT.md) |
| M5-04 HTTP/Fetch | 完成，CI 全绿 | `9cdc98b`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40670191020)，[记录](M5_HTTP_FETCH.md) |
| M5-05 HTTPS | 完成，CI 全绿 | `68373b7`，[CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40684836385)，[记录](M5_HTTPS.md) |
| M6-01 全入口交付 | 本地验收通过，待 CI | 标准流、入口边界、状态回收；Linux 139/139、共享 APE 92/92、Windows 94/94；[记录](M6_DELIVERY.md) |
| M6-02 CI 与发布 | 待实现 | 全目标矩阵、能力清单与发布产物 |
| M6-03 文档与类型 | 持续更新，最终验收待完成 | 已增加 Buffer、公共基础、调度/取消与 cosmo:runtime 类型 |

局部实现与平台差异由 `compat/node-api.json` 描述；本表不以“已有同名导出”替代任务退出条件。未完成任务继续保持待实现，TLS 如遇真实准入阻碍需按规划记录并解决，不能伪造通过。

M5-01 的 SDK 循环 GC 用例已确认并修复 Timer 状态回指，以及销毁流保留活动写回调的问题。M6 继续复核其余私有状态表、各入口与平台差异。
