# Hapi 对 Craft Hub 手机远程任务方案的适配性评估

> 调研日期：2026-08-27。评估对象为 [tiann/hapi](https://github.com/tiann/hapi)，源码快照 `bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2`；只使用 Hapi 官方仓库、源码、发布记录，以及其直接依赖 tunwg 的官方仓库。这里的目标方案特指：`手机 iOA / 太湖身份 → 个人 DevCloud → 本机 Craft Hub → Codex task`。

## 结论先行

**Hapi 非常值得参考，也值得作为独立产品做一次对照实验，但不建议把它的源码、Hub、Web UI 或 Codex adapter 直接并入 Craft Hub。**

它已经完整解决了“手机远程控制本机 Codex”问题：手机 PWA 通过 Hub 的 REST + SSE 操作会话，Hub 通过 Socket.IO 控制本机 Runner，Runner 在指定工作目录启动 Codex，远程 Codex 会话使用官方 `codex app-server` JSON-RPC；还包含任务创建、消息队列、状态同步、取消、审批、终端、文件浏览、恢复与本地/远程交接。[来源：README](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/README.md)、[How it works](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/docs/guide/how-it-works.md)、[Supported agents](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/docs/guide/agents.md)

但这也意味着 Hapi 不是“一个可以拿来补上中继的小模块”，而是与目标能力高度重叠的完整产品。直接采用会同时带来第二套项目选择、会话、Agent 生命周期、审批、移动 UI、认证和持久化模型，违背“不要重复 Codex 与 Craft Hub 已有能力、首版只保留最小状态”的约束。

推荐关系如下：

```text
短期需求验证
  └─ 独立运行原版 Hapi，确认手机控制本机 Codex 是否真的高频

Craft Hub 正式实现
  └─ 保留极简 Taihu / DevCloud / local-agent 协议
      ├─ 借鉴 Hapi 的 runner 生命周期和安全边界
      └─ 继续复用 Craft Hub 已有 Codex Task API，不移植 Hapi Codex client

未来可选插件
  └─ HapiExternalProvider：检测已安装 Hapi，打开其 Web/PWA
      （进程级组合，不复制或链接 Hapi 源码）
```

## Hapi 实际是什么

Hapi 由多个完整组件组成，而不是单一 SDK：

- **CLI / Agent wrapper**：启动和恢复多种编码 Agent，会话可在本机终端与远程模式之间交接。
- **Hub**：提供 REST API、SSE、Socket.IO、SQLite 持久化、权限流和通知。
- **Runner**：本机后台进程，连接 Hub，接受 RPC 后在本机启动、停止和监控 Agent session。
- **Web/PWA**：React 移动 Web，支持聊天、审批、终端、文件树、diff、语音、推送和远程创建会话。
- **原生客户端**：仓库已有 SwiftUI iOS 和 Kotlin Android 客户端，并发布了 companion client contract。

官方文档明确将 Hub 描述为中央协调器，CLI 与 Hub 使用 Socket.IO，Web 与 Hub 使用 REST + SSE，Hub 使用 SQLite 保存 session 与 message。[来源：架构文档](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/docs/guide/how-it-works.md)

Hapi 的 PWA 不只是一个“发任务”表单；它包含缓存会话、聊天、推送、分享目标、文件上传等完整移动体验。[来源：PWA 文档](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/docs/guide/pwa.md)

## 与目标方案的架构映射

Hapi 支持 Hub 与 Runner 分开部署，官方文档给出的 split-hub 模式是：远端 Hub 保存会话并暴露 API，本机 Runner 以 `HAPI_API_URL + CLI_API_TOKEN` 主动连接 Hub，然后在本机启动 Agent。这和“DevCloud 不运行 Codex，本机执行”的核心判断一致。[来源：Split hub + remote runner](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/docs/guide/installation.md#split-hub--remote-runner-peer-discovery)

```text
目标方案                              Hapi 对应物
手机 iOA 页面                         Web / PWA
太湖认证                              Hapi access token → JWT（不兼容）
个人 DevCloud 中继                    Hapi Hub
本机 Craft Hub agent 主动连接          Hapi Runner → Hub WebSocket
项目别名                              Runner workspace roots / directory
创建本机 Codex task                    Runner spawn → hapi codex
粗粒度状态与摘要                       Hapi session/message/event（远比所需更丰富）
```

因此，Hapi 证明了整体拓扑可行，也证明 Codex 必须在本机执行；它没有证明“把 Hapi Hub 放进 Craft Hub”是最小实现。

## Codex 支持程度

Hapi 对 Codex 的支持不是简单执行一条命令，而是完整适配：

- 本机模式包装 Codex TUI；远程模式连接 `codex app-server` JSON-RPC。
- 支持创建、恢复、取消、消息队列、mid-turn steer、模型、推理强度、service tier、`default | read-only | safe-yolo | yolo` 权限模式和 `plan` collaboration mode。
- Runner 能远程创建普通 checkout 或 worktree session；Codex session 可回到本机继续。
- Hub client contract 暴露 session、message、permission、machine、spawn、cancel/stop 等接口。

来源：[Agent support matrix](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/docs/guide/agents.md)、[REST contract](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/docs/api/client-contract/rest.md)、[Runner spawn implementation](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/cli/src/runner/run.ts)

这部分技术上很有价值，但不适合复制到 Craft Hub。Craft Hub 已经有 Codex Task API 和自己的任务状态；再引入 Hapi 的 App Server client 会形成两套 Codex 会话所有权、状态映射和审批语义。更稳妥的边界仍然是：**远程层只创建 Craft Hub 已有 Codex task，并保存外部 task ID、粗粒度状态和最终摘要。**

## 通信、部署与认证

### 通信

- CLI / Runner ↔ Hub：Socket.IO 长连接及 RPC。
- 手机 Web ↔ Hub：REST 写操作、SSE 状态流。
- 本机 Runner 还启动一个仅监听 `127.0.0.1` 随机端口的本地控制服务。
- Hub 可在本机通过 tunnel 暴露，也可部署在远端；Runner 始终可以主动连接远端 Hub。

Hapi 为第三方 companion client 写了较完整的 REST/SSE contract；但 CLI ↔ Hub 的内部面不是给外部客户端使用的稳定公共协议。`@hapi/protocol` 在仓库中是 private workspace package，Hub 和 Web 也是 private package；这说明直接依赖其 TypeScript schema 不是受支持的集成方式。[来源：Client contract index](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/docs/api/client-contract/index.md)、[shared/package.json](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/shared/package.json)

### 认证

Hapi 的手机认证与太湖身份不是同一种模型：

1. Hub 首次运行生成约 43 字符的长期 `CLI_API_TOKEN`。
2. 手机通过 QR / deeplink 获得 access token。
3. 手机调用 `POST /api/auth` 换取 4 小时 JWT；之后 API 使用 Bearer JWT。
4. Runner 使用 Hub URL 和原始 token 连接。
5. namespace 只是同一 Hub 内的会话隔离后缀，不是企业身份系统。

[来源：Auth & pairing contract](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/docs/api/client-contract/auth.md)

这反而支持当前极简方案保留 `agentToken`：太湖只能证明手机请求来自本人，本机后台连接并没有浏览器注入的 `x-tai-identity`。Hapi 同样要求 Runner 持有机器侧凭据，而不是让后台连接匿名领取任务。

若把太湖反向代理放在未修改 Hapi 前面，仍不能自然替代 Hapi access token/JWT。要么手机再配对一次，太湖成为重复认证；要么修改/包裹 Hapi auth middleware，把太湖 identity 映射成 Hapi JWT。后者已经不是直接复用，并会带来 AGPL 和升级维护成本。

### 部署

Hapi 最简单的个人部署是本机 `hapi hub --relay` + `hapi runner start`。内置 relay 使用 tunwg，官方描述为 WireGuard + TLS 端到端加密；也支持 Cloudflare Tunnel、Tailscale、反向代理和远端 Hub。[来源：Deployment](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/docs/guide/deployment.md)

tunwg 本身是独立的 MIT 项目，可自建 server，也可作为独立二进制使用；但它解决的是“给本机 HTTP 服务建立公网 tunnel”，不是“DevCloud 暂存最小任务，本机主动轮询”。如果采用 tunwg，架构会变成公网入口直达本机 Hub，应继续依赖 Hapi 自身鉴权，不能只依赖 URL 隐蔽性。tunwg 官方也提醒证书透明度日志会暴露随机子域名，必须为被转发服务设置认证。[来源：tunwg README](https://github.com/tiann/tunwg)、[tunwg MIT License](https://raw.githubusercontent.com/tiann/tunwg/master/LICENSE)

## 数据边界与安全差异

Hapi 的默认安全目标是“每人自己的 Hub”，不是“云端只保存 24 小时的最小任务信封”。Hub 使用 SQLite 保存完整 session 和 message，官方架构文档明确说明自托管 Hub 的本地数据库为明文、由操作系统保护。[来源：Why Hapi](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/docs/guide/why-hapi.md)

如果 Hub 部署在 DevCloud，完整提示词、Agent 输出和会话元数据也会随 Hub 进入云端 SQLite。要满足当前 `Q19=A` 的最小保存要求，就需要重写 Hapi 的存储和消息投影，已经失去直接复用的意义。

Hapi 还默认提供比首版授权边界更大的能力：

- 手机远程批准或拒绝 Agent 权限。
- 手机终端可执行命令。
- 文件浏览、git diff、上传和 remote spawn。
- 可切换 `yolo` 等权限模式。

这些能力本身并非缺陷，但与已确认的“手机不能远程批准、不能 push/publish/message/change permissions、只看粗粒度状态与摘要”不符。若复用整个 Hapi Web，需要隐藏 UI 还不够，必须在服务端真正关闭相应 API/RPC。

Hapi 的 workspace root 防护值得借鉴：它对请求路径做 realpath / symlink 解析，校验是否落在允许 root 内，并在目录创建或检查之后再次校验，减少 symlink race 逃逸。[来源：MachinePathPolicy](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/cli/src/api/machinePathPolicy.ts)、[Runner 二次校验](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/cli/src/runner/run.ts)

Craft Hub 首版仍应更严格：手机只传已在本机预授权的 `projectAlias`，云端和手机都不能传任意绝对路径；本机从 alias 解析 cwd 后再做 canonical path 与 trust 校验。

## 许可证与复用义务

Hapi 根仓库和 CLI/Hub/Web package 使用 **AGPL-3.0-only**。[来源：Hapi LICENSE](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/LICENSE)、[CLI package manifest](https://github.com/tiann/hapi/blob/bc9df82dc6e24140a4c76dfd6a86c0e53df9f8d2/cli/package.json)

对 Craft Hub 的实际影响：

- **运行未修改的 Hapi 二进制**：可以作为独立程序使用，不要求把 Craft Hub 改成 AGPL。
- **Craft Hub 插件通过进程或 URL 打开独立 Hapi**：若双方是清晰独立程序、没有复制/链接 Hapi 代码，通常比源码合并风险低；仍应保留 Hapi 自身许可证和通知。
- **复制 Hapi 源码、schema、Web 组件或 Codex adapter 到 Craft Hub**：派生/组合边界会触发 AGPL 风险，不适合 MIT Craft Hub 在未做法律评估前采用。
- **修改 Hapi Hub 并通过网络向用户提供服务**：AGPL 第 13 条要求向远程交互用户提供修改版本的对应源代码。
- **仅借鉴思想、拓扑和公开 API 事实并独立实现**：不应复制其表达性代码、类型或 UI；在文档中注明来源。

以上是工程许可证评估，不是法律意见。若未来决定在正式产品中链接、分发或托管修改版 Hapi，应由合规/法务确认派生作品与网络服务义务。

tunwg 是 MIT，可单独复用并保留版权和许可文本；这不改变 Hapi 自身的 AGPL 许可。[来源：tunwg LICENSE](https://raw.githubusercontent.com/tiann/tunwg/master/LICENSE)

## 维护活跃度与依赖风险

Hapi 维护非常活跃：

- 当前仓库页面显示约 1,397 commits、4.9k stars 和 545 forks；这些只是社区关注度快照，不等同于稳定性。[来源：Hapi repository](https://github.com/tiann/hapi)
- 2026-08 的 release 页面连续列出 `v0.27.x`、`v0.28.0` 和 `v0.29.0`；`v0.29.0` 发布于 08-19，主分支在 08-27 仍有提交。[来源：Releases](https://github.com/tiann/hapi/releases)
- 当前 CLI package 版本为 `0.29.0`，尚未达到 1.0；其内部 protocol package 为 private。

结论是“项目活跃且能力成熟度高”，但不是“适合作为 Craft Hub 稳定内部 ABI”。快速发布和 private wire schema 意味着 fork、复制内部协议或兼容内部 Socket.IO RPC 都会持续产生升级成本。若复用，应优先采用独立二进制或文档化的 REST/SSE client contract，而不是导入内部 package。

## 可直接复用与仅借鉴

| 部分 | 判断 | 理由 |
| --- | --- | --- |
| 原版 Hapi 独立运行 | **可直接复用，适合需求验证** | 最快获得手机控制本机 Codex；不修改 Craft Hub，但不满足太湖与最小云数据要求 |
| Hapi 作为可选外部 Provider/插件 | **可考虑** | 插件只检测/启动外部 `hapi` 并打开 URL；不复制源码，用户选择 Hapi 自己的认证和部署 |
| tunwg 独立 tunnel | **技术上可复用，当前不推荐** | MIT、简单，但把入口直达本机，不是已选的 DevCloud 最小任务中继模型 |
| Hapi REST/SSE companion contract | **可参考；仅在采用 Hapi Hub 时直接调用** | 文档完整，但会把 Craft Hub 变成 Hapi client，并引入其完整 session 模型 |
| split Hub + outbound Runner 拓扑 | **强烈借鉴** | 与个人 DevCloud + 本机 agent 拓扑同构 |
| workspace roots / symlink 二次校验 | **强烈借鉴，独立实现** | 能强化 project alias 的本机安全边界 |
| Runner heartbeat、进程跟踪、取消、版本偏差处理 | **借鉴，按需缩减** | 首版只需单任务锁、心跳、租约和取消，不需要完整 fleet 管理 |
| SSE cursor / reconnect / gap contract | **后续借鉴** | 极简首版可用轮询；确有实时性需求后再加，避免提前引入完整事件协议 |
| Hapi Hub / SQLite 存储 | **不复用** | 保存完整会话，违反最小云数据与 24 小时保留策略 |
| Hapi Web/PWA | **不复用** | React 与 Craft Hub Vue 不同，功能范围远超只发任务/看状态 |
| Hapi Codex app-server adapter | **不复用** | Craft Hub 已有 Codex Task API；复制会形成双重所有权并有 AGPL 风险 |
| `@hapi/protocol` 源码/schema | **不复用** | private workspace package、AGPL 仓库内部 contract，不是稳定公共依赖 |

## 对当前设计的具体影响

Hapi 调研不需要推翻已经确认的极简方案，但应吸收以下五点：

1. **保留机器侧 `agentToken`。** 太湖只认证手机用户；本机 agent 必须有独立、可轮换的机器凭据。首版一个静态随机 token 足够，无需二维码、公钥和多设备管理。
2. **本机只主动连接。** 采用长轮询即可；只有实际延迟或流量证明需要时再升级 WebSocket。不要为首版直接暴露 Craft Hub 本地 API。
3. **项目只用 alias。** 本机 alias → cwd 解析后，执行 canonical path、symlink、trust 和 session expiry 校验；同一项目只允许一个远程任务。
4. **Codex 仍由 Craft Hub 现有 Task API 管理。** 远程层只传 prompt、project alias 和 task ID，不复制 Codex 消息、审批、diff 或 app-server protocol。
5. **云端维持最小投影。** 只保存待领取 prompt、alias、状态和短摘要，完成/失败后最多 24 小时；不保存代码、完整 transcript 或终端日志。

Hapi 还提供一个有价值的产品判断：若个人实际需要的是完整的手机聊天、审批、终端和 session handoff，而不只是“离开座位时追加一条任务”，那么应直接使用 Hapi 或做 Hapi 外部插件，没必要在 Craft Hub 内重建它。只有当“太湖本人限定、Craft Hub 项目/trust 复用、最小云数据”是不可替代需求时，当前极简自研才有独立价值。

## 建议的验证顺序

1. **不改业务代码，先用原版 Hapi 做一次独立对照实验**：限定一个测试仓库和默认权限，验证手机发自然语言给本机 Codex 的真实使用频率与交互需求。此实验不代表最终接入方案，也不接太湖。
2. 若只需要“发任务 + 看摘要”，继续实现 Craft Hub 极简 Taihu/DevCloud bridge；以 Hapi 的 runner/path tests 作为安全测试清单，不复制源码。
3. 若发现频繁需要完整聊天、远程审批、终端和无缝 handoff，暂停自研 UI，改为评估 `HapiExternalProvider` 或直接使用 Hapi。
4. 暂不 fork Hapi、不把 Hapi Hub 部署到 DevCloud、不移植其 Codex adapter；这些动作只有在明确接受完整 Hapi 产品模型和 AGPL 义务后才重新评估。

最终推荐仍是：**当前 Craft Hub 方案继续保持极简；Hapi 作为需求验证工具、架构参考和未来可选外部插件，而不是内置实现底座。**
