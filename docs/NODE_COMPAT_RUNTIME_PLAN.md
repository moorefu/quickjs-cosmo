# QuickJS Cosmopolitan Node 风格运行时实施规划

日期：2026-10-27（北京时间）。状态：M0、M1-01 已通过完整 CI；M1-02 Buffer/编码已完成本地验收，等待本项提交的完整 CI。逐项状态与门禁证据见 [实施状态](RUNTIME_IMPLEMENTATION_STATUS.md)，接口范围见 [M1-02 记录](M1_BUFFER_ENCODING.md)。

目标是在当前固定版本的 QuickJS 与 Cosmopolitan Nightly 上提供 Node.js 风格的文件、进程、加密、压缩和网络能力，使使用已支持 API 的同一份 ESM 业务脚本可以直接在 Node.js 与本项目运行。优先复用同一 Cosmopolitan 提交中的实现，以及备份分支已有的算法、适配器和测试资产。

本文件规定命名、兼容合同、算法来源、任务顺序和验收要求。阶段完成状态以对应实现、产物和测试报告为准；文中的 API 清单与目录均为建设目标，不表示当前二进制已提供这些功能。

## 1. 固定输入与适用范围

| 项目 | 规划基线 |
| --- | --- |
| 当前源码基线 | `ff255d51f0a89f079c8ca9ba2efb0241ddf776e2` |
| QuickJS | `1ec58aaa769a992213ec2b871b0228074169904b`，VERSION `2026-06-04` |
| cosmocc | Nightly #802，`aefad27c09ffda64c6ac64bd69f758e9f9c7b91d` |
| 工具链归档 SHA-256 | `7f8a0bfd991401e027f794d516bf52a5184b5089e5dd1a50cf9e9ade54b5bb06` |
| Node API 与差分测试基线 | Node.js `v24.21.0` |
| 参考分支 | `backup/remote-main-20261027-031540-c27a168b` |
| 参考提交 | `c27a168be0527a8a6916af5457fa293b65ab88ec` |
| 当前输入锁 | [versions.json](../versions.json) |
| 当前验证范围 | [VALIDATION.md](../VALIDATION.md) |

当前 QuickJS 与工具链输入继续由 `versions.json` 管理，构建不追随新 Nightly。后续新增依赖与 Node 测试工具的版本、来源及校验和，也必须进入可审查的锁定文件。

主目标是 ESM 与已实现的 Node 内建 API 子集。CommonJS、完整 npm 解析、Node-API 动态插件、V8 专有接口、完整 Web Crypto、HTTP/2、UDP 和 Node Worker Threads 暂不属于首轮交付范围。QuickJS 自带 Worker 继续保留，并验证新增模块在其上下文中的支持范围。

“Node 兼容”按模块、方法、参数和平台声明，不能由模块名相同推导为完整 Node 运行时。性能、内存上限和宿主配置差异随能力报告公开。

## 2. 已确定的设计决策

| 编号 | 决策 |
| --- | --- |
| D01 | Node 兼容公开接口采用 `node:*`，项目扩展采用 `cosmo:*` |
| D02 | `@runtime/*` 没有存量消费者，不实现这些模块、别名或迁移层 |
| D03 | 不为标准能力另建 `cosmo:fs`、`cosmo:process` 等平行 API |
| D04 | 当前默认加载模式保留 QuickJS 裸模块 `std`、`os`，增加 `qjs:std`、`qjs:os` 明确入口 |
| D05 | Node 风格代码使用 `node:os`；首轮不改变裸 `os` 的现有含义 |
| D06 | ESM 优先；`require()` 与 npm 包加载仅在明确消费者需要时另行评估，不是必选项 |
| D07 | 按 Node 约定实现参数、返回值、编码、错误和同步/异步行为，不仅对齐函数名称 |
| D08 | 优先使用固定 Nightly 内的库；额外源码按算法最小引入、锁定来源并重新验证 |
| D09 | 统一覆盖 qjs、QuickJS Worker、qjsc 独立程序与嵌入 SDK，记录各入口的实际支持范围 |
| D10 | 保留现有 Windows 进程、退出和句柄修复，避免混入旧分支的宿主实现 |
| D11 | 默认发行包继续保留现有三文件布局；标准 JS 封装随可执行文件内嵌 |
| D12 | 未通过准入验证的后端或方法不计入已支持能力，不自动换算法或回退到外部命令 |

若后续需要改变这些决策，应同步修改本文件、兼容清单与相关合同测试。

## 3. 模块命名与加载合同

### 3.1 标准模块

| 正式入口 | 可提供的裸别名 | 目标能力 |
| --- | --- | --- |
| `node:buffer` | `buffer` | Buffer 与字节编码 |
| `node:process` | `process` | 当前进程对象 |
| `node:path` | `path` | 路径处理 |
| `node:path/posix`、`node:path/win32` | 对应无前缀路径 | 显式路径规则 |
| `node:os` | 首轮不提供 `os` 别名 | Node 风格系统信息 |
| `node:events` | `events` | EventEmitter |
| `node:util` | `util` | promisify 等公共工具 |
| `node:assert`、`node:assert/strict` | 对应无前缀路径 | 合同测试与常用断言子集 |
| `node:timers`、`node:timers/promises` | 对应无前缀路径 | 定时器与 Promise 定时器 |
| `node:fs`、`node:fs/promises` | 对应无前缀路径 | 文件与目录 |
| `node:crypto` | `crypto` | 加密、摘要、密钥与随机数 |
| `node:zlib` | `zlib` | 压缩与 CRC32 |
| `node:stream`、`node:stream/promises` | 对应无前缀路径 | 流、背压和 pipeline |
| `node:child_process` | `child_process` | 子进程 |
| `node:url` | `url` | URL 与文件路径转换 |
| `node:dns`、`node:dns/promises` | 对应无前缀路径 | DNS |
| `node:net`、`node:tls` | 对应无前缀名称 | TCP/TLS 客户端 |
| `node:http`、`node:https` | 对应无前缀名称 | HTTP/1.1 客户端 |

表中入口只在相应实现阶段提供。服务端 API 在客户端合同稳定后另行扩展，不因模块已存在就宣称支持。

加载器需要满足以下要求：

