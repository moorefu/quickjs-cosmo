# M4-01 密钥与 AEAD

前置 M3-05 已通过完整 CI：`f90d02d`，[运行记录](https://github.com/moorefu/quickjs-cosmo/actions/runs/40581885448)。Node 合同基线保持 v24.21.0。

## 接口与范围

`node:crypto` 提供 KeyObject、createSecretKey、createPrivateKey、createPublicKey、generateKeyPairSync，以及 Ed25519 的 sign/verify、X25519 的 diffieHellman。签名、验签与密钥协商支持同步和 callback 形式；callback 复用 M3 的原生任务池，复制输入与密钥后在后台计算。KeyObject 提供 type、symmetricKeySize、asymmetricKeyType、asymmetricKeyDetails、equals 与 export；secret KeyObject 可作为 HMAC、HKDF 和 Cipher 的密钥。

导入/导出支持 RFC 8410 的规范 PKCS8 v0（32 字节 seed）及 SPKI DER/PEM，覆盖 Ed25519 与 X25519，接受 PEM 换行和外部空白。只接受明确列出的编码结构；不宣称通用 ASN.1、JWK、加密私钥、RSA、ECDSA 或其他 PKCS8 变体。Ed25519 算法参数为 null/undefined，不把原始 seed 作为 Node 私钥格式公开。

Cipheriv、Decipheriv、createCipheriv、createDecipheriv 与 getCiphers 提供 AES-128/192/256-GCM、ChaCha20-Poly1305。对象继承 Transform，支持增量 update/final、setAAD、getAuthTag/setAuthTag、setAutoPadding、输入/输出编码及管线错误传播。GCM 接受非空 IV；ChaCha 使用 12 字节 nonce。默认 tag 为 16 字节；显式短 tag 按 Node 子集校验（GCM 为 4、8、12—16，ChaCha 为 1—16），调用者应优先使用完整 tag。

解密 update 会按 Node 语义先输出尚未认证的数据，final 才确认 tag；消费者需等 final/管线成功后使用明文。不存在 tag 或认证失败时 final 必须失败。重复 final、结束后 update/setAAD、重复 setAuthTag 和改变输出编码均有负向测试。

## 后端与适配

全部算法来源均为既定 Cosmopolitan Nightly#802 `aefad27c09ffda64c6ac64bd69f758e9f9c7b91d`。`native/build-inputs.json` 锁定每个源文件 SHA-256 和编译参数；未引入新的第三方算法源码。Ed25519/X25519 使用 Nightly 的 HACL*，AES/GCM 与 ChaCha20/Poly1305 使用其中的 mbedTLS。ChaCha 选用现有增量接口，以支持本次 Node Cipher 的逐块更新；原规划列出的 HACL* one-shot 候选不作为增量接口的模拟实现。

GCM 只需要 AES 块加密，私有 ECB 桥仅提供五个内部 cipher 函数，不接入通用 cipher 注册、RSA、X509 或 TLS。构建检查双架构闭包，只公开 QuickJS binding，检查未解析后端符号并保留许可声明。

固定 GCM 核要求部分块只能出现在最后一次 update。适配层保留最多 15 字节待定输入，已提交状态始终位于 16 字节边界；浅拷贝 GCM 状态预览尾部输出，完整块到齐后提交一次。ECB 桥只读 AES schedule，预览不会修改共享 schedule。不重新实现 AES/GHASH，不缓存或重放全部历史消息。固定 GCM 的 starts 接口一次接受全部 AAD，因此 AAD 在开始消息前按倍增容量保存，受 Runtime 内存配额约束，开始后立即擦除释放。

适配层在读取输入前检查累计消息长度：GCM 上限为 2^36−32 字节，ChaCha 为 (2^32−1)×64 字节，防止计数器回绕后继续复用 keystream。拒绝把超界状态交给固定后端。

## 所有权与故障处理

密钥、AES/ChaCha 状态、AAD、IV 及 HACL 临时分配统一走既有配额分配器；释放前擦除整个原始分配（含私有头）。Cipher final 后立即释放算法状态，GC/finalizer 处理未 final 的句柄。按 Node 的行为，stream.destroy 不撤销独立的手工 update/final 接口；因此该调用之后由 final 或对象回收结束密钥状态生命周期。

KeyObject 导入时自建的字符串编码/PEM 解码 Buffer 在导入结束（包括错误）时擦除，不修改调用者提供的 Buffer。私钥导出的中间原始材料也在封装完成后擦除；用户持有的输入、导出结果和 JS 不可变字符串由用户/引擎管理。

固定 HACL Ed25519 验签实现有一处未检查的 640×8 字节 calloc。适配层进入 HACL 前预付该工作区，失败直接返回 OOM；线程局部、限定调用范围的分配桥将预付块交给该调用。HACL 提前拒绝签名而未使用工作区时也会擦除释放。SDK 注入测试验证预付失败不会进入未检查分配，且正常路径不发生第二次分配。

后台任务只使用 C 算法与预付 arena，不调用 JS API 或 QuickJS 分配器。任务持有独立密钥快照，完成/取消/Runtime 关闭时擦除密钥和 arena；关闭先等待任务，不交付已取消 callback。SDK 验证 ContextOpaque 保留、工作线程无 JS 分配、输出 OOM 及带进行中任务的 Runtime 销毁。

## 基线安全差异

本地固定 Node v24.21.0 / OpenSSL 3.5.8 对 ChaCha20-Poly1305 缺少 tag 的 final 存在接受行为，已经用最小脚本单独复现；[OpenSSL 问题 31285](https://github.com/openssl/openssl/issues/31285) 记录同类问题。[Node 文档](https://nodejs.org/download/release/v24.21.0/docs/api/crypto.html) 的合同要求缺失 tag 时失败。本实现始终拒绝缺失 tag，且拒绝消息开始后的 AAD；[OpenSSL 问题 31188](https://github.com/openssl/openssl/issues/31188) 记录后者的后端状态问题。这些安全条件由独立 runtime 负向用例验证，不以不安全的基线行为生成差分预期。

## 验收

- KEY-001：RFC 8032 Ed25519、RFC 7748 X25519，DER/PEM、KeyObject、随机生成、同步/callback、错误、签名长度与计时器推进。
- AEAD-001：NIST GCM 与 [RFC 8439 §2.8.2](https://www.rfc-editor.org/rfc/rfc8439#section-2.8.2) 向量，四个算法逐字节增量、AAD、IV/tag 长度、编码和 Transform。
- AEAD-002：参数与状态、篡改、认证错误、tag 快照、重复调用及管线失败；Node 同源差分。
- KEY-002：缺失 tag、晚 AAD、明确拒绝未启用格式，source/Worker/qjsc 入口；SDK 另验证擦除、OOM 和关闭。

本地最终验收：Linux 105/105；Windows 78/78，另跳过一项 Unix 专用检查。两端 Node 同源差分均为 41/41，调度生命周期均为 19/19；独立压缩互操作 50 组双向通过。新增 source/Worker/qjsc 与 SDK 密钥/AEAD 测试全部通过。

Python 80 项检查及 TypeScript 5.9.3 的 ES2022、ES2022+DOM 正反向编译通过。三文件运行包、双架构 SDK、包含 30 个测试/探针 APE 的 CI 传输包均通过校验。本项等待完整七目标 CI；全绿后进入 M4-02。
