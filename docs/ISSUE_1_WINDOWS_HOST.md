# Issue #1：Windows 文件与启动边界

当前主干复测确认：M6 已修复 Node 同步/异步 realpath 的盘符问题，但旧 os.realpath 仍会错误拼接或返回 ENOTSUP；四种创建入口仍会给点文件增加 Hidden；TMP 指向普通文件会无限重试。长 TMP 在本机因 ProgramData 回退可写而表面启动成功，仍未采用指定目录。

本次修复：

- 旧 os.realpath 复用 Node fs 的原生 GetFinalPathNameByHandle 路径，返回旧接口可用的 Cosmo 斜杠表示；Node 保持宿主路径表示。路径测试以原生文件身份为准，不以接口间字符串相等代替正确性；覆盖盘符根、正反斜杠、相对路径、中文/空格、扩展前缀、junction/符号链接和缺失/非目录错误。
- 固定 Nightly 的 open-nt 适配取消按点前缀自动设置 Hidden；CREATE_ALWAYS/截断时保留已有 Hidden/System 标志。std.open、os.open、fs.writeFileSync 和 promises.writeFile 均经原生 Python 覆写验证。
- 信号路径统一采用 4096 个 UTF-16 单元的预算，预留后缀和扩展前缀空间；GetTempPath 结果必须是现存目录，不能静默改用 ProgramData。启动、目录创建和冲突重试均有上限，并保留 Win32 错误和所选路径。
- 同步扩大退出、fork 清理调用方缓冲区。启动路径在正常 libc 初始化之前执行，使用有界原地拷贝；编译启动兼容对象时启用栈页探测。早期诊断只绕过格式器对自身栈缓冲区的地址登记检查。
- 保留同一 TMP 下的 quickjs-cosmo-sig/分片/逻辑PID.pid 约定；实际子进程向父进程的逻辑 PID 发送信号，验证通信。

新增 test_host_filesystem.py 同时检查源码、Worker、qjsc 与 SDK；SDK 显式安装 Worker Context 工厂并验证调用方 opaque 未被覆盖。Windows 用例额外设置专用临时目录的拒绝创建 ACL，验证错误目录能在五秒内退出，并在 finally 中恢复 ACL。junction 也在外层递归清理前单独移除。

这里只声明已验收的本地文件和路径形式。UNC 网络共享依赖实际共享/权限；部署、完整性级别和更广泛的平台能力分类继续由关联 #3 的真实环境验收覆盖。后续 QJB 与 TTY 能力分别由 #2、#4 实现。

所有兼容源仍来自已锁定 Nightly 提交，原文、补丁及修改后摘要都已更新。运行包的三文件布局不变。完成状态以本次提交的七平台 CI 门禁为准。

## 目录联接补充修复

重开的报告确认 `os.lstat` 和 Node lstat 把目录联接误报为普通文件，`os.readlink` 返回 ENOLINK。固定 Nightly 的 `__readntsym` 只识别 `IO_REPARSE_TAG_SYMLINK`；fstat 因此把无法识别的 mount-point tag 降为普通文件。

兼容补丁同时解码符号链接与目录联接的不同结构，检查返回字节数、UTF-16 偏移/长度及终止空间。成功读取联接目标后，现有 fstat 保留 S_IFLNK。legacy、Node 同步、callback、Promise 和 SDK 共用这一修复；源码锁和修改后摘要继续对应同一 Nightly。

`FS-004` 由锁定的原生 Node 独立创建联接或 Unix 符号链接，比较三种 lstat 入口、悬空目标、Unicode/空格路径、联接祖先和普通文件/目录对照。旧发布 qjs 副本作为负例稳定失败，修复版本通过。宿主文件系统测试另覆盖 legacy readlink 的实际目标、原生文件身份、源码/Worker/qjsc/SDK、联接目录下的动态模块导入及 chdir。夹具只删除自建链接，并在递归清理前验证临时根目录身份。

原始修复本地验证：完整离线构建及构建测试 145/145；Linux 跨入口验证 95/95；Windows 97/97，另有一个预先声明的 Unix shell 用例跳过；Python 110 项及 TypeScript 声明检查通过。48 个独立 APE 的传输清单和三文件发布包通过校验。跨入口用例包含 Worker、SDK Worker 工厂、逻辑 PID 信号往返和原生文件身份核对。

联接补充本地验证：完整离线构建，构建测试 156/156、Linux 跨入口 100/100、Windows 103/103（另有既定 Unix 跳过）、61 项 Node 差分和 TypeScript 检查通过；同一产物通过真实 ARM64 64K 内核八种入口及发布/SDK 摘要校验。追加根目录别名回归后，127 项 Python 和 Windows/Linux 源码、Worker、qjsc、SDK 专项检查通过。联接目标用名称及原生父目录身份核验，允许 UNC/联接祖先与创建时的物理目标使用不同路径文本。

最终补充提交 `56c7332a4ebf3b33a646e30c850e92c2483ce991` 的 [CI 40869825183](https://github.com/moorefu/quickjs-cosmo/actions/runs/40869825183) 已通过构建、全部七个原生平台、真实 64K 内核和 CI gate。Windows 三个平台实际完成 Low/Medium/High、真实 UNC 共享及目录别名验收；Windows ARM64 使用 x64 仿真入口。