1. 裸别名先归一化，再查缓存，避免 `fs` 与 `node:fs` 产生两份状态。
2. 按对应 Node 模块提供默认导出与具名导出；例如默认对象的 `readFile` 与具名 `readFile` 指向同一函数。
3. `node:fs/promises` 的默认导出与 `node:fs` 的 `promises` 属性为同一对象；ESM namespace 对象的身份另按 Node 行为测试。
4. 静态 import、动态 import、Worker 与 qjsc 使用同一份注册清单。
5. `node:` 路径只解析内建模块，不回退为磁盘路径或第三方包。
6. 未知内建入口按 `ERR_UNKNOWN_BUILTIN_MODULE` 报错；尚未建设的模块不注册占位实现。
7. 内建 JS 模块从内嵌资源加载，不依赖当前工作目录或安装后的旁挂 `.mjs` 文件。
8. 项目内部绑定不形成另一套面向业务的 API；内部名称不作为安全隔离边界。

首轮不实现修改默认导出后再调用 `syncBuiltinESMExports()` 的完整 Node 行为。若实际消费者需要，应连同 `node:module` 单独增加合同。

### 3.2 QuickJS 与扩展模块

| 入口 | 合同 |
| --- | --- |
| `std`、`qjs:std` | 同一份现有 QuickJS std 模块 |
| `os`、`qjs:os` | 同一份现有 QuickJS os 模块 |
| `cosmo:runtime` | 版本、能力、后端、限制与宿主信息 |
| `cosmo:compression` | LZ4 Frame、bzip2、CRC32C、Adler-32 和扩展信息 |
| `cosmo:crypto` | 明确不属于所选 Node API 合同的额外摘要、原始密钥或便捷封装 |

扩展模块采用 Node 风格的命名与参数组织，但使用它们的脚本不自动具有 Node 内建兼容性。`blake2b256` 等名称只有经过基线确认后才能放入 `node:crypto`；否则从扩展模块提供。

`fetch`、`Headers`、`Request`、`Response`、`AbortController`、`AbortSignal` 按对应全局 API 建设，不创建 `node:fetch`。Node Readable 与 Web ReadableStream 是两种合同；前者完成不能替代后者验收。

### 3.3 全局对象与运行时身份

优先提供 `Buffer`、`process`、`console`、`TextEncoder`、`TextDecoder`、`queueMicrotask` 和定时器。`URL` 与网络相关全局在相应阶段加入。

- `globalThis.Buffer` 与 `node:buffer` 的 Buffer 是同一对象；`globalThis.process` 与 `node:process` 默认导出是同一对象。
- `process.versions` 记录真实的 QuickJS 与 Cosmopolitan 版本；Node API 目标版本放到 `cosmo:runtime`，不伪造 `process.versions.node` 或 V8 身份。
- `process.platform`、`process.arch` 使用 Node 约定的名称，并表示进程实际执行平台与架构。Windows ARM 宿主经 x64 兼容执行时，进程架构应与执行架构一致；宿主架构另行报告。
- 解释执行时 `process.argv` 以可执行文件、入口和用户参数组织；qjsc 模式中的入口身份在 M0 固定合同，并由独立程序测试锁定。
- `process.argv`、`process.execArgv`、`process.execPath`、`import.meta.url` 和入口目录分别定义，不能用同一个字符串代替。
- QuickJS Worker 仍使用自己的创建与通信协议；`process.chdir()`、`process.exit()` 等进程级行为在 Worker 中的范围必须显式定义和测试，不据此宣称支持 `node:worker_threads`。

## 4. API 兼容程度与公共约定

### 4.1 支持状态

建设机器可读的 `compat/node-api.json`，逐方法记录以下状态：

| 状态 | 含义 |
| --- | --- |
| `planned` | 本规划中的待实现能力 |
| `partial` | 部分方法或参数范围通过测试，差异已列明 |
| `supported` | 声明范围已通过基线差分与目标交付测试 |
| `blocked` | 已有实现候选，但存在明确的准入或安全阻碍 |
| `unsupported` | 当前范围明确不提供 |

每条记录至少包含模块、方法、参数范围、平台、Node 基线、任务编号、测试 ID 与差异。支持状态按平台和执行入口记录；不能只用一个模块级布尔值掩盖差异。

实际导出的能力必须有可运行实现。声明范围之外的参数应明确失败，不忽略有行为影响的选项，不返回伪造成功结果。

### 4.2 数据、编码与错误

- 按每个 Node 方法的实际合同处理字符串、Buffer、TypedArray、DataView、ArrayBuffer 与 KeyObject，不把所有接口扩成相同输入集合。
- 区分复制与共享底层存储的语义，正确处理 `byteOffset`、`byteLength`、空输入、分离缓冲区和共享缓冲区。
- 异步任务保留输入时必须有明确的生命周期与快照规则；不能让后台线程持有可能被转移或失效的裸指针。
- UTF-8、UTF-16LE、latin1、ASCII、hex、base64、base64url 按相应 Buffer 方法定义。孤立代理项、非法字节、奇数 hex 和 base64 宽松解析使用 Node 差分锁定。
- 路径拒绝内嵌 NUL；中文、emoji、空格、反斜杠、Windows 盘符与 UNC 路径列入测试。
- 对齐异常类别、`code` 以及适用的 `errno`、`syscall`、`path`、`dest`。错误文本与栈不作逐字一致承诺。
- 底层 errno、POSIX wait status 和 Windows DWORD 先在内部保留，再映射到 Node API；不能直接将 QuickJS `os` 返回值作为 Node 返回值。
- 宿主级配额与 Node 方法本身的限制分开记录。新增配额错误属于本项目的已声明差异。

### 4.3 异步与调度

`*Sync` 表示同步计算。Callback 接口采用 error-first 形式，Promise 入口按 Node 约定组织。`crypto`、`zlib`、`child_process` 不创建自定义的 `node:*/promises` 模块。

阻塞调用外包一层 Promise 不能达到非阻塞验收标准。文件操作、DNS、压缩和 KDF 等任务根据后端选择线程任务或非阻塞 I/O，并回投到所属 QuickJS runtime 执行 JS 回调。网络 worker 与其他原生线程不得直接调用 JSContext。

