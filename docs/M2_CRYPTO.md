# M2-03 摘要与 KDF

本项将固定 Nightly #802 内已经通过 M2-01 原生探测的算法接到 QuickJS；不增加算法依赖版本。`node:crypto` 和裸别名 `crypto` 使用同一模块实例，提供默认及具名导出；`cosmo:crypto` 容纳 Node 没有的算法。ESM 为唯一模块加载合同。

## 接口与后端

| 接口 | 当前范围 | 后端 |
| --- | --- | --- |
| getHashes / createHash / Hash | md5、sha1、sha224、sha256、sha384、sha512、blake2b512；update/digest/copy | mbedTLS MD；HACL 增量 BLAKE2b |
| createHmac / Hmac | MD5、SHA1、SHA2；update/digest | mbedTLS HMAC |
| hkdfSync / pbkdf2Sync | MD5、SHA1、SHA2；分别返回 ArrayBuffer / Buffer | mbedTLS HKDF / PKCS5 |
| hash | 相同七种摘要的一次性接口 | 同一原生摘要路径 |
| randomBytes / randomFillSync / randomUUID | 同步随机数、偏移填充、UUID v4 | Nightly getrandom |
| timingSafeEqual | 等字节长度的 ArrayBuffer、SharedArrayBuffer、视图 | Nightly timingsafe_bcmp |
| cosmo:crypto.blake2b256 | 单参数、无密钥、返回 32 字节 Buffer | HACL，真实 256 位输出参数 |

`getHashes()` 返回当前支持的规范名称子集，每次返回新数组。支持所测试的 SHA-256、sha2-256、RSA-SHA256 等别名，但不承诺 OpenSSL 的完整别名集合。HMAC/KDF 不因 getHashes 包含 BLAKE2b 就宣称支持它。MD5/SHA1 用于兼容既有格式。

Hash.copy 复制后端增量状态，数据更新后不保留输入历史。Hash 结束后 update/digest/copy 抛 ERR_CRYPTO_HASH_FINALIZED；Hmac 重复 digest 返回空值，随后 update 仍拒绝。哈希输入字符串或 ArrayBufferView；密钥/KDF/比较还接受 ArrayBuffer/SharedArrayBuffer；所有视图保留 byteOffset/byteLength。字符串编码、奇数 hex、未知输出编码、固定摘要 outputLength 和所声明错误类别/代码与固定 Node v24.21.0 差分。

HKDF info 上限 1024 字节，输出上限 255 倍摘要长度。PBKDF2 iterations 为正 int32，长度为非负 int32。固定 Node 基线的零长度 HKDF/PBKDF2 均抛普通 Error（Deriving bits failed），这里跟随该行为。随机填充以 TypedArray 元素大小缩放 offset/size，再按基线检查和截断；返回原输入。UUID 每次取 16 个系统随机字节，暂不缓存熵；disableEntropyCache 仍按布尔参数验证。

## 生命周期与 SDK

原生计算 core 不持有 JSValue/JSContext，绑定独立管理每个运行时的类和状态。同步调用使用线程局部分配器作用域，每块内存保存所属运行时的分配/释放回调，GC 可以在作用域结束后释放；不占用宿主 ContextOpaque 或 RuntimeOpaque。

所有后端堆分配计入 QuickJS 的真实内存配额。适配层额外对齐原生数据，兼容 QuickJS 小块分配器的 8 字节对齐保证。释放前清零完整分配块和管理头；输出 ArrayBuffer 的释放回调也清零其数据。Hash.digest 在消费状态前分配输出，输出分配失败允许重试。JS 调用方持有的原始字符串/Buffer 由调用方管理，不能声称它们也被原生层清零。

随机读取处理 EINTR 和短读，返回 0 或系统错误均失败；没有弱随机回退。randomBytes 的暂存输出仅在填满后返回，失败后释放并清零；randomFillSync 的系统错误可能已改写调用方范围内的部分字节。比较的原生循环不按首个不同字节提前结束；整个 JS 调用包含类型/长度检查，不声称整个应用代码具有恒定时间。

`scripts/build_crypto.py` 对两个架构分别部分链接并裁剪，将 malloc/calloc/free 包装局限于所选后端。仅保留 `js_cosmo_crypto_api` 为全局定义，其他后端符号局部化；验证没有 PBES2、通用 cipher、md_file、TLS、RSA/ECP 等未准入范围，保留 mbedTLS/HACL notice。SDK 链接这一闭包对象，原始候选算法档案继续不随 SDK 分发。build.json 记录输入哈希、命令、两个架构和未解析宿主依赖；最终 SDK 和源清单继续由产物清单锁定。

## 验收与后续

同源差分位于 crypto.mjs、crypto-state.mjs、crypto-kdf-random.mjs，覆盖七种摘要的空输入及块边界、独立复制、编码、状态、六种 HMAC/KDF、偏移视图、返回类型、参数边界和随机填充范围。随机值不通过“每次不同”或分布测试声称安全。runtime_crypto 复用差分用例，并覆盖独立 BLAKE2b256 向量及 Worker；同一测试编译成独立 APE。

手工 SDK 测试在链接时注入分配及 getrandom 故障，覆盖 mbedTLS/HACL 每一步构造/复制分配失败、原对象可继续使用、输出分配失败可重试、EINTR/短读/零读/部分后失败、释放前清零和未结束对象销毁。16 MiB 输入以固定 64 KiB 块更新，在 8 MiB 运行时配额内核对独立 SHA256 向量，防止以保存历史数据实现增量。上述 SDK APE 与源码/独立 APE 一起进入七个平台矩阵。

异步随机/KDF 在 M3-02；Hash/Hmac 流在 M3-05；KeyObject、密钥格式和 AEAD 在 M4-01；SHA3/SHAKE/BLAKE2s 在 M4-02。当前 callback randomBytes 明确抛 ERR_NOT_SUPPORTED，未导出其他异步占位。M3 后台计算须使用任务专属配额/分配器，禁止从后台线程调用 QuickJS 分配器。未来 TLS 应统一规划摘要符号所有权，不能重复链接另一整套摘要后端。

标准参考：[Node v24.21.0 crypto](https://nodejs.org/download/release/v24.21.0/docs/api/crypto.html)、[HKDF RFC 5869](https://www.rfc-editor.org/rfc/rfc5869)、[HMAC RFC 4231](https://www.rfc-editor.org/rfc/rfc4231)、[BLAKE2 RFC 7693](https://www.rfc-editor.org/rfc/rfc7693)。实现比较以仓库固定 Node 可执行文件及其内嵌 JS 源为准。

本地最终验收：Linux 66/66；Windows 使用同一产物 55/55，另保留一个既有 Unix 专用跳过；两端 Node 差分各 21/21。80 项 Python 门禁、TypeScript es2022/es2022+dom、15 个 APE 的传输清单与三文件发布 ZIP 校验通过。实际 x86_64/aarch64 可执行切片中 timingsafe_memcmp 的循环仅按长度分支，没有按首个不同字节退出。

完整 CI 待确认；未完成本项 CI 前不进入 M2-04。
