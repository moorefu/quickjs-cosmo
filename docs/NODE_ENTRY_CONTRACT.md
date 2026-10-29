# Node 兼容入口与行为合同

本文件落实实施规划的 M0-04；M1-03 已实现初始 process 与入口身份合同，范围及后续调度缺口见 [公共基础记录](M1_FOUNDATION.md)。Node 基线为 v24.21.0，方法状态由 `compat/node-api.json` 管理。

## 1. 源码解释模式

| 字段 | 目标行为 |
| --- | --- |
| `process.execPath` | 当前解释器的绝对本机路径；不包含 APE loader 参数 |
| `process.argv` | `[execPath, absoluteEntryPath, ...userArguments]`；参数内容原样保留 |
| `process.execArgv` | 实际消费的解释器选项，不包含入口、用户参数或 loader 参数 |
| 主模块 `import.meta.url` | 入口文件的标准 file URL；以 URL 规则编码空格、Unicode 和 Windows 路径 |
| `import.meta.filename` / `dirname` | file URL 模块的绝对本机文件名及所在目录；非 file URL 不提供 |
| `import.meta.main` | 入口为 true；被导入模块为 false |
| `process.cwd()` | 宿主当前工作目录，与入口所在目录分开 |
| 模块中的相对 import | 相对于导入模块；归一化内部 `.`/`..` 路径，等价路径共享实例 |

通过 `-e` 执行时没有源文件入口，argv 为 `[execPath, ...userArguments]`，不虚构一个磁盘 JS 路径。REPL 与脚本模式分别保留宿主现有解析规则；不能把解释器选项加入业务 argv。

`NODE_COMPAT_RESULT` 是测试报告协议，不属于产品全局 API。`scriptArgs`、`std/os` 仍保留各自的旧合同。

## 2. qjsc 独立程序

独立程序没有运行时源文件入口，这是对 Node 源码模式的显式差异：

- `process.execPath` 为独立程序的绝对路径。
- `process.argv` 为 `[execPath, execPath, ...userArguments]`，为业务参数保留从索引 2 开始的位置。
- `process.execArgv` 为空；不重新解释业务参数中的 `--experimental` 等字符串。
- 主模块 `import.meta.url` 为可执行文件的 file URL，`import.meta.main` 为 true。
- 其他内嵌模块使用 `qjs:embedded/<logical-name>` 资源 URL；编译时以入口目录为逻辑根，不把构建机绝对目录写入公开身份。
- 内嵌相对 import 由资源注册清单解析；外部相对文件的动态加载不自动变成内嵌资源。

内嵌模块 URL 不保证可转换为磁盘文件路径，读取它不能假装得到原始 JS 源码。源码地图、动态 import 与 Worker 入口打包范围在 qjsc 接入任务中分别验收。

## 3. QuickJS Worker

Worker 保持 QuickJS 的启动和消息协议；这不等于实现 Node Worker Threads。

- 每个 Worker 使用同一模块定义清单、独立的模块实例和 JS 对象状态。
- `node:process` 的 pid、execPath、platform、arch 反映同一个进程；argv/execArgv 为创建时的上下文快照。
- Node 外观中的 `process.env` 为创建时快照，Worker 内修改不改变主上下文环境；默认子进程环境从该上下文快照生成。原有 `std` 环境函数行为不变。
- `process.cwd()` 读取进程工作目录；Worker 中 `chdir()`、`exit()` 和写 `exitCode` 首轮明确抛出 `ERR_WORKER_UNSUPPORTED_OPERATION`，不意外改变或终止整个宿主。
- Worker 主入口的 `import.meta.main` 为 true，导入模块为 false；资源身份按源码或内嵌模式定义。
- Worker 关闭后，所属原生任务必须取消或完成清理，不能向已销毁 runtime 投递 JS 回调。

上述 Worker 限制属于已声明的项目差异；不能作为 Node `process.exit()` 在线程中的完整兼容声明。

## 4. 状态、调度与退出

`std/os` 的 POSIX wait status 和 Windows 原始 DWORD 继续保留。新增 `child_process` 外观独立映射为 Node 的 status/signal，并在同一平台与基线比较，包括 Windows 高位退出码。