需要建设有界任务队列、完成通知、取消、关闭和 runtime 销毁处理。调度基于现有 QuickJS 事件循环扩展，避免新增独立循环导致定时器、Worker 和网络互相等待。

公开取消参数只用于基线 Node 已支持该参数的方法。其他原生任务的取消用于宿主关闭与资源回收，不给 `pbkdf2` 等接口随意增加一个不兼容的 options 参数。

`queueMicrotask`、Promise、定时器、I/O 与 `process.nextTick` 的顺序先建立基线用例。`nextTick` 没有实现对应顺序前不简单映射为 `Promise.then()`。Timer 对象的 `ref/unref` 和活跃任务是否阻止退出也要单独验收。

## 5. 分模块实施范围

### 5.1 Buffer 与公共基础

首批 Buffer 方法：`from`、`alloc`、`allocUnsafe`、`isBuffer`、`isEncoding`、`byteLength`、`concat`、`compare`，以及实例的 `toString`、`equals`、`copy`、`fill`、`slice`、`subarray`。随后补充常用整数/浮点读写、搜索和字节序方法。

`allocUnsafe` 不能暴露进程敏感内存；若实现选择初始化其内容，应记录性能差异。Buffer 必须保留 Uint8Array 的视图行为，尤其是 `slice()` 的共享语义。

`EventEmitter` 先覆盖 `on`、`once`、`off`、`emit`、监听器查询与移除，并验证未处理 `error` 事件的行为。`util.promisify` 覆盖常用 callback 接口以及 `exec/execFile` 的多返回值适配；不能把所有 callback 一律只取第二个参数。

`assert` 子集用于同源测试；测试驱动本身不依赖尚未实现的断言模块，避免验收自举循环。

### 5.2 文件系统

| 批次 | 接口范围 |
| --- | --- |
| 同步高层 | `readFileSync`、`writeFileSync`、`appendFileSync`、`existsSync`、`accessSync` |
| 同步目录与元数据 | `mkdirSync`、`readdirSync`、`statSync`、`lstatSync`、`renameSync`、`unlinkSync`、`rmdirSync`、`rmSync`、`realpathSync`、`copyFileSync`、`mkdtempSync` |
| 描述符 | `openSync`、`closeSync`、`readSync`、`writeSync`、`fstatSync`、`ftruncateSync`、`fsyncSync` |
| Callback/Promise | 对应已支持操作；`fs/promises.open()` 返回 FileHandle，并实现其读写、stat、sync 与关闭子集 |
| 流 | `createReadStream`、`createWriteStream`，在 stream 基础完成后提供 |

按方法支持编码、flags、mode、递归选项、Buffer/文件 URL 路径和 AbortSignal。`Stats` 的类型判断、日期字段、BigInt 选项与 `Dirent` 的 `withFileTypes` 行为逐项列入合同。Windows 对 mode、链接和权限的宿主差异照实记录。

文件读取按实际字节数执行限制，覆盖部分读写、EINTR、文件在读取中增长、失败后关闭和大于 32 位的偏移。异步 FileHandle 必须定义并发操作与关闭时序。

`watch`、`watchFile`、完整 `cp/glob` 与全部权限/链接操作列后续范围。`existsSync` 的特殊失败返回规则应通过差分明确，不能套用普通抛错模板。

### 5.3 当前进程与子进程

`node:process` 首批提供 `argv`、`execArgv`、`execPath`、`env`、`pid`、`ppid`、`platform`、`arch`、`versions`、`cwd`、`chdir`、`exitCode`、`exit`、`uptime` 与适用的高精度时钟。stdio 在流基础完成后补齐。

`process.env` 的读取、赋值、删除、子进程继承及 Windows 键名规则分别测试。原生调用涉及环境数组时，继续遵守当前修复中的所有权规则。

`node:child_process` 先实现 `spawnSync`、`execFileSync`、`execSync`，再实现 `spawn`、`execFile`、`exec` 与 ChildProcess。使用现有修复过的宿主进程路径，覆盖 cwd、env、PATH、stdio、timeout、maxBuffer、encoding、signal 和 Windows 参数引用。

需要区分 `exec` 的 shell 语义与 `execFile` 的直接执行；不能把任意参数数组拼成 shell 命令。Windows `.cmd/.bat` 与 shell 选项按实际平台合同处理。

异步合同覆盖 `spawn/error/exit/close` 顺序、stdin 关闭、stdout/stderr 同时排空、取消、kill、超时清理及输出达到上限。POSIX wait status 映射为 Node 的 `status/signal`；Windows 高位退出码用同宿主 Node 差分确认，内部原始 DWORD 单独保留。

`child_process.fork()` 的 Node IPC 协议、detached 完整行为与 Node Worker Threads 不属于首批。不能将 QuickJS Worker 当作这些接口的实现。

### 5.4 摘要、派生与随机数

公开入口优先提供：`getHashes`、`createHash`、`createHmac`、`hkdfSync`、`pbkdf2Sync`、`randomBytes`、`randomFillSync`、`randomUUID`、`timingSafeEqual`。对应异步形式在调度基础通过后加入。

重要合同：

- `Hash.update(data, inputEncoding)` 支持链式调用；`digest(encoding)` 控制返回类型与编码。
- SHAKE 的长度由 `createHash(algorithm, { outputLength })` 指定，不沿用旧接口的 `digest(length)`。
- `Hash.copy()` 在所声明算法上复制真实增量状态，不通过保留全部历史输入重算。
- `hkdfSync(digest, ikm, salt, info, keylen)` 返回基线 Node 的 ArrayBuffer。
- `pbkdf2Sync(password, salt, iterations, keylen, digest)` 使用 Node 参数顺序和验证规则。
- `timingSafeEqual` 的长度不一致行为对齐 Node；原生比较核与整个 JS 调用的时序承诺分开。
- 对象完成、重复 digest、错误后使用、GC 和 Context 销毁均有生命周期测试。
- Hash/Hmac 的 stream 用法在 Transform 基础完成后验收；只实现链式 update/digest 时标为局部兼容。

`crypto.hash()` 的便捷接口在以上基础稳定后按固定基线增加，不直接沿用旧分支的同名签名。

### 5.5 加解密与密钥

第一组算法为 AES-128/192/256-GCM 和 ChaCha20-Poly1305；Node 入口使用 `createCipheriv`、`createDecipheriv` 以及相应对象的 `update/final`、AAD 和认证标签方法。

