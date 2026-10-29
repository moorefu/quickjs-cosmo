# 发布 profiles、SDK 与测试包

默认构建和默认下载均为 **base-fat**。base 保留 ESM、文件/进程、流、crypto、
DNS/TCP、TLS、HTTP/HTTPS、Fetch，以及 zlib/gzip/raw-deflate/CRC。
full 额外链接 Zstd、LZ4 Frame 和 bzip2。base 不导出、不声明这些可选 API。
两种 profile 使用相同的锁定工具链、TLS 策略和 Node 兼容合同。

## 构建与验收

在 Linux/WSL 仓库根目录运行；缓存完整时可使用 `--offline`：

```sh
export QUICKJS_COSMO_RUNTIME_PROFILE=base  # full 使用 full
sh scripts/build.sh --offline
export PATH="$(python3 scripts/build_config.py toolchain)/bin:$PATH"
python3 scripts/prepare_native.py --node --offline
python3 scripts/test.py --upstream --compile --node-compat
python3 scripts/check_types.py --offline
python3 scripts/package.py --validate
python3 scripts/ci_artifact.py pack
```

Windows 构建入口为 `./scripts/build.ps1 -Offline -RuntimeProfile full`。
构建目录分别为 `build/quickjs-nightly-base`、`build/quickjs-nightly-full`；
`dist/` 是当前选中 profile 的交付目录。切换 profile 后重新构建、验收和打包，
不能混用前一次的 `dist/` 或报告。源 `types/` 是完整声明模板；消费者使用
当前 SDK 的 `node-compat.d.ts`，不要将 full 声明与 base 二进制混用。

## 下载布局

VERSION 沿用原规则；tag `v2026-06-04.1` 对应 VERSION `2026-06-04.1`。

| 文件名前缀（后接 `-VERSION.zip`） | 内容 |
| --- | --- |
| `quickjs-cosmo` | 推荐的 base-fat |
| `quickjs-cosmo-full` | full-fat |
| `quickjs-cosmo-x64`、`quickjs-cosmo-arm64` | base 单架构 |
| `quickjs-cosmo-full-x64`、`quickjs-cosmo-full-arm64` | full 单架构 |
| `quickjs-cosmo-sdk` | `base/`、`full/` 各自的 qjsc、双架构静态库、头文件、类型、能力和许可 |
| `quickjs-cosmo-tests` | `base/`、`full/` 各自的 qjs、run-test262、loader、测试及许可 |

runtime ZIP 根目录仅有 `qjs` 和 `readme.txt`；Windows 将 `qjs` 改名为
`qjs.exe`。x64 包带 Windows PE 入口；arm64 包面向支持 ARM64 APE 的 Unix
宿主，不提供 Windows ARM64 原生 PE。SDK 保留 `.aarch64/`，使用前将锁定的
cosmocc 放到 PATH。tests 包解压后，直接运行
`python3 base/run-tests.py` 或 `python3 full/run-tests.py`，无需源码仓库。
完整外部 Test262 数据集仍需自行提供；随包的 prepared-input smoke 和 QuickJS
回归可独立执行。

锁定的 cosmocc 拒绝含空格的编译参数；SDK、源码和编译输出目录应使用无空格
路径。运行时和 tests 包的含中文、空格路径另有独立执行验收。

本地 `package.py` 生成当前 profile 的三个 runtime ZIP 和 `releases/internal/`
下的 SDK/tests 中间包。CI 验证两种 profile 后，由 `assemble_release.py` 汇总到
`releases/public/`，生成最终八个 ZIP、校验和、六份 capabilities、合并 manifest
和兼容性报告。中间包不是公共 Release 附件。

## CA 资源与 SDK provider

默认 CA 仅保存在 APE ZIP 的 `.quickjs-cosmo/ca-bundle.pem`，运行路径为
`/zip/.quickjs-cosmo/ca-bundle.pem`。fat 两个 CPU 镜像共用一份；qjsc 和 SDK
通过静态库资源对象自动携带它，因此 SDK 不依赖宿主事先具有 ZIP 资源。
`NODE_EXTRA_CA_CERTS` 继续在默认信任库上合并，证书与主机名验证保持启用。

嵌入方可在首次默认 CA 使用前调用：

```c
int js_cosmo_set_ca_provider(QJSCosmoCAProvider callback, void *opaque);
/* callback: int (void *, const unsigned char **pem, size_t *length) */
```

callback 返回 0 和非空、无 NUL 的 PEM，最多 4 MiB；返回的存储须持续有效至首次
CA 加载完成，运行时会复制内容。配置作用于整个进程，加载后只读，后续配置返回
`-1`/`EBUSY`。传入 NULL callback 选择内置资源。callback 只执行一次，不应递归
调用 CA 加载器，可能在 TLS pump 线程执行，不可调用 JS API；失败不会回退到其他信任源。缺失资源和无效 PEM 均不能绕过 TLS
验证。`js_cosmo_default_ca()` 返回进程持有的只读内容，可用于 SDK 诊断。

## 体积与发布门禁

裸 qjs / ZIP 目标按十进制字节计算；每项固定加 200,000 B 工程裕量：

| profile | fat | x64 | arm64 |
| --- | --- | --- | --- |
| base | 8.7 / 3.8 MB | 4.6 / 2.0 MB | 4.3 / 1.9 MB |
| full | 10.8 / 4.6 MB | 5.8 / 2.5 MB | 5.3 / 2.3 MB |

本地无 tag 的固定输入构建实测（字节；最终发布以 CI manifest 为准）：

| profile / 架构 | 裸 qjs | runtime ZIP |
| --- | ---: | ---: |
| base-fat | 8,647,671 | 3,655,850 |
| base-x64 | 4,538,175 | 1,957,534 |
| base-arm64 | 4,318,224 | 1,852,356 |
| full-fat | 10,888,823 | 4,496,037 |
| full-x64 | 5,721,919 | 2,377,188 |
| full-arm64 | 5,379,728 | 2,270,789 |

记录裸文件、LOAD segments、ZIP 条目和下载大小；单架构代码与数据必须逐段匹配
对应 fat slice。超过预算、缺少/重复 CA、profile/架构或能力哈希不一致，均阻断
发布。base/full 各执行七个平台、真实 ARM64 64K 内核、独立 SDK/tests 解压验收；
64K 内核增加共享 CA 的并发加载、PEM 逐字节比较和 X.509 解析用例。
每种单架构在匹配宿主实际运行。最终门禁重新核对两套证据；普通 main/PR 不创建
tag 或 Release。
