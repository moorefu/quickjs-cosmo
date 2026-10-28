# M4-02 扩展摘要

前置 M4-01 已通过完整 CI：`111ec61`，[运行记录](https://github.com/moorefu/quickjs-cosmo/actions/runs/40603741483)。Node 基线仍为 v24.21.0。

## 来源与准入范围

固定 Nightly#802 的 HACL* 实际源码不包含 SHA3/SHAKE/BLAKE2s；BUILD.mk 中的 sha3 规则不能作为实现存在的证据。本项只引入规划指定的 HACL* v0.3.0 提交 `b5343363688fbe0e3cdc0c488188708f09eb8a14` 中两个生成 C 文件：Hacl_SHA3.c 与 Hacl_Blake2s_32.c。它们与备份提交 `c27a168b` 的对应文件逐字节一致。

从[上游固定提交](https://github.com/hacl-star/hacl-star/tree/b5343363688fbe0e3cdc0c488188708f09eb8a14)核对原始归档，SHA-256 为 `4196291e444e17851aeaf7418ea64ff91870ab8a8baaf6f66a2e9da8306b5a97`。`native/haclstar-extra.json` 列出两个 C 文件、传递头文件依赖与许可证共 22 个文件的原始路径和 SHA-256。vendor 文件保留原字节与原换行，不修改算法；构建拒绝缺失、修改或额外文件。

仓库仅忽略顶层生成的 /dist/，保留 vendor 内的原始 dist 路径。原始生成 C 文件结尾的空行按路径豁免格式检查，避免格式整理改变已锁定源码。原生探针分别校验 Nightly 许可前缀和经过源码锁验证的新增许可内容，发行组合不削弱原有许可完整性检查。

生成算法代码为 MIT，KreMLin 支持头为 Apache-2.0；完整声明合并到 SDK 的 NATIVE-MODULES-LICENSES 和三文件发行包 readme。仅编译这两个 C 文件及本项目适配器，不纳入旧分支的通用 HACL 静态库、其他算法或旧 JS 接口。双架构构建与私有符号闭包检查沿用 M4-01；SDK 只公开 QuickJS binding。

该固定提交的上游测试入口为 [SHA3](https://github.com/hacl-star/hacl-star/blob/b5343363688fbe0e3cdc0c488188708f09eb8a14/code/tests/Hacl.Test.SHA3.fst)、[BLAKE2](https://github.com/hacl-star/hacl-star/blob/b5343363688fbe0e3cdc0c488188708f09eb8a14/tests/blake2-test.c) 及配套 vectors/spec 测试。本项使用下面的独立向量与绑定/SDK 故障测试准入实际交付子集。

## Node 接口

`node:crypto` 的 getHashes、createHash/Hash、Hash.update/digest/copy、crypto.hash 和 Hash Transform 增加 SHA3-224/256/384/512、SHAKE128/256、BLAKE2s256。连同既有摘要共 14 个规范名称；大小写和既有 RSA 摘要别名规则保留。

SHAKE 默认输出分别为 16、32 字节，长度由构造、copy 或 crypto.hash 的 outputLength 指定，接受 0 到 uint32 上限并受 Runtime 分配配额限制。digest 的参数仍是编码。SHAKE copy 不带 options 或仅传 {} 时按固定 Node 基线恢复默认长度，显式长度可改变副本输出，原对象保持自身长度。固定摘要仅接受其正常输出长度。

HMAC/HKDF/PBKDF2 保持既有 MD5/SHA1/SHA2 声明范围，本次不扩大摘要与 keyed/KDF 的全组合；这与算法可作为普通 Hash 使用是独立的支持项。未提供 cSHAKE、KMAC、BLAKE2s keyed/可变输出或其他新扩展接口。

## 增量、复制与资源边界

适配器调用生成代码提供的 Keccak 吸收/置换/挤出，以及 BLAKE2s init/update_multi/update_last/finish，不重写压缩函数或 permutation。状态只保存 sponge/链值、工作区与最多 168 字节尾块。保留最后一个完整块以供 BLAKE2s 最终标记；SHA3 在 final 时由生成代码处理剩余块和标准 padding。copy 直接复制真实增量状态，不缓存全部输入。

输入累计长度在 uint64 边界前检查；速率与块长来自固定算法表，防止把外部任意长度传入旧生成接口的栈缓冲区。SHAKE 输出先通过 QuickJS 配额分配，再消耗状态；OOM 后原对象仍可复制并继续使用。持久分配和生成代码的擦除 hook 接入现有配额/擦除体系，final、GC 与 Runtime 销毁均释放状态，不占用 ContextOpaque。

## 验证

- HASH-006：由 CPython hashlib 固定的 147 组独立向量，涵盖空输入、64/72/104/136/144/168 字节块边界及 8193 字节多块数据；相同 fixture 由 Node 与本运行时分别核验。
- SHAKE 输出长度覆盖 0、短输出、速率边界、多次 squeeze 所需长度；验证 convenience hash、显式/默认 copy、分支更新、Transform、编码与结束状态。
- HASH-005：source、Worker 与 qjsc 内嵌 Worker；类型用例验证长度选项，拒绝 digest(length) 的旧接口形式。
- 现有 crypto SDK 探针扩展到全部七个摘要的构造/copy 分配失败、原对象保留、逐分配擦除与未结束状态销毁；在 8 MiB 内存配额内处理 8 MiB SHAKE 输入，拒绝超配额输出后仍能复制出短摘要。

本地最终验收：Linux 108/108；Windows 80/80，另跳过一项 Unix 专用检查。两端 Node 同源差分均为 42/42，调度生命周期均为 19/19。Python 83 项检查、TypeScript 5.9.3 两套 lib 的声明用例、全部 Worker/qjsc/SDK 检查通过。

三文件运行包、双架构 SDK 与包含 31 个测试/探针 APE 的 CI 传输包通过校验。清单为 29 个模块、479 项 API、56 个测试条目。本项等待完整七平台 CI；全绿后进入 M5-01。