旧分支的整块 AEAD 原语可参考，但需要补充 Node 要求的状态机和增量行为。IV、tag 长度、AAD 顺序、认证失败、输出编码、重复 final 和非法 key 长度分别验证，不能把旧接口固定的 12/16 字节限制直接作为完整 Node GCM 合同。

Ed25519/X25519 通过 `generateKeyPairSync`、`createPrivateKey`、`createPublicKey`、`sign`、`verify`、`diffieHellman` 提供，逐步支持 KeyObject、PKCS8/SPKI DER 和 PEM。JWK 与加密私钥格式另列支持项。

Node Ed25519 的 `sign/verify` 使用基线要求的算法参数；原始 seed、公钥、签名便捷操作若保留，放到 `cosmo:crypto`。Node 入口不能把 32 字节 seed 冒充通用 PEM/KeyObject。

密钥临时副本按生命周期擦除；后台任务持有密钥与取消时的清理要有明确所有权。AEAD 流输出和认证失败时序按所声明 Node 合同测试。

### 5.6 压缩与校验和

`node:zlib` 首批提供 `gzipSync/gunzipSync`、`deflateSync/inflateSync`、`deflateRawSync/inflateRawSync`、`unzipSync`、`crc32` 与已实现常量。随后增加对应 callback 形式及流构造函数。

`unzip` 表示 gzip/zlib 自动识别，不能将其作为 ZIP 文件归档接口。gzip 成员拼接、Zstd 串联与可跳过帧、尾随内容、截断、字典、flush、level、strategy、windowBits 和输出上限按具体格式与基线版本定义。

Zstd 使用 `zstdCompressSync/zstdDecompressSync` 等 Node 名称，选项按该版本的 `params/constants` 结构适配；它在基线中为实验 API，兼容记录必须带版本。

`cosmo:compression` 提供 `lz4CompressSync/lz4DecompressSync`、`bzip2CompressSync/bzip2DecompressSync`、`crc32c`、`adler32` 及格式/后端查询。LZ4 明确为 Frame，不与 raw block 混用。

压缩互操作比较解码后的内容，不要求不同后端/版本产生逐字节相同的压缩输出。ZIP 归档与 Brotli 分别列后续需求。

### 5.7 网络与 HTTP

网络按 DNS/TCP、TLS、HTTP/Fetch 的依赖逐项建设：

| 层 | 首批合同 |
| --- | --- |
| DNS | `lookup` 与 Promise 对应形式；`resolve*` 属于另一组 DNS 合同，后续逐项加入 |
| TCP | `createConnection/connect`、Socket 的读写、超时、半关闭、销毁、错误与事件 |
| TLS | 客户端连接、SNI、证书验证、信任根、握手错误和取消 |
| HTTP | `request/get`、ClientRequest、IncomingMessage、headers/rawHeaders、状态与响应流 |
| HTTPS | 在相同 HTTP 合同下使用已准入 TLS 后端 |
| Fetch | Headers/Request/Response、Abort、重定向、响应解码和声明范围内的 body API |

旧分支 Fetch 的连接管理和 C 传输是参考实现。Node HTTP 与 Fetch 共享传输，但分别处理重定向、自动解压、流和错误规则。不能通过一次性缓存完整响应模拟所有 IncomingMessage 或 Response.body 行为。

IPv4/IPv6、DNS 失败、部分读写、拒绝连接、慢速端点、并发上限、队列取消、超时和 Context 销毁均使用本机测试服务验证。异步 DNS 的非阻塞性质独立测试。

HTTP 连接复用、Agent、请求取消和背压按支持项逐步实现。服务端、WebSocket、代理、HTTP/2、完整 Web Streams 和全部 URL 标准行为不能由旧 Fetch 子集的存在推导出来。

## 6. 算法与依赖选用

### 6.1 首选后端清单

| 能力 | 首选来源 | 准入与边界 |
| --- | --- | --- |
| SHA-224/256/384/512 | 固定 Nightly mbedTLS | 复用旧测试，重新验证当前源码、配置与两个架构 |
| MD5、SHA-1 | 固定 Nightly mbedTLS | 兼容用途，能力列表照实报告 |
| BLAKE2b-512/256 | 固定 Nightly HACL* | Node 可用名称与扩展名称分开；BLAKE2b-256 不按截断 BLAKE2b-512 实现 |
| HMAC/HKDF SHA-2 | 固定 Nightly HACL*/mbedTLS 已有入口 | 每种算法与增量/整块路径固定后端；不能只按算法家族宣称全组合 |
| PBKDF2 | 固定 Nightly mbedTLS 已有入口 | 优先现成实现，确认摘要覆盖与取消粒度后再开放 |
| AES-GCM | 固定 Nightly mbedTLS | 参数、认证失败和状态机验证 |
| ChaCha20-Poly1305 | 固定 Nightly HACL* | 边界、计数器与 AEAD 向量验证 |
| Ed25519、X25519 | 固定 Nightly HACL* | 新旧函数签名不同，重写适配并验证密钥格式 |
| SHA3、SHAKE、BLAKE2s | 备份分支固定 HACL* 相关生成文件作为候选 | 先核对 Nightly 实际实现；缺失部分最小引入、锁定原始来源、单独验证 |
| 安全随机数 | 固定 Nightly 系统熵接口 | 短读、EINTR、失败传播；不以时间、Math.random 或弱源回退 |
| 恒时比较 | 固定 Nightly 原生比较函数 | 验证接口与长度行为，审核实际比较核 |
| gzip/zlib/raw deflate/CRC32 | 工具链 zlib 与 libcosmo | 使用配套头文件；注意 `_Cz_*` 符号映射 |
| Zstd | 同一 Nightly `third_party/zstd` | 按实际文件清单编译，验证帧语义和双架构 |
| LZ4 Frame | 同一 Nightly `third_party/lz4cli` 的库文件 | 仅选库实现，保留对应许可，避免把 CLI 源码整体纳入 |
| bzip2 | 同一 Nightly `third_party/bzip2` | 复用适配器思路并验证完整编解码 |
| CRC32C、Adler-32 | 同一 Nightly 的现有实现 | 与 IEEE CRC32 严格区分 |

