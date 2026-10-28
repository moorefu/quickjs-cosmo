# M6-03 文档、类型与示例交付

公开 node-compat.d.ts 现在引用全部分拆声明，覆盖文件、流、加密、压缩、子进程、网络和 cosmo 扩展。类型验收仅传入一个入口，分别测试源码与实际 SDK 的 ES2022/ES2022+DOM，防止由显式列举所有声明文件掩盖缺失依赖。

新增 portable-core.mjs 和 portable-fetch.mjs，使用与固定 Node 相同的 ESM 源码。前者覆盖文件流、gzip、SHA-256、AES-GCM 和显式子进程模式，并编译为独立 APE 进入七平台清单；后者覆盖带取消期限的 HTTP/HTTPS JSON 客户端。本机测试服务使用动态端口，源码结果严格对照 Node。示例也使用 checkJs 检查其调用均在声明范围内。

README 和 [使用指南](NODE_RUNTIME_GUIDE.md) 给出命名空间、源码运行、qjsc、SDK、类型入口、已声明差异与后续范围。移除旧的仅完成 M1/M2、异步 fs 尚待实施等过期描述；方法明细继续由单一机器清单维护。

最终交付以本提交的完整 CI、七平台 compatibility-report.json 和能力/产物摘要为验收依据。M0—M6 的目标子集均有实现；CommonJS/npm 和规划第 12 节列出的后续范围继续独立立项。

本地验收：Linux 完整构建 142/142，共享 APE 94/94；Windows 96/96，另有 1 项既定 Unix 测试跳过；Node 差分两端 58/58；Python 108 项；源码与 SDK 单入口的 ES2022/ES2022+DOM 类型及示例 checkJs 均通过。独立示例已进入 46 个 APE 的传输清单，打包与平台证据门禁通过。最终七平台结果见 [当前提交的完整 CI](https://github.com/moorefu/quickjs-cosmo/actions/workflows/build-ape.yml) 和该轮 compatibility-report.json。
