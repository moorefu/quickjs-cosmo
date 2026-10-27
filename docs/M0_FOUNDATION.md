# M0 合同清单与验收基础

实施日期：2026-10-27。对应 [运行时实施规划](NODE_COMPAT_RUNTIME_PLAN.md) 的 M0-01—M0-04。

本批交付 API 清单、可信的 Node 行为基线、原生探针和入口合同，不增加公开 Node 模块。`compat/node-api.json` 当前列出 29 个模块、284 个接口项，全部为 `planned`，已实现数量为 0。两端基础 ESM 用例通过不代表这些 Node API 已实现。

## 1. 已交付内容

| 任务 | 交付 | 边界 |
| --- | --- | --- |
| M0-01 | [API 清单](../compat/node-api.json)与 [校验器](../scripts/node_contract.py) | 方法、参数范围、任务、测试组与各执行入口状态；通过默认值保留逐平台/入口覆盖，支持状态不能由参考测试背书 |
| M0-02 | [源码锁](../native/versions.json)、[准备脚本](../scripts/prepare_native.py)、[探针](../native/probes/toolchain.c)与[驱动](../scripts/probe_native.py) | 原生库来源为 E0；当前工具链探针完成双架构构建与 Windows/Linux 运行；mbedTLS/HACL*/Zstd/LZ4/bzip2 的源码构建仍待 M2-01 |
| M0-03 | [Node 输入锁](../compat/node-baseline.json)、[差分驱动](../scripts/test_node_compat.py)及[同源用例](../tests/node/) | Node v24.21.0，验证官方输入摘要；参考模式与差分模式分开报告 |
| M0-04 | [入口合同](NODE_ENTRY_CONTRACT.md) | 固定源码/qjsc/Worker 的目标行为；对应新运行时行为仍待 M1/M6 实施 |

源码归档来自工具链同一提交 `aefad27c09ffda64c6ac64bd69f758e9f9c7b91d`，SHA-256 为 `2ad113d1735280479183fee0a6b65159ca1999005a69b6d06cd5ec945e3fa32c`。准备脚本验证归档、源文件锚点与所有已准备的选中源文件；已准备源码被修改时拒绝继续。补充 HACL* 文件与 TLS 未通过准入，本批不启用它们。

Node 测试工具安装在项目 `toolchains/`，缓存位于 `.cache/node-baseline/`，不修改系统安装。Windows 直接校验官方 node.exe；Unix 对照锁定归档中 bin/node 的字节摘要验证测试程序。仅版本字符串匹配不足以通过。

## 2. 本地验证结果

| 验证项 | Windows x64 | WSL/Linux x86_64 |
| --- | --- | --- |
| Node 参考用例 | 7/7 | 7/7 |
| 当前 qjs 与 Node 基础 ESM 差分 | 2/2 | 2/2 |
| 原生工具链探针 | 通过 | 通过，同一 APE |
| 现有快速回归加新增清单/差分入口 | 30/30，跳过原有 Unix test_std | 28/28，无跳过 |

Python 辅助与合同门禁测试共 66 项，覆盖旧 CI/发布逻辑以及新增的错误版本/摘要、伪成功输出、参考模式隔离、超时/输出预算、路径越界、源码被修改、错误支持声明与 Node 工具架构选择等场景。

原生探针使用项目现有退出/进程/信号文件兼容对象，覆盖 zlib 往返、CRC32、BLAKE2b-256 标准向量、系统随机数调用、数值地址解析、socket 创建与 stdio。它不验证实际 DNS 查询或 TCP 数据交换，也不代表对应 JS 绑定可用。x86_64 与 AArch64 的 ELF machine 均在构建时检查；本地未运行 ARM64 代码。

GitHub Actions 已配置安装校验过的 Node 工具、运行差分入口并上传报告。首轮 CI 的构建及六个平台已通过；Windows ARM64 暴露了将 Python 架构误用于 Node 工具选择的问题。已改为按 APE 实际执行架构选择 Node，并加入四项回归：Windows ARM 宿主即使使用 ARM64 Python，也选择 x64 Node，与 APE 的 x64 兼容执行保持一致。完整矩阵仍以修正提交的 CI 结果为准。

## 3. 命令

校验合同与辅助逻辑，无需下载 Node：

```sh
python scripts/test_node_compat.py --check-contract
python -m unittest discover -s tests -p 'test_*.py' -v
```

准备原生源码与项目内 Node；缓存齐备时均可添加 `--offline`：

```sh
python scripts/prepare_native.py --source
python scripts/prepare_native.py --node
```

保存 Node 参考结果，以及比较实际已晋升的差分用例：

```sh
python scripts/test_node_compat.py --reference-only
python scripts/test_node_compat.py
python scripts/test.py --upstream --node-compat
```

可用 `--node <绝对或相对可执行文件路径>` 指定 Node；默认优先使用项目内固定版本，然后查找 PATH。每次仍需通过版本和摘要校验。通过 `scripts/test.py` 指定时，还需带 `--node-compat`。

在 WSL/Unix 构建原生探针，前提是已有当前工具链、APE loader 和校验过的宿主兼容源码缓存：

```sh
python3 scripts/probe_native.py --compile
```

随后在 Windows 或其他已准备 loader 的主机运行同一产物：

```sh
python scripts/probe_native.py
```

原生 probe 的二进制、架构切片摘要、输入及宿主兼容信息绑定在 `build/native/toolchain-probe.exe.build.json`，运行端拒绝不匹配的探针。

## 4. 报告与支持状态

- `build/node-compat/reference-windows.json`、`reference-linux.json`：仅 Node 参考结果。
- `build/node-compat/windows.json`、`linux.json`：实际执行过的两端差分，包含未执行的待建用例列表。
- `build/native/probe-windows.json`、`probe-linux.json`：原生探针结果与构建来源。
- `build/test-results/windows.json`、`linux.json`：现有快速回归与本批入口集成结果。

报告记录运行工具、fixture、输入锁、入口合同与产物摘要。差分驱动检查进程退出码、唯一结构化结果及 JSON 类型；成功标记不能掩盖非零退出，布尔值与数字不能被当作同一结果。

测试状态 `reference` 只表示 Node 上的行为观察，`differential` 才会在两个运行时执行。当前 LANG-001/002 为 differential；Buffer、hash/KDF、压缩、源码入口和路径归一化保留参考基线。尚无 fixture 的测试组为 planned，不能成为 API 支持证据。

## 5. 下一批明确工作

进入 M1-01/M1-02：统一模块注册、别名与错误、qjs/qjsc/Worker 接入，以及 Buffer/编码。

M0 实测发现现有 QuickJS 对 `fixtures/value.mjs` 与 `fixtures/../fixtures/value.mjs` 创建了不同模块实例，Node 将它们归一化。`MOD-002` 保留此失败合同，当前为 Node 参考用例；M1 必须修复实际加载器，并通过差分后再晋升该用例。基础 LANG-001 只检验相同 specifier 重复导入，未掩盖该差异。

后续新增 API 时，先增加真实 fixture、明确支持范围与证据，再修改清单状态；不能只把 `planned` 改成 `supported`。本批没有启用 `@runtime/*`、CommonJS、npm 包解析、TS/Babel 工具或任何新原生算法后端。