同步异常、未处理 rejection、自然退出和显式退出保留当前回归测试。增加 process 后，自然退出应用 exitCode；有已引用的定时器、I/O 或原生任务时不得提前自然退出。Callback 只完成一次。

不将 `process.nextTick()` 简单替换为 Promise.then。它在实现并通过顺序测试前保持未支持；定时器 ref/unref 与任务取消按各自任务建设，不借助吞掉回调的方式模拟成功。

## 5. 本批基线证据与后续验收

- `ENTRY-001` 已晋升 Node/qjs 同源差分，记录源码入口身份与全局别名。
- `MOD-002` 验证内部父路径归一化；M1-01 已修复原有模块实例差异，晋升为两端实际执行的差分用例。当前采用语法归一化，不声明 realpath、符号链接或 Node URL 解析兼容。
- `LANG-001/LANG-002` 是两端共用的 ESM/语言测试，不计入已实现的 Node 内建 API 数量。
- qjsc 与 Worker 的初始身份规则由 runtime_foundation、独立 entry APE 和 test_foundation.py 验证；全资源、异步销毁与取消继续在 M3/M6 扩展。

差分报告保存到 `build/node-compat/`。`reference_only` 报告只证明 Node 基线 fixture 可执行，不是 QuickJS 验收报告。

M6-01 补充：Windows 用户参数从固定 Nightly 的原始命令行解析器取得，保留盘符、反斜杠、空参数和引号。静态与动态模块说明符均在完整字符串边界拒绝 NUL；不得截断后加载前缀模块。具体标准流和 SDK 回收合同见 [全入口交付](M6_DELIVERY.md)。

## 6. QJB 源码应用包

`qjs --bundle app.qjb -- args` 按清单选择 ESM 或经典脚本入口。包内统一采用 `qjb://挂载ID/成员`，先于宿主路径处理；模块、动态导入、Worker 和资源共享解析规则。`process.argv` 为解释器、绝对包路径和应用参数，`scriptArgs` 为其去掉解释器的部分；分隔符 `--` 去除一次，cwd 保持启动位置。`execArgv` 保留包路径之前的解释器选项。

包内 import.meta 只设置规范地址和 main；主入口及 Worker 入口的 main 为 true，依赖为 false。包内地址不交给宿主 realpath。只读归档的原生引用独立于 JS Runtime/Context opaque，最后一个持有者销毁后释放。完整格式、预算和错误码见 [QJB v1](QJB_FORMAT.md)。

SDK 主机先安装现有模块加载器、事件处理器和 Worker Context 工厂，再调用 `js_cosmo_set_cli(ctx, argc, argv, 1, 5)` 建立包参数，以及 `js_cosmo_bundle_eval(ctx, argv[1])` 执行包；mode 5 保留 SDK 入口身份。最后正常运行事件循环并释放 Context/Runtime。示例见 [tests/native/bundle.c](../tests/native/bundle.c)。生成的 qjsc 应用没有新增包启动命令；未挂载时资源 API 返回明确的 ERR_QJB_MOUNT。

## Terminal extension (#4)

`node:tty`, `node:readline` and `node:readline/promises` provide the bounded Node subset in [TERMINAL_CONTRACT.md](TERMINAL_CONTRACT.md). Process stdio uses TTY classes only when attached. Legacy `os.ttySetRaw(fd, enabled = true)` has paired, nested release. Real PTY/ConPTY source/qjsc/SDK evidence and post-exit native modes are required; applications own their ANSI cursor/screen changes.

## 7. 原始 argv[0] 与部署入口

`process.argv0` 是不可写、不可配置、可枚举的初始调用参数；它与真实载荷路径 `process.execPath` 分开。源码、qjsc 和 SDK 从宿主原始参数读取，Worker 保留父上下文快照。`process.argv[0]` 继续表示真实可执行文件。SDK 未显式设置 CLI 入口时保留原有 SDK 参数约定。

部署回归覆盖自定义 argv[0]、原生 PID、已安装/缓存 loader、无 binfmt、裸 ELF、真实 ARM64 64K 页内核和 Windows 完整性/UNC；合同、复现命令及限制见 [DEPLOYMENT_CONTRACT.md](DEPLOYMENT_CONTRACT.md)。