每个算法优先固定一个生产后端。备用实现只有确有兼容或性能需求且通过相同合同后才加入；不为方便链接同时引入两套重名 HACL* 实现。

备份分支的 HACL* 源码固定为 `0.3.0 / b5343363688fbe0e3cdc0c488188708f09eb8a14`。这是参考输入，不表示要将整套旧库带入当前构建。Native 代码必须适配当前 Nightly 的符号、结构体与 CPU 分派规则，不能将旧 Makefile 当作新版本构建证明。

RSA/ECDSA、其他 AES 模式、scrypt/Argon2、Brotli 等建立缺口记录。只有有明确使用需求并找到可验证后端后，才进入后续实施批次。

### 6.2 验证等级

| 等级 | 必需证据 |
| --- | --- |
| E0 来源确认 | 固定提交、源路径、许可、实际实现与上游测试入口 |
| E1 构建链接 | 两个架构的头文件、符号、链接探针与依赖闭包 |
| E2 原生正确性 | 对应标准向量、上游测试或必要的 C 边界/故障探针 |
| E3 JS 绑定 | 类型、编码、生命周期、异常、输入视图与资源释放测试 |
| E4 Node 合同 | 同源 JS 在固定 Node 与本项目上的差分通过 |
| E5 交付 | qjs、声明范围内 Worker、qjsc、SDK 与目标平台运行报告 |

E0/E1 不能写为“已验证可用”。`supported` 必须具有适用的 E2—E5 证据，算法与 TLS 还需完成对应安全准入。扩展 API 的 E4 使用独立实现与格式互操作替代 Node 不具备的接口比较。

### 6.3 TLS 单独准入

备份分支基于 Cosmopolitan 4.0.2 的报告明确保留发布阻断，并记录通用 mbedTLS 归档中的 14 项待处理问题。这是旧快照的审计结论，不直接证明当前 Nightly 受影响或已经修复。

TLS 任务必须逐项对照 Nightly 的源码、编译配置、补丁和实际可达范围，分别形成 JS 客户端、公开 crypto 能力与 SDK 的结论。不能因客户端未调用某个入口，就给完整 SDK 静态库背书。

客户端首选 TLS 1.2；当前配置没有启用可交付的 TLS 1.3。协议与套件设置必须限制到已经核验的集合，并强制证书链、时间、DNS/IP 身份与可信根验证。根证书来源、摘要、更新方式及用户自定义 CA 都要有明确合同。

旧修复与负向测试按源码逐项适配，覆盖畸形证书、主机名/IP SAN、过期、弱算法、不可信根、RNG/分配失败和握手清理。不能把 TLS 1.3、FIPS 或完整现代 Node/OpenSSL TLS 能力写进功能声明。

未达到准入标准时，HTTPS 保持 `blocked`，其他已通过模块可以继续实施。所有默认启用与公开交付的模块、SDK 能力必须通过其适用门禁。

## 7. 备份分支资产复用

| 参考资产 | 复用方式 | 必须重做的部分 |
| --- | --- | --- |
| `native/common/binding.*`、`quota.*` | 参考缓冲区持有、所有权、GC 与配额设计 | Buffer/编码合同、当前 QuickJS C API、后台任务生命周期 |
| `native/module_registry.c` | 参考统一注册与 Context 状态 | 改为本规划的命名与注册清单，删除旧公开接口 |
| `native/crypto/crypto.*` | 参考算法原语、流式摘要与零化 | Nightly 后端适配、Node 参数/返回值、密钥与 Cipher 状态机 |
| `native/compression/*` | 参考六格式适配、分块和配额 | Node 帧处理、选项、流与异步接口 |
| `native/haclstar/*` | 参考缺失算法与固定输入 | 与 Nightly 比较、最小引入、去重符号、重新锁定验证 |
| `native/network/*` | 参考传输、连接队列与取消 | 当前调度、Node HTTP 流合同、Nightly TLS 审计 |
| `src/js/network/bootstrap.mjs` | 参考 Fetch 类与全局 API | 逐项对照基线；Web Streams 与完整 URL 行为另验收 |
| `tests/native/*` | 复用算法向量、互操作、GC/配额/Worker 场景 | 改用新入口和新接口合同，移除旧特有假设 |
| `tests/network/*`、TLS 探针 | 复用本机服务、畸形输入和生命周期场景 | 原生接口、证书时间与当前源码重适配 |
| `scripts/verify_native.py` 等 | 参考 Python 交叉验证及报告组织 | 接入当前 `scripts/test.py` 和 CI 清单 |
| `types/*.d.ts` | 参考能力分类 | 按新 API 重写类型，避免把旧 Uint8Array 合同当作 Node 类型 |
| 旧宿主补丁与发行脚本 | 仅对照历史问题与测试 | 当前分支的进程修复、锁文件、CI 和发布方式继续作为基线 |

参考时使用固定提交读取，不需要切换当前工作树。例如：

```sh
git show c27a168be0527a8a6916af5457fa293b65ab88ec:native/crypto/crypto.c
git show c27a168be0527a8a6916af5457fa293b65ab88ec:tests/native/contract.mjs
```

旧测试中“拒绝字符串/所有其他视图”“所有格式只允许单帧”“不同长度比较返回 false”等规则不得原样成为 Node 合同。已通过旧版本测试，只能作为复用线索。

## 8. 代码组织与构建接入

建议按以下边界组织新增源码；目录创建时再以实现需要细化：

```text
native/
  common/              缓冲区、错误、配额、生命周期
  scheduler/           后台任务、完成通知、取消
  fs/ process/         必要的宿主原语
  crypto/ compression/ 算法与格式适配
  network/             DNS、socket、TLS、HTTP 传输
  module_registry.c    统一注册与能力入口
  build.mk             本项目原生模块构建规则
src/js/
  node/                Node 兼容外观与公共基础
  cosmo/               扩展接口
  internal/            共用实现
compat/
  node-api.json        方法、参数、平台与测试覆盖清单
native/versions.json   原生依赖、补充源码及补丁锁
types/
  node-compat.d.ts      已实现的 Node 子集
  cosmo.d.ts            项目扩展
tests/
  node/ native/ network/ fixtures/
scripts/
  prepare_native.py    输入获取、校验与源码准备
  test_node_compat.py  Node 与 qjs 差分驱动
```

