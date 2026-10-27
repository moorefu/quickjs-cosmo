# Node 兼容入口与行为合同

本文件落实实施规划的 M0-04。状态为目标合同；当前 qjs 尚未提供 `node:process` 或新的进程/资源身份规则。M1-01 已实现模块注册与内部 `.`/`..` 路径归一化，见 [实施记录](M1_MODULE_REGISTRY.md)。Node 基线为 v24.21.0，方法状态由 `compat/node-api.json` 管理。

## 1. 源码解释模式

| 字段 | 目标行为 |
| --- | --- |
| `process.execPath` | 当前解释器的绝对本机路径；不包含 APE loader 参数 |
| `process.argv` | `[execPath, absoluteEntryPath, ...userArguments]`；参数内容原样保留 |
| `process.execArgv` | 实际消费的解释器选项，不包含入口、用户参数或 loader 参数 |
| 主模块 `import.meta.url` | 入口文件的标准 file URL；以 URL 规则编码空格、Unicode 和 Windows 路径 |
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

- `ENTRY-001` 在 Node 记录源码入口身份；当前只保存参考结果，不宣称 qjs 已支持。
- `MOD-002` 验证内部父路径归一化；M1-01 已修复原有模块实例差异，晋升为两端实际执行的差分用例。当前采用语法归一化，不声明 realpath、符号链接或 Node URL 解析兼容。
- `LANG-001/LANG-002` 是两端共用的 ESM/语言测试，不计入已实现的 Node 内建 API 数量。
- qjsc 与 Worker 新身份规则在 M1/M6 中增加实际 fixture 后才能提升支持状态。

差分报告保存到 `build/node-compat/`。`reference_only` 报告只证明 Node 基线 fixture 可执行，不是 QuickJS 验收报告。
