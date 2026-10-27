# M1-03 公共基础

本项接续已全绿的 M1-02 提交 `c41097f`（[完整 CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40434897922)）。实现范围由 `compat/node-api.json` 与 `types/node-compat.d.ts` 描述，模块仍标为 `partial`。本项完整 CI 全绿后进入 M1-04。

## 模块与全局

| 入口 | 当前子集 |
| --- | --- |
| `node:process` / `process` | argv、execArgv、execPath、env、真实 PID/PPID、platform/arch、versions、cwd/chdir、exitCode/exit、uptime、hrtime/bigint；process 继承 EventEmitter |
| `node:path`、`node:path/posix`、`node:path/win32` 与对应裸别名 | resolve/normalize/join/relative、dirname/basename/extname、parse/format、isAbsolute、toNamespacedPath/_makeLong、sep/delimiter、posix/win32 |
| `node:os` | platform/arch、tmpdir/homedir、hostname/type/release、EOL；裸 `os` 继续指向 QuickJS 模块 |
| `node:events` / `events` | 同步 EventEmitter、追加/前置/一次性监听、移除与查询、newListener/removeListener、errorMonitor、未处理 error |
| `node:util` / `util` | promisify 与 custom Symbol、TextEncoder/TextDecoder |
| `node:assert`、`node:assert/strict` 与裸别名 | 可调用默认导出、ok、equal/notEqual、strictEqual/notStrictEqual、throws/rejects、fail、AssertionError、strict 身份 |
| 全局 | process、console；与模块共享的 Buffer、TextEncoder/TextDecoder |

console 的 log/info/debug 输出 stdout，warn/error/assert 输出 stderr；另提供 dir/trace。差分覆盖常见占位符、标量、普通数组/对象、Buffer 和孤立代理项替换。没有注册 `node:console`；Console 构造器、完整 inspect/options、自定义 inspect、颜色、getter 展示等不属于当前子集。trace 的引擎堆栈文本不作 Node 等同承诺。

assert 的比较与匹配子集不包含 deepEqual/deepStrictEqual；错误对象条件支持标量属性与正则字符串属性。生成的 message/stack 与嵌套深层条件不作等同承诺。EventEmitter 的 captureRejections 和监听数量警告尚未启用；后续按调度和流合同扩展。util 不导出尚未实现的 inspect/format/types/callbackify。

## 入口、状态与宿主

源码入口的 argv、标准 file URL 和 compiled/Worker 差异遵循 [入口合同](NODE_ENTRY_CONTRACT.md)。`-e` 模块 URL 为 `qjs:eval`，内部启动模块为 `qjs:internal`。qjsc 主模块映射到运行中的可执行文件，其他内嵌模块用入口目录相对的 `qjs:embedded/` URL，公开身份不含构建机绝对目录。动态 file URL 加载及完整资源打包仍在后续入口任务验收。

process.versions 只报告真实 QuickJS/Cosmopolitan 版本与提交，不伪造 node/v8。主上下文自然返回 exitCode，显式 exit 先发出 exit 事件；自然 beforeExit/exit 事件、nextTick、定时器存活规则归 M1-04。

每个 Context 保存独立 JS 状态，不占用嵌入者的 ContextOpaque/RuntimeOpaque。原生状态的 GC 标记和终结器管理 JS 引用；同一 Runtime 的第二 Context、重复初始化、反复销毁 Runtime 均有 SDK 用例。

Worker 使用创建时 argv/execArgv/env 快照；修改快照不改变主上下文。cwd 是进程级状态，Worker 的 chdir/exit/exitCode 写入明确拒绝。Worker 销毁、后台任务和取消将继续在 M3 扩展验收。

环境读写先转换和分配，再在短临界区操作宿主环境，枚举深复制后才创建 JS 对象。旧 std 的环境函数加入同一访问锁。Windows Node 外观读取真实 NT 环境，保留键名大小写和本机路径；Node 写入同时更新 Cosmopolitan 的标准化环境视图，以供旧 std/os 使用。旧 std 直接修改 Cosmopolitan 视图的语义仍保留，不将其误宣称为 NT 环境的完整别名。后续子进程任务必须传递自有环境快照。

Windows PID/PPID 使用 Nightly 已有本机原语，路径转换为宿主驱动器格式；release 读取系统 RtlGetVersion，避免 Cosmopolitan uname 的兼容描述替代真实系统版本。调用使用系统已加载 ntdll、固定布局和 MS ABI，不加载第三方宿主库。[RtlGetVersion](https://learn.microsoft.com/en-us/windows/win32/devnotes/rtlgetversion) 与 [版本结构](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdm/ns-wdm-_osversioninfow) 是布局依据。

## 来源与许可

path 采用固定 Node v24.21.0 原始 `lib/path.js`，SHA-256 锁在 `compat/node-sources.json`；生成器验证摘要后，通过内部 primordials/validator 小型适配层执行。不引入通用 require、CommonJS 或 npm 解析。matchesGlob 的额外依赖未启用。其余基础 JS 使用现有引擎原语，宿主绑定基于当前固定 Cosmopolitan。

Node 原始 MIT 声明保留在源文件和 LICENSE，SDK 包含 `NODE-MODULES-LICENSE`，默认三文件发布包的 readme.txt 附带完整声明。运行时无需旁挂 JS 文件或 Node。类型随 SDK 交付，使用 TypeScript 5.9.3 分别以 es2022 和 es2022+DOM 严格编译，防止编码/console 全局声明与 DOM 冲突。

## 验证与复现

新增 PATH-001、EVENTS-001、UTIL-001、ENV-001、CON-001，ENTRY-001 晋升实际差分。路径矩阵包含 4,188 个观察；环境用例包括主目录和临时目录变量删除后的回退。console 同时比较完整 stdout/stderr，结果标记相等不能掩盖输出差异。

`runtime_foundation.mjs` 在解释器和独立 APE 中检查 Worker 快照、模块/全局身份、环境桥接、目录恢复和 GC。独立入口驱动核对 Python 创建的真实 PID/PPID、Unicode 参数、选项、退出码和 URL。CI 传输七份独立 APE，并验证 SDK 与三文件包许可。

ESM 文件名按新合同绝对化，上游 test_std 的两处相对堆栈文件名预期需适配。测试驱动生成副本，只替换这两个明确字符串；其他格式断言保持原样，上游源树保持完整。普通脚本保留已有文件名行为。

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

完整跨平台结果以本项提交的 CI 为准；BSD 尚无 runner，不宣称通过。方法清单区分本地验证与后续 CI 平台。

本地验收：Linux 48/48；Windows 同一产物 43/43，通过七份独立 APE 的相关检查，保留一个原有 Unix 专用跳过；两端 Node 差分各 13/13；Python 门禁 73 项；两种 lib 配置的严格类型检查通过；三文件包、SDK 和 CI 传输完整性校验通过。
