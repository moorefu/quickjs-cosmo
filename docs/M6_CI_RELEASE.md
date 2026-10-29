# M6-02 CI、能力清单与发布门禁

> 本文记录 M6 交付时的布局。当前 base/full、两文件 runtime ZIP、独立 SDK/tests 和双 profile 门禁见 [发布 profiles](RELEASE_PROFILES.md)。


## 能力描述

`compat/node-api.json` 仍是方法、参数、平台和入口差异的权威清单。构建从它生成以下交付：

- `runtimeInfo().entry` 区分 qjs、Worker、qjsc 和手工 SDK；`capabilities` 返回新的独立摘要，包含方法状态、后端锁摘要、范围和主要配额。
- SDK 的 `capabilities.json` 保留完整的方法参数、支持矩阵、差异与测试证据引用。后端的 `sourceAdmission` 描述源文件准入级别，不表示公开整个第三方库 API。
- `dist/manifest.json` 的 features 从已实现的清单生成，包含 TLS、HTTP、HTTPS、Fetch 和 Web ReadableStream。SDK 中每个当前声明文件和公共头都必须与源码逐字节一致。
- 三文件运行 ZIP 继续由 readme.txt、qjs、run-test262 组成。readme 附上 API 清单摘要、模块范围和主要差异，完整许可文本保留。

原生任务池的 2 个线程、64 个任务及 64 MiB 预留总额属于一个 Runtime；32 个 socket 与 16 个异步子进程的上限同样由该 Runtime 内的多个 Context 共享。TLS 每连接预付 8 MiB arena。标准输入的单读者限制属于进程；标准输出同步写入，每段最多 64 KiB。报告列举主要配额，各 API 的参数上限仍以方法合同为准。Node 方法计数和导出数量不解释为兼容率。

## 报告绑定

运行时报告增加实际 qjs、qjsc、两种架构 SDK、manifest、API 清单、Node 基线、原生锁及检查合同的摘要。Actions 中还记录项目提交号。报告声明此次是否执行上游、Node 差分、编译或共享独立程序验收。

`compat/release-checks.json` 冻结 M6-01 全绿时的必需构建与平台检查名称。新增或移除验收必须同步审阅这份合同。零失败的空报告、缺少 SDK 用例、错误计数、重复/缺少 Node 差分用例、旧二进制、变动后的 fixture 和异常跳过都会被拒绝。Windows 仅保留明确记录的 Unix 命令上游测试跳过。

Node 校验沿用已有驱动：先验证官方归档 SHA-256，再校验其中实际可执行成员与运行的 Node 一致。平台报告生成时再次检查可执行文件，最终离线门禁核对这份结果与锁定归档、宿主和执行架构一致，不要求发布包携带五套 Node 测试工具。

重试发布仍先核对原 tag 和原完整 CI 门禁；随后将提交身份设为已检出的原 tag，避免调度重试工具所在分支的提交号替代原产物身份。

## 构建和矩阵

1. Linux 构建运行全部必需检查和 Node 差分；打包前由 `release_evidence.py` 验证原始报告，生成 `build/ci/build-evidence.json`，一并传输并计算摘要。
2. 七个矩阵任务下载并核验同一 SDK、独立 APE 和三文件 ZIP，运行测试后再次核验产物，然后生成各自唯一的 `build/release-evidence/<runner>.json`。
3. CI gate 在所有任务成功后下载本轮报告，要求七行各有且仅有一份、所有摘要和宿主/执行架构相符。Windows ARM 行必须是 ARM 宿主上的 x64 APE 执行。
4. 门禁生成 `releases/compatibility-report.json`，与 ZIP、校验和、manifest 和 capabilities.json 一并保存为已验证发布产物。只有既有 tag 发布流程可以发布版本；main 验证不创建 tag 或 Release。

本地可使用 `python scripts/release_evidence.py platform` 检查完整的共享 APE 验收报告；打包要求 Linux 的完整编译验收报告。最终矩阵汇总命令为 `python scripts/release_evidence.py aggregate --reports build/matrix-reports`。本地单个平台不能代替完整矩阵结果。

本地验收已通过：Linux 完整构建 139/139、共享 APE 92/92；Windows 94/94，另有 1 项既定 Unix 测试跳过；两端 Node 差分 58/58；108 项 Python 单元检查；TypeScript 5.9.3 的 ES2022 与 ES2022+DOM。两端平台证据、完整构建证据、SDK/输入摘要和三文件 ZIP 均通过新门禁。完整七行汇总的正向和缺行拒绝路径已通过独立单元测试。

完整 CI 已通过：`a99bc79`，[七平台和报告汇总门禁](https://github.com/moorefu/quickjs-cosmo/actions/runs/40724645527)。现进入 M6-03。