内部“Node 外观—原生绑定—算法/系统后端”分层。C 层负责资源和计算原语，JS 层组织公共对象与状态机；语义敏感处保留可独立测试的边界。

### 8.1 现有构建文件的接入点

| 现有文件 | 后续改动要求 |
| --- | --- |
| `versions.json`、`scripts/build_config.py` | 保持当前固定输入与目录；增加原生锁的关联和 Node 测试基线 |
| `scripts/bootstrap.py` | 必要时恢复同一 Nightly 的源归档，支持离线与摘要校验 |
| `scripts/prepare_compat.py`、`compat/build.mk` | 保留现有宿主修复及 `_Exit` 包装；新原生构建不替代它们 |
| `scripts/build.sh` | 接入原生依赖构建、内嵌 JS 生成和双架构库交付 |
| `patches/` 中新增补丁 | 仅调整 CLI、宿主库、加载器和构建接入；尽量保持 QuickJS 引擎核心不变 |
| `scripts/artifact_manifest.py` | 记录模块清单、内嵌 JS/原生源码摘要、依赖、补丁、后端和实际功能 |
| `scripts/test.py` | 接入新合同、差分、Worker 和独立程序测试 |
| `scripts/ci_artifact.py` | 扩展新源码归档、独立测试程序与 SDK 文件的白名单和摘要验证 |
| `.github/workflows/build-ape.yml` | 固定 Node 测试工具，扩展缓存输入、报告与同一产物矩阵 |
| `scripts/package.py` 与发布脚本 | 保留三文件发布包、版本校验与发布门禁 |

当前 manifest 只扫描 `dist/` 根及 `.aarch64/`，CI 传输也有路径白名单。新增 SDK 子目录、测试程序或源码归档时，必须同时更新完整性校验，不能只复制文件到新路径。

### 8.2 可重复构建与 SDK

- 额外 Cosmo 库从工具链同一提交构建；避免混用 4.0.2 头文件/对象或宿主动态库。
- 锁文件记录归档/文件 URL、提交、SHA-256、许可、补丁及修改后摘要；离线模式遇到缺失或不匹配输入明确失败。
- 尊重上游按架构、源文件设置的优化和 CPU 分派，禁止全局 `-march=native`；HACL* SIMD/汇编路径用双架构探针确认。
- 新旧 HACL* 与 mbedTLS/系统符号去重，记录所链接的实际归档与对象；不以“链接成功”替代运行验收。
- qjsc 识别内建模块并为生成程序加入统一注册、内嵌 JS 与所需静态链接依赖。构建时生成内嵌字节码要处理引导顺序，避免编译器依赖尚未生成的自身模块。
- Worker 的入口模块、动态 import 和必要字节码同样纳入独立程序合同；不对任意动态文件路径作自动打包承诺。
- SDK 包含两个架构对应的库、头文件、许可与准确链接示例；手工嵌入路径继续保留当前退出包装参数。
- 精简运行包无需 SDK、Node 或外部 JS 文件。文档/类型可随源码与 SDK 交付；是否新增独立 SDK ZIP 在打包任务中决定，不改变默认三文件 ZIP。
- SDK 只声明经审查的项目接口与依赖范围；通用第三方归档是否随包、暴露哪些符号和头文件需要单独审核。

## 9. 实施任务与依赖

M0 的基础交付与验证结果见 [M0 实施记录](M0_FOUNDATION.md)，后续进度见 [实施状态](RUNTIME_IMPLEMENTATION_STATUS.md)。每项实现应引用任务编号，更新方法清单，并附该任务的验收证据。按用户要求，每项提交推送并等待完整 CI 全绿后，再进入下一项。

| 阶段与任务 | 依赖 | 工作项 | 退出条件 |
| --- | --- | --- | --- |
| M0-01 合同清单 | 无 | 建立模块、方法、参数、平台和缺口表；冻结 Node v24.21.0 | 首轮方法都有目标状态、阶段、平台和测试 ID，可机器检查 |
| M0-02 来源与探针 | 无 | 固定原生源码、许可和 C 链接/运行探针 | 候选后端达到 E0/E1，列出补充依赖与阻碍 |
| M0-03 差分驱动 | M0-01 | 同源 ESM、序列化结果、异常和事件轨迹 | Node 基线可重复执行，报告校验实际版本 |
| M0-04 入口合同 | M0-01 | 明确 argv、qjsc 入口、Worker 进程级行为与任务退出 | 合同与未来用例齐备 |
| M1-01 模块注册 | M0 | 统一清单、别名、默认/具名导出、qjs 与 qjsc 接入 | 导入身份和独立程序最小用例通过 |
| M1-02 Buffer/编码 | M1-01 | Buffer、编码、字节转换和错误基元 | 复制/视图与编码边界差分通过 |
| M1-03 公共基础 | M1-01 | process/path/os、console、EventEmitter、基础 util/assert | 声明的同步方法差分通过 |
| M1-04 调度合同 | M1-01 | Promise、定时器、微任务与存活规则 | 顺序、取消、ref/unref 支持范围固定 |
| M2-01 原生构建 | M0-02、M1 | 同提交依赖、两个架构、输入锁和许可 | E1/E2 证据可重建，未通过项不启用 |
| M2-02 同步 fs | M1-02/03 | 高层文件、目录、描述符与元数据 | 正常/失败/部分 I/O 与路径差分通过 |
| M2-03 摘要与 KDF | M2-01、M1-02 | SHA-2、兼容摘要、BLAKE2b、HMAC/KDF、随机数和比较；增量对象 | 向量、类型、对象状态与 Node 差分通过 |
| M2-04 同步压缩 | M2-01、M1-02 | 三种 zlib 格式、Zstd、扩展格式与校验和 | 外部互操作、帧合同、损坏与输出限制通过 |
| M2-05 同步子进程 | M1-03、M2-02 | spawnSync/execFileSync/execSync | 现有进程回归及 Node 返回语义通过 |
| M3-01 原生任务调度 | M1-04、M2-01 | 有界队列、唤醒、取消、销毁 | 长任务期间定时器推进，退出无泄漏/悬挂 |
| M3-02 异步 fs/算法 | M3-01、对应 M2 任务 | Callback、fs/promises、随机/派生/压缩异步 | 非阻塞、回调一次、并发/取消合同通过 |
| M3-03 Stream | M1-02/03、M3-01 | Readable/Writable/Duplex/Transform 与 pipeline/finished | 背压、错误传播、关闭和异步迭代通过 |
| M3-04 异步子进程 | M3-03、M2-05 | ChildProcess、stdio 流、事件和终止 | 双流大输出、事件顺序、超时清理通过 |
| M3-05 文件/算法流 | M3-03、对应 M2 任务 | 文件流、Hash/Hmac、压缩 Transform | 文件—摘要/压缩—文件管线通过 |
| M4-01 密钥与 AEAD | M2-03、M3-03 | KeyObject/DER/PEM、Ed/X25519、Cipher 状态机 | 标准向量、格式互操作与 Node 差分通过 |
| M4-02 扩展摘要 | M0-02、M2-03 | SHA3/SHAKE/BLAKE2s 最小后端与接口 | 来源锁定、独立向量、增量和内存边界通过 |
| M5-01 DNS/TCP/URL | M3、M1-02 | 异步 lookup、Socket、URL 子集 | 本机 IPv4/IPv6、错误、超时、半关闭通过 |
| M5-02 TLS 审计 | M0-02，可提前开展 | 对照旧报告、Nightly、CA 与 SDK 范围 | 独立安全结论与必要修复/负向测试完备 |
| M5-03 TLS 接入 | M5-01/02 | 客户端 TLS、信任链、SNI 与取消 | 本机证书/协议/故障场景通过 |
| M5-04 HTTP/Fetch | M5-01、M3-03 | HTTP/1.1 客户端及 Fetch 声明子集 | 两套上层语义与响应流分别通过 |
| M5-05 HTTPS | M5-03/04 | HTTP 与 TLS 集成 | HTTPS、重定向/解码、取消与泄漏检查通过 |
| M6-01 全入口交付 | 各已启用任务 | Worker、qjsc、手工 SDK、三文件包和许可 | 声明能力达到 E5 |
| M6-02 CI 与发布 | M6-01 | 同一 APE 七平台矩阵、报告和清单 | 构建及所有必需验收通过 |
| M6-03 文档与类型 | 各阶段持续更新 | 类型、示例、差异、能力与发布说明 | 类型与实际导出一致，示例可在两端执行 |

