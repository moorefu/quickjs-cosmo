# M1-01 统一模块注册层

实施日期：2026-10-27。前置 M0 提交 `17204b6` 的[完整 CI 已通过](https://github.com/moorefu/quickjs-cosmo/actions/runs/40426810729)。本批实现 [规划](NODE_COMPAT_RUNTIME_PLAN.md)中的 M1-01；以下结果记录本地 Windows/Linux 验收，其他主机以本批提交的 CI 矩阵报告为准。

## 1. 公开行为

| 入口 | 行为 |
| --- | --- |
| `std`、`qjs:std` | 同一 QuickJS 模块实例，保留原有导出 |
| `os`、`qjs:os` | 同一 QuickJS 模块实例；裸 `os` 始终保留 QuickJS 含义 |
| `cosmo:runtime` | 具名导出 `runtimeInfo()` |
| 未实现的 `node:*`、`cosmo:*`、`qjs:*` | 导入失败，错误 `code` 为 `ERR_UNKNOWN_BUILTIN_MODULE` |
| `@runtime/*` | 同样明确拒绝，不提供迁移别名 |

静态与动态 import 经过同一注册清单。清单只包含实际实现的模块；`node:fs` 等规划模块仍不可导入。后续实际注册的 `node:*` 可提供同名裸别名，`node:os` 除外。

```js
import { runtimeInfo } from 'cosmo:runtime';
import * as std from 'qjs:std';
std.puts(JSON.stringify(runtimeInfo()) + '\n');
```

`runtimeInfo()` 每次返回新的普通对象，字段为：

| 字段 | 内容 |
| --- | --- |
| `engine` | `quickjs` |
| `quickjsVersion`、`quickjsCommit` | 固定引擎版本与提交 |
| `cosmopolitanVersion`、`cosmopolitanCommit` | 固定工具链版本与提交 |
| `nodeApiTarget` | `v24.21.0`，表示目标合同版本 |
| `platform` | 实际运行系统，使用 `win32`、`linux`、`darwin` 等名称 |
| `arch` | 实际执行架构 `x64` 或 `arm64`；Windows ARM 上经兼容层执行时为 `x64` |
| `builtinModules` | 当前为 `['std', 'os', 'cosmo:runtime']`，只列正式入口 |

修改返回值不会修改注册清单。目标 Node 版本与可导入模块列表不代表完整 Node 兼容；逐方法状态仍查 `compat/node-api.json`。完整后端、配额及逐 API 能力报告尚待后续阶段。

## 2. 路径与各执行入口

新增语法路径归一化，消除内部 `.`、`..` 和重复分隔符；等价路径共享模块实例。Windows 继续转换反斜线，并保留驱动器、绝对根与 UNC server/share。相对路径的前导 `..` 保留。

这里不调用 `realpath()`，保证 qjsc 内嵌资源在源文件不存在时仍能解析；符号链接、URL、包解析和新的 `import.meta` 身份合同仍待后续实现。

统一 C 注册清单位于 [native/module_registry.c](../native/module_registry.c)，通过第五项 QuickJS 补丁接入 qjs、qjsc 和 Worker。每个 context 有独立实例，不共享 JS 对象。qjsc 生成的 context 工厂采用相同初始化；动态 Worker 入口仍需显式打包：

```sh
./dist/qjsc -m -D tests/fixtures/registry-worker.mjs \
  -o build/registry.exe tests/runtime_modules.mjs
```

SDK 交付新增 `qjs-cosmo.h`。手动嵌入的 context 工厂需初始化一次，并在 runtime 安装归一化回调：

```c
#include "quickjs-libc.h"
#include "qjs-cosmo.h"

static JSContext *new_context(JSRuntime *rt) {
    JSContext *ctx = JS_NewContext(rt);
    if (ctx && js_cosmo_init_modules(ctx) < 0) {
        JS_FreeContext(ctx);
        return NULL;
    }
    return ctx;
}

/* js_std_init_handlers(rt) 之后，创建主 context 之前： */
js_std_set_worker_new_context_func(new_context);
JS_SetModuleLoaderFunc2(rt, js_cosmo_module_normalize,
                       js_module_loader, js_module_check_attributes, NULL);
```

仍须遵循 QuickJS 的事件循环与清理顺序，并链接 `-Wl,--wrap=_Exit,-u,__wrap__Exit`。可直接参考 [SDK 验收程序](../tests/native/module_registry.c)。不需要新增第三方原生库；原有 Windows 退出与进程修复继续参与链接。

## 3. 验收与交付

| 验收 | 结果与范围 |
| --- | --- |
| WSL/Linux | 40/40，包括上游快速回归、qjsc 独立程序和手写 SDK 程序 |
| Windows x64 | 38/38，同一批 APE；仅跳过原有 Unix 专用 `test_std` |
| Node 差分 | 两端各 3/3：`LANG-001`、`LANG-002`、`MOD-002` |
| Python 合同/CI 辅助测试 | 70 项通过 |
| 发布包与 CI 传输 | 三文件 ZIP、双架构 SDK、四份独立 APE 完整性校验通过 |

`tests/runtime_modules.mjs` 检查模块别名、具名导出、静态/动态身份、错误代码、元数据隔离与 Worker。额外检查静态未知内建在 qjs/qjsc 中失败；8 MiB 内存上限用例验证元数据分配失败和释放后恢复。手写 SDK 程序在 16 个独立 runtime/context 上验证初始化、导入、销毁与路径边界。

构建清单绑定原生注册源码、公共头文件及元数据生成器的 SHA-256。源码在构建后发生改变、缺少来源记录或 SDK 公共头文件时，CI 传输校验拒绝该产物。原有四项补丁与宿主兼容修复继续保留，发布 ZIP 仍为 `readme.txt`、`run-test262`、`qjs`。

```sh
sh scripts/build.sh --offline
PATH="$PWD/toolchains/cosmocc-nightly-2026-10-26-aefad27c09ff/bin:$PATH" \
  python3 scripts/test.py --upstream --compile --node-compat
python3 scripts/package.py
python3 scripts/ci_artifact.py pack
python3 scripts/ci_artifact.py verify
```

Windows 使用 `python scripts/test.py --upstream --node-compat --standalone build/test-linux/hello-standalone.exe` 验收同一产物。报告位于 `build/test-results/`、`build/node-compat/`；CI 将同一批测试程序传到七个平台。

清单中的 `MOD-001` 为项目运行时测试，不能替代 Node API 差分证据。当前已实现的 Node API 数仍为 0；仅 `cosmo:runtime.runtimeInfo` 声明局部实现。下一项为 M1-02 Buffer/编码，之后推进公共基础与调度合同。
