# 原生 Codex 活动

原生设置中的“Codex 活动”和网页完整设置共用 `CodexActivityMonitor`。原生状态每五秒刷新（失败后十秒），网页订阅同源宿主事件流，最后一个订阅释放或页面卸载时关闭。重新连接会读取当前状态；旧连接、旧订阅和较早的读取不能恢复已经失效的界面状态。

## 启停与归属

每份资料使用自己的桥脚本和临时 loopback 接收端点。`hooks.json` 中必须包含此桥脚本的准确命令及四个生命周期 Hook，桥脚本内容也须匹配，才显示本资料已启用。其他资料的通用 Craft Hub marker 不再使当前资料显示已安装；不完整或被编辑的桥脚本可通过重新审阅修复。

原生启停先只读审阅两个文件，系统确认框展示配置路径、桥脚本路径及保留的其他宿主 Hook 数量。Escape 取消，回车不提交配置；修改须明确选择“启用”或“停用”。启用写入本资料的脚本及 Hook，随后仍需在 Codex 中审阅信任；停用只移除本资料的准确命令，保留其他宿主及用户自定义内容。停用保留脚本，以容纳 Codex 进程缓存的旧命令；接收器在未启用时忽略事件，退出后删除自己的临时端点。

审阅保留五分钟、最多八份，确认与取消都会消费该记录。修改前重新读取 Hook 文件与桥脚本，比较内容及文件身份；变化后要求重新审阅。协作宿主通过 `CODEX_HOME/.craft-hub-hooks-lock.sqlite` 的内核写锁串行修改，退出或崩溃释放锁。只有实际修改会创建锁文件；审阅和取消不创建 Codex 配置。写入结果不明确时，界面先重新读取状态，再允许新的审阅。

新写入使用独立的 `craft-hub-profile-activity-v1` 标记，避免旧 Electron 按旧通用标记移除配置时删掉原生 Hook；本资料旧标记的准确命令仍可识别并在明确审阅后修复。旧宿主和外部编辑器不使用此写锁，应避免同时修改同一份 Hook 配置。替换前还有一次文件检查，但不把它宣称为所有外部编辑器参与的原子事务。符号链接、多重硬链接、超过 1 MiB 或结构不受支持的配置会明确拒绝修改并保留原文件。

## 权限与生命周期

浏览器只可通过 cookie 读取状态和订阅 `/__craft_hub_host/codex-activity-events`；安装和移除桥接方法转交 Swift 系统确认框。`/api/native-host/codex-activity` 的审阅、确认和取消只接受原生独立 bearer，网页 cookie、跨源请求和附加写入参数均拒绝。HTTP 输入不接受路径、命令或覆盖后的审阅内容。

生成的脚本使用固定 `/usr/bin/curl`、一秒期限及显式禁用代理的 HTTP 请求，向当前资料的本机接收器交付 Codex Hook 输入。接收器仅使用会话标识和生命周期字段，不保存提示词；启用后只读近期 rollout 生命周期作为兼容兜底。退出会关闭状态流、等待已经确认的配置写入并退役接收器。原生确认或写入进行时，退出/重启检查会要求先完成操作。

## 验证

```sh
pnpm exec vitest run apps/desktop/test/codex-activity.test.ts apps/desktop/test/codex-activity-hooks.test.ts apps/desktop/test/native-codex-activity.test.ts apps/desktop/test/desktop-bridge-contract.test.ts
swift test --package-path apps/macos --filter 'activity|Activity'
pnpm build:macos
pnpm test:macos-management
```

测试覆盖双宿主保留、精确移除、审阅取消/过期/重放、文件变化、跨进程锁、失效订阅、迟到读取、原生确认取消、连接替换和未知写入回执。包内管理验证在临时 HOME 中预置另一宿主的声明，确认原生写入经过审阅，执行刚生成的夹具桥脚本，在故意设置无效代理时仍接收开始/停止事件，并验证停用后的其他 Hook 保留和退出后的端点清理。它不调用真实 Codex 会话或修改真实 Hook 配置。

### Release App 走查（2026-10-23）

macOS 26.6.2 arm64、Node 24.18.0 的独立 ad hoc 副本通过原生设置走查：

- 启用与停用审阅中的 Escape 均关闭弹窗；回车保持审阅，不提交修改。启用前取消保留原文件字节，未创建写锁文件。
- 明确启用后，原生页显示已启用和 Codex 信任审阅提示；四个本资料 Hook 与四个旧 Electron 夹具 Hook 并存，原有元数据保留。
- 执行本次生成的桥脚本，原生会话数按开始/停止事件显示 1/0。重启后仍识别已启用配置；取消停用保持文件字节不变。
- 明确停用后仅移除本资料 Hook，配置内容恢复为原有夹具对象，脚本保留。两次正常退出均确认 App、sidecar 和临时接收端点退役。

电脑控制启动器会覆盖 bundle 中的 `HOME`/`CODEX_HOME` 环境设置。最初发现审阅指向真实目录时立即取消，仅进行了只读审阅。之后仅在测试副本使用一个固定临时路径的 C 启动器，设置两项环境变量后 `exec` 原样复制的 Release Swift 程序，并重新签名；通过进程环境和弹窗路径双重核对隔离。该启动器不进入产品，也不用于声称标准签名或单实例验收通过。真实 Codex 配置未写入，未触发真实会话或 Codex 信任授权。

本轮还修复了创建 `NSAlert.window` 覆盖此前 Escape 快捷键的问题：先取得窗口和默认按钮，再设置取消键。这里的 UI 验收不替代插件详情弹层、输入法和 VoiceOver 的独立待验收项。