可按 M1/M2 的已完成子集形成开发产物，能力标为 `partial`。异步、流、TLS 等未完成模块不通过导出占位函数来扩大兼容声明。阶段编号表示依赖顺序，不构成对工期的承诺。

首个开工批次 **M0-01—M0-04**、**M1-01—M1-04** 及 **M2-01—M2-05** 已通过完整 CI。**M3-01 原生任务调度**、**M3-02 异步 fs/算法**、**M3-03 Stream**、**M3-04 异步子进程**、**M3-05 文件/算法流** 及 **M4-01 密钥与 AEAD** 已通过完整 CI。当前实现 **M4-02 扩展摘要**；本项完整 CI 全绿后进入 **M5-01 DNS/TCP/URL**。逐项进度和 CI 链接见 [实施状态](RUNTIME_IMPLEMENTATION_STATUS.md)。

## 10. 测试设计与报告

### 10.1 同源 Node 差分

新增测试优先为同一个 `.mjs` 文件，使用 `node:*` 导入，在 Node v24.21.0 与 qjs 执行。测试夹具与规范化结果由 Python 驱动，不能靠两套不同业务代码声称兼容。

比较值、返回类型、对象属性、错误类别/代码、callback/事件顺序和资源结束状态。只规范化 PID、临时路径、时间、平台特有字段等声明的差异，不删除失败结果或关键类型差异。

同宿主比较 Windows 与 Windows、Unix 与 Unix；平台自身支持不同的操作单列期望。Node 的算法列表依赖其构建配置，测试基线同时记录 `process.versions` 与实际算法清单，比较声明交集。

随机数不以“每次必不同”或统计分布证明安全。验证类型、长度、填充范围与故障传播；随机协议结果通过已知密钥/nonce 的向量和独立实现验证。

### 10.2 必需用例组

| 测试 ID 前缀 | 必需场景 |
| --- | --- |
| MOD | 静态/动态导入、裸别名同实例、默认/具名导出、fs.promises 身份、未知 node 路径、旧入口不存在 |
| BUF | 空字节、偏移视图、共享/复制、slice/subarray、编码和非法/孤立字符 |
| EVT | EventEmitter、微任务/定时器轨迹、取消、活跃任务、ref/unref 声明范围 |
| FS | Unicode/Windows 路径、错误、部分 I/O、关闭、递归、Stats/Dirent、64 位位置 |
| PROC | shell/直接执行、cwd/env/PATH、参数、两路大输出、timeout/maxBuffer、原始状态映射 |
| HASH | 标准向量、55/56/63/64/65 字节等块边界、copy、重复结束、大文件分块与 GC |
| KDF | HMAC/HKDF/PBKDF2 向量、参数验证、返回类型、输出长度与异步取消 |
| KEY | Ed25519/X25519 向量、KeyObject、DER/PEM、无效密钥和拒绝弱/无效输入的后端合同 |
| AEAD | AAD/IV/tag、整块与增量、认证失败、编码、状态机与清理 |
| ZIP | 各格式外部编码/解码、拼接/尾随/截断、字典、flush、输出限制、CRC 多项式 |
| STR | 背压、drain、半关闭、pipeline 失败、destroy、异步迭代和多字节解码边界 |
| NET | 本机服务、IPv4/IPv6、DNS、慢端点、拒绝连接、重定向、解码、排队/取消 |
| TLS | 主机名与 IP SAN、过期/不可信链、协议/套件、RNG/分配失败与握手资源释放 |
| LIFE | 输入转移、getter 引发的 buffer 失效、并发任务、Context/Worker 销毁与重复关闭 |
| APE | qjs、Worker、qjsc 静态/动态导入、无旁挂 JS、双架构 SDK、同一产物跨宿主 |

保留现有 `tests/runtime_process.js`、`scripts/audit_runtime.py` 与自编/上游快速测试。新增 Node 入口不能破坏 `std/os` 的已有合同。

