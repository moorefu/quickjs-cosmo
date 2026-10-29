# Node 风格运行时使用指南

运行时以 ESM 为入口，提供规划中已声明的 Node API 子集。固定 Node 对照基线为 v24.21.0；QuickJS 与 Cosmopolitan 的版本和摘要见 versions.json。实际方法、参数、平台与入口支持以 SDK 的 capabilities.json 和 compat/node-api.json 为准。

## 模块命名

| 用途 | 入口 |
| --- | --- |
| 文件与目录、文件流 | node:fs、node:fs/promises |
| 进程与宿主 | node:process、node:child_process、node:path、node:os |
| Buffer、事件、断言、工具和调度 | node:buffer、node:events、node:assert/strict、node:util、node:timers、node:timers/promises |
| 流与异步流水线 | node:stream、node:stream/promises |
| 摘要、KDF、密钥、签名与 AEAD 子集 | node:crypto；扩展见 cosmo:crypto |
| 压缩与解压 | node:zlib；扩展见 cosmo:compression |
| 客户端网络 | node:dns、node:dns/promises、node:net、node:tls、node:http、node:https、node:url；全局 fetch |
| 版本、能力、后端与主要配额 | cosmo:runtime 的 runtimeInfo() |
| QuickJS 原有接口 | qjs:std、qjs:os；旧 std、os 保留原义 |

推荐业务脚本显式使用 node: 前缀。裸 os 是 QuickJS 旧模块；Node 风格宿主信息使用 node:os。没有 @runtime/* 兼容命名空间。require()、CommonJS、package.json/node_modules/npm 解析保留为独立项目，不是执行 ESM 的前置条件。

## 同一份业务源码

在仓库根目录执行：

```sh
node examples/portable-core.mjs
./dist/qjs -m examples/portable-core.mjs
```

Windows 对应命令：

```powershell
node .\examples\portable-core.mjs
.\dist\qjs.exe -m .\examples\portable-core.mjs
```

该示例将消息通过流写入 gzip 文件，再解压核对；使用真实随机密钥执行 AES-256-GCM 往返验证，计算 SHA-256，并启动同一程序的子进程模式。临时目录在 finally 中删除。输出不包含随机密钥或临时路径，因此两端结果可以直接比较。

JSON 客户端示例需要传入实际 HTTP/HTTPS 地址：

```sh
node examples/portable-fetch.mjs http://127.0.0.1:8080/data.json
./dist/qjs -m examples/portable-fetch.mjs http://127.0.0.1:8080/data.json
```

`python scripts/test_examples.py --qjs dist/qjs.exe --node <固定Node路径>` 会启动独立的本机服务，以动态端口在两端验证这两个示例。测试不依赖公网服务。

## qjsc 与 SDK

```sh
./dist/qjsc -m -o build/portable-example.exe examples/portable-core.mjs
./build/portable-example.exe
```

独立程序的 argv 为 `[execPath, execPath, ...用户参数]`，不会把业务参数 -e 解释成新的 JS 源码。示例通过 --portable-child 显式区分子进程模式，因此也能独立编译。源码与独立程序的主模块 filename/dirname 指向各自的入口；嵌入子模块使用 qjs:embedded URL，不虚构磁盘文件。完整合同见 [入口说明](NODE_ENTRY_CONTRACT.md)。

嵌入 C 程序使用 SDK 的 quickjs.h、quickjs-libc.h、qjs-cosmo.h 和对应架构 libquickjs.a。创建 Context 后调用 js_cosmo_init_modules，并安装 js_cosmo_module_normalize 与宿主 loader；进入事件循环后，销毁前调用 js_std_free_handlers，再释放 Context/Runtime。可以从 [最小 SDK 验收程序](../tests/native/module_registry.c) 开始；异步和标准流例子见 tests/native 中对应文件。SDK 保留 .aarch64 目录。

需要 Worker 时，先用 js_std_set_worker_new_context_func 注册 Context 工厂；工厂创建子 Context 后同样调用 js_cosmo_init_modules。完整的 SDK/Worker 初始化及调用方 opaque 保持检查见 [文件系统 SDK 用例](../tests/native/host_filesystem.c)。

## TypeScript

只需将 SDK 的 node-compat.d.ts 作为公开入口，它会引用全部分拆声明。示例配置：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": [],
    "strict": true,
    "noEmit": true
  },
  "files": ["dist/node-compat.d.ts", "app.mts"]
}
```

类型只描述已交付子集。构建以固定 QuickJS TypeScript 5.9.3 分别检查源码入口和 SDK 入口，覆盖 ES2022、ES2022+DOM、正/负用例及示例 JS。TypeScript 工具用于开发验收，不进入运行包；执行 TS 需先转为 ESM JavaScript。QuickJS extras 的 Unicode 重建文件/benchmark 和 Babel 工具也不是运行库依赖。

## 范围与差异

方法同名不代表完整 Node 兼容。客户端 TLS 只提供已审计的 TLS 1.2 范围，强制证书与主机名验证；自定义 CA 与启动信任配置见 [TLS](M5_TLS_CLIENT.md) 和 [HTTPS](M5_HTTPS.md)。TCP/HTTP/TLS 服务端、UDP、WebSocket、HTTP/2、完整 Web Streams、Blob/FormData、RSA/ECDSA、更多密码模式、Brotli/ZIP 和 IPC 等属于后续范围。

标准流是 Readable/Writable；stdout/stderr 同步写入，回调延后，pipe/pipeline 不自动结束标准输出。一个进程同时只有一个 Context 能读取 stdin，Worker 读取共享 stdin 会明确失败。TTY 只提供 isTTY。任务池、socket 和子进程配额由 Runtime 共享，完整边界见 [全入口交付](M6_DELIVERY.md) 与 [能力和发布报告](M6_CI_RELEASE.md)。

运行时元数据示例：

```js
import {runtimeInfo} from 'cosmo:runtime';
const info=runtimeInfo();
console.log(info.platform,info.arch,info.entry);
console.log(info.capabilities.scope,info.capabilities.limits);
```

七平台 CI 覆盖 Linux x64/ARM64、macOS Intel/ARM64、Windows 2022/2025 x64 和 Windows ARM 上的 x64 APE。BSD 没有本项目验收 runner。CI 的 compatibility-report.json 绑定本次二进制、源码/输入和 Node 基线；API 数量不作为兼容率。

源码应用可使用 [QJB v1](QJB_FORMAT.md)：`qjs tools/qjb-pack.mjs ./app -o app.qjb --deflate` 打包完整目录，`qjs --bundle app.qjb -- args` 运行。清单、代码与资源保留原始字节；计算路径的动态导入与包内 Worker 也可继续工作。`cosmo:bundle` 提供资源解析、Buffer 读取和严格 UTF-8 文本读取，包地址与宿主 fs 路径各自遵循文档中的合同。
