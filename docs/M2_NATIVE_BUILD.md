# M2-01 原生构建

固定 Cosmopolitan Nightly #802 的同一提交 `aefad27c09ffda64c6ac64bd69f758e9f9c7b91d`。源码归档 SHA-256、源文件和编译参数分别锁定在 `native/versions.json`、`native/build-inputs.json`。构建不下载新的算法依赖，也不从备份分支直接复制旧适配层。

## 构建与范围

| 私有档案 | 本阶段编译范围 | 许可 |
| --- | --- | --- |
| mbedtls-core | MD5、SHA1、SHA2、MD 层、HMAC、HKDF、PBKDF2，附必需的 BLAKE2b256 描述符 | Apache-2.0、ISC |
| haclstar-blake2b | Blake2b 增量、复制、可变摘要长度与带密钥原语 | MIT |
| zstd | common/compress/decompress 的 25 个 C 文件 | BSD-3-Clause |
| lz4-frame | lz4、lz4hc、frame、xxhash 四个库文件 | BSD-2-Clause |
| bzip2 | 八个库文件，BZ_NO_STDIO | bzip2-1.0.6、ISC |

共 53 个 C 文件，由 Cosmocc 为 x86_64/aarch64 各生成对象，核验 ELF64、字节序、CPU 和 SHA-256，分别产生两个架构的五个档案。保留上游按文件优化、Zstd C CPU 分派及多线程设置；不全局添加 march=native 或禁用 CPU 分派。当前工具链的编译宏使 Zstd 外部汇编路径自然关闭，与此 Nightly 的 C 源清单一致。

构建记录在 `build/native/backends/build.json`，含每条编译命令、诊断、两架构对象哈希、档案哈希、许可哈希及全局强符号表。输入、对象或对端架构改变时缓存失效；创建档案前删除两个架构的旧档案，避免移除源文件后旧成员残留。复用对象仍校验两个架构及各自哈希。构建前后检查所有已解出的源码与固定归档一致。

两个架构均检查必需 ABI、重复强符号和意外 CLI/TLS/通用密钥符号。当前 pkcs5 源还含未被探测链接保留的 PBES2 函数；这些私有原始档案不进入嵌入 SDK，后续接入算法前继续检查可达范围。M2-01 不新增 JS 导出或更改 planned API 状态。生产摘要后端选择、JS 内存与错误合同分别属于 M2-03/M2-04；TLS 准入仍属于 M5。

SDK 附 `NATIVE-MODULES-LICENSES`，供同一 CI 构建中的原生探测二进制保留完整许可。LZ4 GPL 命令行源不在编译清单中。默认发布 ZIP 仍只有 readme.txt、run-test262、qjs；本阶段候选算法没有链接入这三文件产品。

## 可重建证据

toolchain-probe 验证已有 zlib 往返/CRC32、BLAKE2b256 已知向量、getrandom 完整读取、数字 IPv4 解析、socket 创建/关闭及 stdio。socket 探测不代表 DNS/TCP 交换已完成。

backends-probe 验证六种摘要的上游自测、8193 字节独立向量、跨块增量及复制；HMAC-SHA256、[HKDF RFC 5869 A.1](https://www.rfc-editor.org/rfc/rfc5869)、PBKDF2-SHA256；[BLAKE2 RFC 7693](https://www.rfc-editor.org/rfc/rfc7693) 对应的 256/512 位及带密钥算法，与 Python hashlib 交叉检查，并检查复制/重置。HKDF 超长输出必须拒绝且保持哨兵字节。

压缩覆盖 Zstd/LZ4 frame/bzip2 往返及魔数损坏，Zstd/bzip2 的短输出缓冲区越界哨兵，另以 Python zlib 核对 CRC32/Adler32，并检查 CRC32C 标准向量。帧拼接、截断、所有选项、外部格式互操作和 JS 输出配额留在 M2-04，不能以一次往返替代这些合同。

CI 从 Linux 构建一次，传输原有九个独立 APE 和这两个原生探测 APE，七个平台矩阵运行相同字节。探测构建记录带二进制、源码、编译器、两个实际 ELF 切片的身份；矩阵无须安装 Cosmocc 或下载原生源码。清单精确校验源码集合，缺失 ARM 证据、过期输入或许可不一致会拒绝验收。报告单独保存，E2 只适用于 `evidence_scope`，不代表整个库所有算法已准入。

```sh
sh scripts/build.sh --offline
PATH="$PWD/toolchains/cosmocc-nightly-2026-10-26-aefad27c09ff/bin:$PATH" \
  python3 scripts/test.py --upstream --compile --node-compat
python3 scripts/check_types.py --offline
python3 -m unittest discover -s tests -p 'test_*.py' -q
python3 scripts/package.py
python3 scripts/ci_artifact.py pack
python3 scripts/ci_artifact.py verify
```

另修正 QuickJS libc 对 Cosmopolitan 的单调时钟平台识别。原条件仅含 Linux/Apple，Cosmocc 不定义这些宏，导致 os.now 使用墙上时钟；补丁 0008 使其采用 CLOCK_MONOTONIC，并以 process.hrtime 前后包围检查，覆盖源码、独立 APE 和 Worker 调度测试。

Windows 本地验收还发现探测链接命令的 include 顺序错误：原生源码目录排在 compat-source 前，导致 host_process.c 误编译 Nightly 未修正的 sigproc 源，卡在启动阶段的 generate_pid。现优先选择已校验的兼容补丁目录，再选择原始算法头文件。带阶段诊断的同一 APE 已验证能进入并完成全部算法阶段；跨主机探测包含启动路径验收，避免只在 Linux 链接成功就准入。

Nightly 实际目录缺少 SHA3/SHAKE/BLAKE2s，BUILD.mk 的 SHA3 陈旧规则没有对应源文件。按规划保留 M4-02 的最小补充源码准入；不能用存在的规则宣称算法已存在。本项完整 CI 通过前不开始 M2-02。

本地最终验收：Linux 56/56；Windows 同一产物 49/49，另保留一个既有 Unix 专用跳过；两端 Node 差分各 15/15、调度生命周期各 19/19；Python 门禁 80 项、TypeScript 两种 lib 模式、11 个 APE 的 CI 传输及三文件发布包完整性均通过。完整平台准入以提交后的 CI 为准。