算法期望来自标准向量和独立实现；Python hashlib/hmac/zlib/gzip/bz2 可直接复用，测试专用的 Zstd/LZ4 等工具单独锁定。测试工具不进入运行时依赖。

### 10.3 CI 与证据

沿用单次构建、同一产物验收：Linux x86_64、Linux ARM64、macOS Intel/ARM64、Windows 2022/2025 x64、Windows ARM64 x64 兼容执行。继续区分宿主架构、测试工具架构和 APE 执行架构。BSD 在有实际 runner 前不宣称已验收。

每个报告记录 Node 版本与实际执行路径、源码/工具链/依赖/补丁摘要、qjs/qjsc 摘要、API 清单版本、平台架构、通过/失败/不支持/跳过及原因。必需场景因配置、工具或 fixture 缺失而跳过时，门禁不能视为通过。

Node 与 qjs 的超时和输出大小由驱动独立约束；本机网络服务使用动态端口和显式就绪通知。TLS 证书时间夹具需要可重复生成或固定验证时钟方案，避免未来证书过期导致误判。

新独立测试程序和 SDK 文件必须进入 CI 传输与摘要清单。测试结束后验证产物未被测试修改。报告只保存必要摘要，避免上传完整继承环境、私钥和含凭据请求。

## 11. 验收与交付完成定义

一个方法达到 `supported` 时，必须同时具备：

1. 命名、签名、输入范围、输出类型、同步/异步行为及错误合同。
2. 固定且已准入的后端，以及该方法适用的标准向量/原生边界测试。
3. JS 绑定、Node 差分、资源释放与平台差异测试。
4. qjs、Worker、qjsc 与 SDK 在所声明范围内的运行证据。
5. 更新后的机器清单、类型、示例、能力报告和输入/产物摘要。

首轮运行时交付完成还要求：本文件声明的目标子集逐项有结果；所有默认启用能力通过同一 APE 的必需 CI；TLS 与 SDK 的阻碍有明确处理结果；三文件运行包可独立执行；旧宿主兼容测试全部保持通过。

能力数、函数导出数或静态链接成功不作为兼容率。性能报告使用同输入与同宿主的吞吐、耗时、峰值内存和产物大小，分别比较同步、流和异步路径，不继承旧分支性能数字。

## 12. 后续范围与变更管理

下列工作保留为独立范围，按实际消费者需求排期：

- CommonJS、`require/createRequire`、package.json、exports/imports、node_modules 解析。
- 将裸 `os` 映射为 Node 的可选加载模式；需同时解决 Worker、qjsc 与旧脚本的入口规则。
- 完整 `node:module`、Node Worker Threads、子进程 fork/IPC 和原生插件。
- HTTP/TLS/TCP 服务端、UDP、WebSocket、HTTP/2、代理与更完整的 Agent。
- RSA/ECDSA、更多对称模式、scrypt/Argon2、Web Crypto、Brotli 和 ZIP 归档。
- 完整 Web Streams、Blob/FormData、更多文件监视与平台专属接口。

实施中发现当前后端无法满足某个 Node 合同时，应更新该方法状态与差异，选择验证过的新路径或暂缓该方法；不能在同名 API 下悄悄换成旧分支语义。增加新原生依赖、扩大 TLS/SDK 范围或改变固定基线时，补充来源、测试和决策记录。

本文件的任务状态由实现提交逐步更新；具体 API 明细、算法覆盖和平台结果落到机器清单与报告，不在多份文档中维护相互冲突的“已完成”列表。

## 13. 固定参考资料

- 当前工程：[README](../README.md)、[输入锁](../versions.json)、[验证记录](../VALIDATION.md)、[构建脚本](../scripts/build.sh)、[测试驱动](../scripts/test.py)。
- Node v24.21.0：[ESM](https://nodejs.org/download/release/v24.21.0/docs/api/esm.html)、[Buffer](https://nodejs.org/download/release/v24.21.0/docs/api/buffer.html)、[fs](https://nodejs.org/download/release/v24.21.0/docs/api/fs.html)、[crypto](https://nodejs.org/download/release/v24.21.0/docs/api/crypto.html)、[zlib](https://nodejs.org/download/release/v24.21.0/docs/api/zlib.html)。
- Node v24.21.0：[process](https://nodejs.org/download/release/v24.21.0/docs/api/process.html)、[child_process](https://nodejs.org/download/release/v24.21.0/docs/api/child_process.html)、[stream](https://nodejs.org/download/release/v24.21.0/docs/api/stream.html)、[HTTP](https://nodejs.org/download/release/v24.21.0/docs/api/http.html)、[TLS](https://nodejs.org/download/release/v24.21.0/docs/api/tls.html)。
- 固定 Nightly：[HACL* 接口](https://github.com/jart/cosmopolitan/blob/aefad27c09ffda64c6ac64bd69f758e9f9c7b91d/third_party/haclstar/haclstar.h)、[构建规则](https://github.com/jart/cosmopolitan/blob/aefad27c09ffda64c6ac64bd69f758e9f9c7b91d/third_party/haclstar/BUILD.mk)、[mbedTLS 配置](https://github.com/jart/cosmopolitan/blob/aefad27c09ffda64c6ac64bd69f758e9f9c7b91d/third_party/mbedtls/config.h)、[mbedTLS 测试](https://github.com/jart/cosmopolitan/blob/aefad27c09ffda64c6ac64bd69f758e9f9c7b91d/third_party/mbedtls/test/BUILD.mk)。
- 参考提交：[原生算法说明](https://github.com/moorefu/quickjs-cosmo/blob/c27a168be0527a8a6916af5457fa293b65ab88ec/docs/NATIVE-ALGORITHMS.md)、[原生接口类型](https://github.com/moorefu/quickjs-cosmo/blob/c27a168be0527a8a6916af5457fa293b65ab88ec/types/runtime.d.ts)、[网络合同](https://github.com/moorefu/quickjs-cosmo/blob/c27a168be0527a8a6916af5457fa293b65ab88ec/docs/HTTP-HTTPS-CLIENT-SPEC.md)、[旧 TLS 审计](https://github.com/moorefu/quickjs-cosmo/blob/c27a168be0527a8a6916af5457fa293b65ab88ec/docs/MBEDTLS-SECURITY-AUDIT.md)。
