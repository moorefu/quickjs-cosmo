# M1-02 Buffer 与编码

前置 M1-01 提交 `33ea75f` 已通过[七个平台及最终门禁](https://github.com/moorefu/quickjs-cosmo/actions/runs/40430982438)。本项增加第一个 Node 内建模块 `node:buffer`；后续按[实施状态](RUNTIME_IMPLEMENTATION_STATUS.md)顺序推进。

## 接口与入口

`node:buffer` 与裸别名 `buffer` 使用同一模块实例。默认对象和具名导出的 Buffer 指向同一函数，且等于全局 `Buffer`；重新赋值全局别名不改变模块导出。Buffer 保留 Uint8Array 视图和迭代行为，`slice()`、`subarray()` 共享底层存储，`from(Buffer/TypedArray)` 复制，`from(ArrayBuffer/SharedArrayBuffer, offset, length)` 建立指定范围的共享视图。

已实现规划首批方法及数值/搜索扩展：

- 静态 `from`、`alloc`、`allocUnsafe`、`allocUnsafeSlow`、`isBuffer`、`isEncoding`、`byteLength`、`concat`、`compare`、`copyBytesFrom`。
- 实例 `toString`、`toJSON`、`equals`、`compare`、`copy`、`fill`、`write`、`slice`、`subarray`、`indexOf`、`lastIndexOf`、`includes`、`swap16/32/64`。
- 大小端整数、Float/Double、BigInt64/BigUInt64 读写和 Uint 拼写别名；可变宽度整数支持 1—6 字节。
- 模块导出 `SlowBuffer`、`constants`、`kMaxLength`、`kStringMaxLength`。

支持 UTF-8、UTF-16LE/UCS-2、latin1/binary、ASCII、hex、base64 和 base64url。保留各方法的不同规则，例如 from 的空编码使用 UTF-8，而非空 Buffer 的 `toString('')` 抛出未知编码错误；hex 遇无效字符或末尾半字节截断，base64 按固定 Node 基线宽松解析。

同时安装全局 `TextEncoder` 与 `TextDecoder`。前者提供 UTF-8 的 `encode`、`encodeInto`，后者提供 UTF-8、UTF-16LE/BE 与 Windows-1252（含常用 latin1/ASCII 标签），覆盖流式解码、跨块多字节字符、BOM 和 fatal。其他字符集明确抛出 `ERR_ENCODING_NOT_SUPPORTED`；完整 ICU 字符集不属于本项。`node:util` 中的导出在 M1-03 接入。

## 实现与边界

JS 外观位于 `src/js/node/buffer.js`，编码和错误基元位于 `src/js/internal/`。构建工具生成 C 内嵌字符串，原生模块将 API 对象保留在各自的 JSModuleDef 中；没有全局 C 单例、旁挂 JS、额外动态库或新第三方算法依赖。qjs、Worker、qjsc 独立程序与手写 SDK 共享同一份实现。

本项在 API 清单中保持 `partial`，明确以下初始范围：

- Buffer 分配上限为 `2^31-1` 字节，字符串上限与固定 QuickJS 的 `JS_STRING_LEN_MAX` 一致；宿主内存限制可以更小。
- `allocUnsafe/allocUnsafeSlow` 仍清零，不复用 Node 的共享 slab；不承诺 Node 的分配性能或 byteOffset 布局。
- resizable/growable 的共享底层存储明确拒绝，错误为项目的 `ERR_NOT_SUPPORTED`；跨 vm realm 对象也不在初始声明范围。
- 没有注册 Blob、File、transcode 等未实现的 `node:buffer` 附加导出。
- Buffer 类型与已实现方法交付在 SDK 根目录 `node-compat.d.ts`；`cosmo.d.ts` 描述现有运行时元数据。全局编码构造器的独立类型将随 M1-03 util 基础补齐。

## 本地证据与 CI

| 检查 | 结果 |
| --- | --- |
| Linux/WSL 完整回归 | 43/43，通过 qjsc 编译及独立运行、SDK 16 次 runtime 生命周期 |
| Windows 同一 APE | 40/40，仅保留原有 Unix 专用 test_std 的跳过 |
| Node 差分 | 两端各 7/7；Buffer 操作矩阵、全码元检查与流式解码均比较固定 Node v24.21.0 |
| UTF-8/UTF-16 | 131,082 个观察：全部两字节 UTF-8 组合、全部 UTF-16 单码元及关键三/四字节边界 |
| TextEncoder/TextDecoder | 1,378 个观察，包含分块、BOM、fatal、恢复和参数验证 |
| 类型 | TypeScript 5.9.3 strict/noEmit，正向与应拒绝的编译用例通过 |

`tests/runtime_buffer.mjs` 与新增的独立 `buffer-standalone.exe` 覆盖代表性入口行为。Worker 通过原注册用例检查 Buffer 与编码全局。源码清单扩展为绑定全部原生源、JS 源、类型及生成器；新增或修改未重建的 JS 输入会被传输校验拒绝。CI 传递五份独立 APE，精简发布 ZIP 仍保留三个文件。

扩展差分暴露了报告工具无法以 UTF-8 保存孤立 UTF-16 代理项的问题：现对报告使用 JSON 转义，保留原始码元，并加入回归测试。这个修正不改变比较值或删除失败字段。

类型检查使用用户先前提供的官方 QuickJS 版 TypeScript 5.9.3 工具，锁定在 `compat/dev-tools.json`，仅在 Linux x86_64 构建机运行。其官方文件名为 `.tar.xz`，实际内容为 gzip；按已校验的内容识别格式并只提取必要常规文件。它不参与运行时、SDK 或三文件包链接，不引入 require/npm 包加载。

```sh
sh scripts/build.sh --offline
PATH="$PWD/toolchains/cosmocc-nightly-2026-10-26-aefad27c09ff/bin:$PATH" \
  python3 scripts/test.py --upstream --compile --node-compat
python3 scripts/check_types.py --offline
python3 scripts/package.py
python3 scripts/ci_artifact.py pack
python3 scripts/ci_artifact.py verify
```

首次类型工具准备需移除 `--offline`，官方归档经 SHA-256 验证后缓存到 `.cache/dev-tools/`；已准备文件每次从校验过的归档恢复。远端结果以本项提交的完整 CI 为准，全绿后才进入 M1-03。
