# Runtime Resource Provider（Issue #6）

## 范围与实现

qjs、qjsc、编译后的程序、SDK 和 Worker 统一调用 `native/resources.c`。
`runtime-core.js` 与完整能力声明从原来的 C 字符串迁移到 APE ZIP；CA 使用同一
加载器，不再提供 `js_cosmo_set_ca_provider()`。没有新增第三方依赖；SHA-256
使用现有已审计 crypto closure，后端符号继续私有。

固定成员为 `.quickjs-cosmo/` 下的 `runtime-core.js`、`ca-bundle.pem`、
`capabilities.json`、`resource-manifest.json`。fat 的两份 CPU 代码共同引用一套
ZIP 数据。静态库通过 yoink 自动携带全部资源，SDK 使用者无需额外打包。
单架构包另有既有 `architecture` 成员，CPU LOAD segments 与 fat slice 逐段一致。

构建步骤 `scripts/build_resources.py` 从维护的 JS、锁定 CA 和当前 profile 的
API inventory 生成资源与 canonical JSON 清单。清单按固定顺序记录前三项的
名称、字节数和 SHA-256；C 中只保存小型大小/摘要表及清单摘要，不重复嵌入正文。
发布扫描重新生成预期资源，逐字节比较，拒绝重复、未知和缺失成员。
`runtimeInfo()` 解析与 SDK/release **相同字节**的完整能力声明，再投影成既有的
compact snapshot；架构字段按当前发布物补充，各次调用互不共享 JS 对象。

## C 接口与生命周期

SDK 头文件 `qjs-resources.h`（由 `qjs-cosmo.h` 引入）：

```c
CosmoResourceView view;
int rc = js_cosmo_resource_open(COSMO_RESOURCE_CORE, &view);
if (!rc) {
    /* view.data / view.size: immutable UTF-8 bytes, followed by NUL */
    js_cosmo_resource_close(&view);
}
```

视图借用进程缓存。首次读取在 mutex 内完成；内容与失败结果均缓存，后续线程、
Worker 和 TLS pump 复用。`close()` 清空视图，不释放共享数据，可重复调用。
缓存最多四项，正文上限分别为 JS 4 MiB、CA 4 MiB、能力声明 2 MiB、清单 16 KiB。
先检查 ZIP 中央目录与本地文件头的大小、名称、方法、标志、CRC 及数据范围是否一致，
再解压和分配，验证无 NUL、实际长度与 SHA-256。

只读固定 APE ZIP 成员，不接受路径、callback、CWD 或宿主文件回退；
`COSMOPOLITAN_INIT_ZIPOS` 和 `COSMOPOLITAN_DISABLE_ZIPOS` 均被明确拒绝。
不带 ZIP 的 ELF/开发链接只可使用未启用兼容层的原始 QuickJS SDK 入口；
初始化兼容层、CLI 启动与默认 CA 使用稳定的 `ERR_RESOURCE_UNAVAILABLE` 失败，
不静默降级。
这不是非 Cosmopolitan 工具链支持。

## 错误与验收

错误码包括 `ERR_RESOURCE_NAME`、`UNAVAILABLE`、`MISSING`、`FORMAT`、
`INTEGRITY`、`TOO_LARGE`、`IO`、`MEMORY`（后七项同样有 `ERR_RESOURCE_` 前缀）。
JS 消费方提供 `error.code` 与成员名；TLS 保持失败关闭和原有证书/主机名验证。
无效清单 schema、NUL 或重复成员归 FORMAT；有效但被替换的正文/清单归 INTEGRITY。

`scripts/test_profiles.py --compile` 验证所有入口及 29 项真实 ZIP 故障/覆盖场景，
包括 JS 能力声明错误的 `error.code` 和成员名。
每项使用独立 EXE；Windows ARM 仿真映像延迟释放时，清理最多等待 15 秒，
超时仍作为失败处理。
四个线程同时加载全部资源，检查共享指针、关闭后的生命周期、CA 原始字节和
X.509 解析。七平台复用这些编译产物；真实 ARM64 64K 内核运行同一并发资源测试。
Python 测试验证重复生成的字节/摘要确定性和发布扫描的拒绝行为。
base/full、八个发布 ZIP、固定体积预算及全部既有回归继续作为发布前置门禁。
