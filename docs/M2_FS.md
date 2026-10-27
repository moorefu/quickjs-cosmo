# M2-02 同步文件系统

`node:fs` 与 `fs` 共用模块身份，提供同步文件读写、目录、元数据、描述符和 constants；默认导出与具名导出引用同一实现。接口保持 partial，本文列明具体边界。Callback、fs.promises/FileHandle 属于 M3-02，文件流属于 M3-05，当前不导出占位实现。

## 已接入接口

| 类别 | 接口 |
| --- | --- |
| 高层读写 | readFileSync、writeFileSync、appendFileSync、existsSync、accessSync |
| 目录与路径 | mkdirSync、readdirSync、renameSync、unlinkSync、rmdirSync、rmSync、realpathSync/native、copyFileSync、mkdtempSync |
| 描述符 | openSync、closeSync、readSync、writeSync、fstatSync、ftruncateSync、fsyncSync |
| 对象 | Stats、BigInt Stats 返回值、Dirent、已声明的 constants |

字符串、Buffer 与 Uint8Array 路径在边界拒绝 NUL；Unix 保留字节路径，不强制转为 UTF-8。读写按 ArrayBufferView 的 byteOffset/byteLength 处理 Buffer、TypedArray、DataView 和共享存储；零长度及分离视图行为单独差分。readSync 支持 number/bigint/null 位置及 options 重载，writeSync 包含字符串、视图和 options 重载。

原生层在 `native/fs/sync.c`，JS 外观在 `src/js/node/fs.js`。C 调用期间不回调 JS，保留系统错误后再映射为 Node 的 code、errno、syscall；路径和双路径操作另补 path/dest。Windows 的 UV errno、数字 open flags、uid/gid 和权限位单独转换，不把 Cosmo 的内部值直接当作 Node 值。

read/write/pread/pwrite 与 open 遇 EINTR 重试，实际短读写继续按返回字节推进。close 不在 EINTR 后重试，避免关闭已复用的描述符。高层方法用 finally 关闭自己打开的文件；调用方传入的描述符保留给调用方关闭，不在 GC 或 Context 销毁时擅自关闭。fs.openSync 暴露的是进程内文件描述符，显式关闭责任与 Node 相同。

