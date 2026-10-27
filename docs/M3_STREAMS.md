# M3-03 Node Stream 基础

依赖 M1 的 Buffer、EventEmitter、编码、nextTick/定时器和 AbortSignal。Stream 是每个 Context 自己的 JS 对象，不新增原生库、后台 JS 线程或全局事件循环。M3-02 的完整 CI 已通过：[5877ce7](https://github.com/moorefu/quickjs-cosmo/actions/runs/40537555777)。

## 接口和状态

启用 `node:stream`/`stream`、`node:stream/promises`/`stream/promises`。默认导出为 Stream 构造函数，其 Readable/Writable/Duplex/Transform/PassThrough 和 promises 成员与命名导出、Promise 模块共享身份。构造函数支持 ES class 子类及 `call` 配合原型链继承。

Readable 提供 push/unshift/read、setEncoding、pause/resume/isPaused、pipe/unpipe、from、iterator 和 Symbol.asyncIterator。Writable 提供 write/end、cork/uncork、setDefaultEncoding；Duplex 同时实现两端，支持 allowHalfOpen:false。Transform 支持 transform/flush 回调，PassThrough 保留输入。实例公开相应 length/highWaterMark/objectMode、readable/writable/end/finish、needDrain/corked/flowing、destroyed/closed/errored 状态。

支持 read/write/writev/construct/destroy/final/transform/flush 选项钩子及原型覆写。回调重复调用进入 ERR_MULTIPLE_CALLBACK；销毁后迟到的写完成不再次交付用户回调。默认自动销毁，正常结束可用 autoDestroy:false 保留对象。emitClose:false 关闭事件不对外发送。signal 和 addAbortSignal 产生 AbortError/ABORT_ERR，保留 cause；Symbol.asyncDispose 返回关闭完成的 Promise。

字节流以字节计算水位，objectMode 以对象数计算。水位是生产者的背压反馈，不是用户继续 push/write 的硬配额；输入和排队引用受 Runtime 内存配额约束。写操作逐个执行，corked 批量可交给 writev；drain 和写回调遵循 Node 基线顺序。Transform 在可读端达到水位时保留写完成回调，待下游读取后释放。

setEncoding 跨 chunk 保留 UTF-8 不完整序列、UTF-16LE 字节/代理对、base64/base64url 三字节余数；保留 BOM、尾部替换和缓冲区已有数据的转换。latin1/ascii/hex 使用现有 Buffer 编码规则。该解码器为流内部实现，不新增 node:string_decoder 模块声明。

## 生命周期与组合

pipe 处理多目标背压、end:false、drain、unpipe 和目标关闭；普通 pipe 本身不等于失败时销毁整条管线。pipeline 安装每端终止观察器，首次错误时关闭管线，完成回调/Promise 在清理后交付；已完成端不会被重新注入一个错误。finished 检查 end/finish/error/close、提前关闭和 signal，返回监听清理函数；Promise 的 cleanup:true 移除观察监听。finished 的 signal 取消观察，不主动销毁流。

异步迭代消费字节或对象，传播流和迭代器错误。from 接受同步/异步 Iterable、Promise 值，单个 string/Buffer 作为一个输入块。默认提前 return 销毁流，iterator({destroyOnReturn:false}) 允许后续继续读取；销毁/close 的异步时序按 Node 合同保留，不保证 for-await 提前退出时 close 已经发出。迭代器 return 在清理时调用。

当前为明确子集：不提供 Web Streams 转换、Readable 的 map/filter/compose 等操作器、旧式 wrap、Duplex.from、Web/函数管线阶段或 pipeline 的 end:false；后者显式拒绝。文件流、Hash/Hmac/压缩 Transform 在 M3-05 接入，异步 ChildProcess 在 M3-04 接入。未声称完整覆盖 Node 私有 _readableState/_writableState 字段或所有极端参数/调度组合，API 清单保持 partial。

## 验收

- STR-001：同源 Node/qjs 对照对象/字节背压、读缓冲、同步 read、写回调、writev/cork、半关闭、构造/销毁钩子、多目标 pipe、Transform 和 pipeline。
- STR-002：读取/写入/变换/final/flush/construct 失败、排队写回调一次、延迟 destroy、提前关闭、AbortSignal、finished 监听清理和参数错误。
- STR-003：逐字节解码、异步迭代、return、from 的 Promise/错误值、Symbol.asyncDispose 与数组 pipeline。
- STR-004：Worker、qjsc 内嵌 Worker、SDK 和背压期间定时器推进；SDK 反复创建/销毁 Runtime 并清理待构造流。

本地验收：Linux 完整回归 90/90，Windows 69/69（另跳过一项 Unix 专用检查）；两端同源 Node 对照均为 32/32，调度生命周期均为 19/19。Python 80 项检查、TypeScript 5.9.3 的 ES2022/ES2022+DOM 正反向声明检查、运行包与包含 24 个 APE 的 CI 传输包校验通过。API 清单现有 440 项、29 个模块和 44 个测试条目。

本项完整 CI 全绿后进入 M3-04。阶段证据与 CI 链接见 [实施状态](RUNTIME_IMPLEMENTATION_STATUS.md)。
