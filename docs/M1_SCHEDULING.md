# M1-04 调度合同

本项在 M1-03 的 `0bd7b38` [完整 CI](https://github.com/moorefu/quickjs-cosmo/actions/runs/40448736721) 全绿后开始。实现沿用 QuickJS 的宿主轮询、Worker 消息和 Promise job 队列；后台计算线程与有界原生任务队列仍属于 M3-01。本项自身完整 CI 全绿前不进入 M2-01。

## 接口与顺序

`node:timers` / `timers` 提供 setTimeout/clearTimeout、setInterval/clearInterval、setImmediate/clearImmediate，与全局函数同实例。promises 属性与 `node:timers/promises` / `timers/promises` 默认对象同实例；Promise 接口包含 setTimeout、setImmediate 和异步迭代 setInterval。util.promisify 对前两者返回对应 Promise 函数。

Timeout 支持 ref/unref/hasRef、refresh、close、Symbol.toPrimitive 和 Symbol.dispose；Immediate 支持 ref/unref/hasRef 与 Symbol.dispose。数值 ID 属于当前 Context，不能传给另一个 Worker。清除后的 Timeout 不再 refresh；已触发且未显式清除的 Timeout 可以 refresh。Interval 在回调开始时安排下次到期，不将阻塞期间错过的次数补成回调洪流。

| 检查点 | 当前合同 |
| --- | --- |
| ESM 顶层 | 先排空 Promise/queueMicrotask，再处理 nextTick |
| 普通脚本顶层 | 先处理 nextTick，再排空微任务 |
| 定时器、Immediate、宿主 I/O/消息回调后 | nextTick → 全部微任务 → 微任务产生的 nextTick，重复到稳定 |
| 同批到期定时器 / Immediate | 回调之间执行上述检查点；新建任务进入后续批次 |
| 顶层 timer 与 immediate 谁先执行 | 不承诺 Node 自身不保证的跨阶段时间竞赛顺序 |

process.nextTick 使用独立队列，queueMicrotask 使用 JS_EnqueueJob。两者没有通过 Promise.then 相互替代。参数、回调 this、Promise 类型验证和错误代码由同源差分检查。

普通定时器与 Immediate 分别聚合成宿主唤醒，轮询使用同一 Nightly 的单调时钟。到期批次按截止时间与创建顺序选择。JS 回调只在所属 runtime 线程运行，轮询间保留原有 I/O 与 Worker 接入。

## 存活、取消与退出

默认计时任务有 ref；unref 任务可在其他引用使循环存活时运行，单独存在时不阻止退出。单纯的未完成 Promise 不保持进程存活。没有可推进任务的顶层 await 以 13 退出，显式 exitCode 优先。

自然退出发出 beforeExit；监听器可安排新任务，使循环继续运行。最终发出一次 exit；exit 内安排的异步任务不运行。显式 process.exit 不发 beforeExit。主上下文的回调异常、queueMicrotask/nextTick 异常和默认未处理 rejection 以 1 退出，并停止后续回调。qjsc 生成的独立程序也安装 rejection 跟踪器。

Worker 的未处理错误终止所属循环并报告到 stderr，不通过该路径退出整个主进程。它不提供 Node Worker Threads 的 error/exit 事件协议。原有 std.exit、os 的 POSIX/DWORD 合同不变。

Promise 定时器支持 `{signal, ref}`。AbortError 包含 name、code=`ABORT_ERR` 与 cause；已经取消的信号不创建计时任务。一次性任务在完成时移除取消监听器，异步迭代在 return/throw/取消时清理 Interval。回调式定时器的剩余参数按回调参数传递，不擅自解释为取消 options。

## 取消信号与事件全局

加入 AbortController、AbortSignal（abort/timeout/any、reason、throwIfAborted、onabort）、EventTarget、Event 和 DOMException。EventTarget 支持监听器身份、capture 去重、once/passive/signal、移除、阻止默认行为和同步派发；没有 DOM 节点树或浏览器传播路径。AbortSignal.any 使用弱依赖与终结清理，取消时先设置依赖信号状态，再派发对应事件；不依赖 GC 时机保证正确性。

这些全局用于当前定时器及后续 fs/网络接口；不代表实现浏览器 DOM。Event 时间戳原点、引擎堆栈、完整 Web IDL 描述符和错误文案不作 Node 完全等同声明。Timeout 的超界/非有限延时按最小延时处理；当前不复刻 Node 的延时警告文本和 warning 事件。未声明 process 的 uncaughtException/unhandledRejection 事件接管；默认错误门禁持续生效。promises.scheduler 不在本项初始导出中。

## SDK 与生命周期

手工 SDK 使用 js_std_init_handlers、统一模块注册和 js_std_await/js_std_loop。普通嵌入模式允许同一 Context 反复运行事件循环；空闲不冒充整个嵌入进程退出。CLI 与 qjsc 模式使用入口合同的退出事件。宿主自行选择 rejection tracker；调用 std 的默认 tracker 即选择其错误门禁。

ContextOpaque 不被调度器占用。初始 SDK 调度验收采用一个 Context 驱动一个循环；多个 Context 的同时调度将随 M3/M6 的原生任务归属继续验收。销毁前释放 std handlers，再释放 Context/Runtime，取消剩余唤醒；不向已销毁 Context 回调。

## 验证

EVT-001 比较 ESM、nextTick、微任务、计时批次、句柄、Promise 返回、取消和参数错误；ABORT-001 比较取消与 EventTarget。test_scheduling.py 在独立子进程中检查存活、未完成顶层 await、退出码、beforeExit 再调度和错误终止，不允许十秒 unref 任务拖住进程。

runtime_scheduling.mjs 在源码与独立 APE 中验证 Worker、取消、GC 与失败隔离；scheduler-sdk.exe 反复创建/销毁 Runtime，并在同一 Context 上运行两轮循环。CI 传输九份独立 APE，默认发布 ZIP 继续只有三个文件。

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

本地验收：Linux 54/54；Windows 同一产物 47/47，保留一个原有 Unix 专用跳过；两端 Node 差分各 15/15，独立生命周期差分各 19/19；Python 门禁 73 项；es2022 与 es2022+DOM 类型检查通过；九份独立 APE、SDK 和三文件包完整性校验通过。方法清单保持 partial，完整跨平台结果以本项提交的 CI 为准。