readFileSync 的普通 Buffer/非 UTF8 路径遵循基线已知 size 的读取上限；未知 size 按块读到 EOF，按实际字节检查 2 GiB-1 上限。小文件不能因不可信的 size 就无限分配。UTF8 快捷路径遵循 [Node v24.21.0 ReadFileUtf8](https://github.com/nodejs/node/blob/v24.21.0/src/node_file.cc)：size 仅作提示，读取继续到 EOF。调用方 buffer/分配函数、缓冲区不足、读中增长、分配失败和关闭都单独验证。引擎自己的内存/字符串限制仍可能先触发。

mkdirSync 支持 mode 与 recursive，返回首个新建目录；Windows 返回路径的 namespace 形式按同宿主 Node 对齐。readdirSync 按字节排序，支持编码、withFileTypes、递归及 Dirent.parentPath。基线不接受的递归字节路径/Buffer 编码组合也通过同源用例固定，不能把它们悄悄转成字符串。

rmSync 使用显式待办栈，先 lstat 再后序删除，不把符号链接当目录递归。force 只吞掉适用的不存在错误，支持 maxRetries/retryDelay 的同步重试。递归 rmdir 保留基线旧接口的删除行为，弃用警告暂未实现。递归 readdir 按基线遍历目录链接；它与 rm 的不跟随链接规则分别测试。

copyFileSync 在截断目标前比较两个描述符的文件身份，避免同文件复制丢失数据；支持独占及普通复制，读写失败时清理已打开的目标并关闭两端。COPYFILE_FICLONE 可退回普通复制；COPYFILE_FICLONE_FORCE 尚无已准入的跨平台克隆后端，明确以 ENOTSUP 失败。realpathSync.native 使用同一原生实现。

## 固定来源与私有路径适配

Nightly 的便携文件名策略会拒绝 Unix 的部分原始字节、换行、末尾点/空格；Node 允许这些名称。`native/fs/paths.c` 以私有符号编译同提交的 openat/mkdirat/renameat/mkdtemp，仅在 Node 的 Unix 创建路径中解除这层便携限制；Windows 仍保留原来的名称检查。

私有 openat 的只读加截断条件也有一个固定补丁：POSIX 按 Node/宿主行为执行，Windows 保留原检查。原文和补丁后 SHA-256 位于 `compat/versions.json`，原始四个文件另由 `native/versions.json` 锁定，源归档不修改。头文件搜索优先使用已验证的 compat-source，再使用原始 Nightly。两个架构确认只定义 qjs_cosmo_fs_* 名称，没有覆盖 libc 的公共入口；std/os 继续使用原有实现。

四份 ISC 源许可加入 NATIVE-MODULES-LICENSES。SDK 和三文件发布包的 readme 都携带原生许可，包布局仍为 readme.txt、run-test262、qjs。许可列表同时包含构建探测使用的候选算法，当前并未因此开放 crypto/zlib 接口。

## 当前边界与后续关联

- 普通运行时的 URL 构造器仍属于 M5-01。当前文件 URL 转换可用于 SDK 提供的 URL 对象；M5 完成后须对全部 fs 路径入口补齐真正 URL 对象的同源验收，不能据此宣称现在已有 node:url。
- Linux birthtime 使用固定 libc 的原生字段；Nightly 从其他时间字段推导它，尚不等同于 Node 的 statx 创建时间。BigInt/日期的形状、精度换算和惰性日期字段已实现，真实创建时间差异保留在清单。
- Windows 数字 flags 支持本阶段公开的访问/创建/独占/截断/追加位；不支持的 UV 专用位返回 EINVAL。mode、真实 ACL、链接和原生元数据仍受宿主能力限制，不能把合成权限当成完整 ACL。
- Windows accessSync 的 X_OK 按 Node 视为存在性检查。realpath 错误使用原生入口的 syscall；Node 在 POSIX 默认实现中可能报告其内部 lstat 等步骤，不能把 native 与默认路径算法的错误细节视为完全相同。
- Windows 仍拒绝 Nightly 不接受的末尾点/空格与控制字符名称。Unix 的原始字节创建、链接元数据和链接删除已有用例；Windows junction、权限故障的完整场景继续纳入 M6 的平台验收。
- writeFileSync 的 flush:true 对本实现的字符串和视图都实际执行 fsync；基线 UTF8 C++ 快捷路径未执行该步骤，本实现保留刷新语义。这是已知实现差异。
- 不新增同步接口的 AbortSignal 语义。异步取消、并发 FileHandle 关闭和流背压随对应 M3 任务实现。

## 验证入口

FS-001 比较正常/失败路径、中文 emoji、编码、视图、fd 游标、大位置读取、Stats/Dirent、调用方 buffer 和目录树。FS-002 比较重载、flags、参数错误、共享/分离视图、字节路径和 Unix 链接行为。

runtime_fs.mjs 在源码和 qjsc 独立 APE 中复用同源用例，并执行 Worker 读写；fs-sdk.exe 的链接期故障注入只存在于测试程序，检查短读写、EINTR、零写、fstat 过大/未知/增长、调用方与内部 fd 所有权，以及分配失败后关闭。反复创建八个 Runtime，保留 ContextOpaque。

CI 传输原有 11 个 APE 加 fs-standalone/fs-sdk，共 13 个相同字节的 APE，在七个平台运行。完整输入、源码、SDK 声明、原生许可和发布包继续由完整性门禁校验。

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

本项完整 CI 通过前不进入 M2-03；最终结果记录在实施状态表。

本地最终验收：Linux 61/61；Windows 同一产物 52/52，另一个既有 Unix 专用用例跳过；Node 差分两端各 17/17，调度生命周期各 19/19；Python 门禁 80 项及两种 TypeScript lib 模式通过。完整跨平台结果以本项提交 CI 为准。
