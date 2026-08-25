# DeepSeek Harness 作为 Craft Hub 底座的适配性评估

> 调研日期：2026-08-25。仅使用 DeepSeek 官方仓库、文档、源码和发布记录。这里的“底座”指 Craft Hub 的运行时与扩展模型建立在 DeepSeek Harness 之上，而不是把它作为一个可调用的外部 Agent。

## 结论先行

**现阶段不建议直接基于 DeepSeek Harness 开发 Craft Hub。** 保持 Craft Hub 自己的轻量、vendor-neutral 控制平面，并把 Codex、DeepSeek Harness 等已完成的 Agent 产品放在适配器之后更合适。

原因不是 DeepSeek Harness 能力不足，恰好相反：它已经是一个包含 Agent loop、会话、工具、Shell/文件系统、技能、审批、沙箱、持久化、Web UI、工作流和插件系统的完整 Agent Harness。以它为底座会让 Craft Hub 变成另一个 Harness 的发行版，并与 Craft Hub 已有的项目发现、信任、执行、插件和 UI 边界大量重叠。对于“Craft Hub 没必要重复做 Codex 已经实现的功能”这一约束，最一致的选择是**调度并链接回原生客户端**，而不是在 Craft Hub 内再引入第二套 Agent 客户端和运行时。

建议的关系是：

```text
Craft Hub（项目与能力控制平面）
  └─ AgentDispatcher（很薄的公共契约）
      ├─ CodexAdapter → 官方 Codex SDK / 客户端
      └─ DshAdapter   → DeepSeek Harness SDK（未来可选）
```

`AgentDispatcher` 不应抽象 Agent 内部的消息、工具、审批或 diff；这些继续由原生客户端负责。Craft Hub 只保留项目、工作目录、任务意图、外部任务/会话 ID、粗粒度状态、最终摘要与“在原生客户端中打开”能力。

## 项目确认

准确项目是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，npm CLI 为 `@deepseek-ai/dsh` / `dsh`。官方 README 将它定义为 DeepSeek AI 开发的开源 Agent Harness，并提供 `dsh web` 启动自身 Web UI；不要与同名的非官方仓库混淆。[来源：官方 README](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/README.md)

## 它实际包含什么

DeepSeek Harness 不是一个供宿主简单“派发任务”的轻量库，而是完整产品运行时：

- Cordis 插件树是核心组合机制；模型适配器、工具注册表、会话日志和 Agent loop 本身都是可替换插件。
- Profile 由多个 Bundle、用户 patch 与命令行 patch 叠加；基础 Bundle 已提供模型、工具、持久化、沙箱、审批、设置、凭据和遥测，`web` 与 `headless` 再提供不同产品表面。
- 持久化的 session events、运行中的 `agent/*` events 和文件/工具等 capability events 构成扩展点。
- 默认产品还覆盖工作流、后台任务、子 Agent、技能、终端、LSP、附件、凭据、计划模式以及 Host/Client API。

这些边界来自它的[架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/architecture.md)和[包分组清单](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/README.md)。后者在当前快照中列出 40 余个功能组；仓库实际包含两百余个 workspace package manifest。这说明它的可组合性很强，也说明采用它不是增加一个依赖，而是接受一整套应用架构。

### 扩展点质量

DeepSeek Harness 的扩展设计是它最值得借鉴的部分：

- 能力被拆为 Service Definition、Provider、Consumer，扩展依赖接口而非具体 provider。
- 插件通过 `ctx.effect()`、`ctx.on()` 和 `ctx.waterfall()` 注册可回收的 effect、事件与拦截链。
- Profile/Bundle 能在不改核心源码的情况下替换模型、工具、沙箱、存储和 UI 组成。
- Host 和浏览器 Client 有明确分层，并通过生成的类型化 RPC contract 相连。

来源：[Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/architecture.md)、[Capability Seams](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/capability-seams.md)、[API Gateway](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/api-gateway.md)。

这套设计适合“打造自己的 Agent Harness”。但 Craft Hub 当前更像跨项目控制平面：其核心需要稳定地发现项目能力、执行显式命令、维护 trust boundary，并将任务交给外部 Agent。为获得 DSH 插件能力而迁移到 Cordis，会同时引入新的 service/event/config/profile/bundle 概念，并替换 Craft Hub 已有的 runtime/plugin 设计，迁移收益暂时不足以覆盖耦合成本。

## Vendor-neutral 程度

DeepSeek Harness **不是只能使用 DeepSeek 模型**。它有 LLM adapter seam，官方模型配置文档列出 DeepSeek、Anthropic、OpenAI 兼容端点以及 Codex OAuth 等 provider；子 Agent 层也可接 DSH、ACP、Codex 和 Claude Code。[来源：模型配置](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/user/guide/providers.md)、[Subagent packages](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/subagent/README.md)

但“支持多个模型/Agent”不等于“作为底座没有平台耦合”：

- 应用组合、生命周期和扩展 API 全面依赖 Cordis 与 `@deepseek-ai/dsh-*` package graph。
- Profile、Bundle、配置 patch、session event 和 Host/Client RPC 都是 DSH 自己的产品协议。
- SDK 驱动的是一个完整 DSH runtime 子进程，runtime 的具体能力仍由 `cordis.yml` 组合决定，而不是一个独立于 DSH 的通用 Agent 协议。[来源：TypeScript SDK](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/sdk/client/README.md)
- 官方默认配置、环境变量和 Python SDK 默认 provider/model 仍以 DeepSeek 路由为中心。[来源：Python SDK 指南](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/docs/user/guide/python-sdk.md)

因此它在**模型 provider 层**相对中立，在**宿主运行时层**则是明确的 DSH/Cordis 平台。Craft Hub 若基于它开发，很难继续把公共 runtime contract 描述为独立于任何 Agent vendor。

## 与 Codex 的实际集成方式

DeepSeek Harness 已提供 Codex 子 Agent provider，但这不是“连接用户正在使用的 Codex 客户端”：

- 每次调用启动官方 Codex wrapper 的 `app-server --stdio`，创建一个 ephemeral thread，只执行一个 turn。
- Codex 版本被固定为 `@openai/codex@0.147.0`；provider 自己实现 initialize、thread/turn、审批响应、错误映射、取消和进程回收。
- Codex 的认证和原生配置仍然权威，但 commentary、推理、工具活动、diff、usage 和产品 ID 不会进入父 DSH session。
- 当前明确不支持 continuation、resume、pooling、progress stream 或 Codex session persistence。

这些限制均由官方包文档直接声明。[来源：`dsh-subagent-codex`](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/subagent/subagent-codex/README.md)

所以不应为了接 Codex 而采用 DeepSeek Harness：这条路径会让 DSH 成为父 Agent、Codex 成为一次性子 Agent，还会引入一个固定版本的 App Server 协议实现。它比 Craft Hub 直接通过官方 Codex SDK 派发任务更厚，也更接近重新实现 Codex 客户端协调逻辑。

## SDK 成熟度与活动度

项目开发活跃，但目前不稳定：

- README 明确标注 **Developer Preview**，并警告会发生 compatibility-breaking changes。[来源](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/README.md)
- 当前仓库版本为 `0.1.1-rc.2`，仍是 release candidate。[来源：package.json](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/package.json)
- 官方发布页显示 2026-08-17 至 08-21 五天内连续发布 `v0.1.0-rc.7`、`rc.8`、`v0.1.1-rc.1` 和 `rc.2`，全部标为 pre-release；这说明维护节奏很快，也印证 contract 正在快速变化。[来源：Releases](https://github.com/deepseek-ai/deepseek-harness/releases)
- SDK 的 newline-delimited JSON-RPC 当前没有 protocol version negotiation、mid-turn cancel、per-session close 或 per-prompt result；放弃运行需要关闭整个 runtime。[来源：SDK Protocol](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/sdk/protocol/README.md)、[TypeScript SDK limitations](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/sdk/client/README.md)

这适合实验性 adapter，不适合作为 Craft Hub alpha 的基础 ABI。直接依赖会使 Craft Hub 的发布节奏受到 DSH breaking changes 牵引。

## 许可

源码使用 [MIT License](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/LICENSE)，允许使用、修改、分发和再许可，但需要保留版权及许可声明。第三方依赖另有 notices。

“DeepSeek Harness”同时是注册商标。官方允许准确描述“built on/compatible with DeepSeek Harness”，但建议项目名使用 `DSH` 而不要直接包含完整商标，也不得造成官方背书的误解。[来源：Brand Guidelines](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/BRAND_GUIDELINES.md)

许可不是阻碍，产品架构耦合和预发布稳定性才是主要问题。

## 方案比较

| 维度 | 直接基于 DeepSeek Harness | Craft Hub 薄控制平面 + adapters |
| --- | --- | --- |
| 与“不重复 Codex”约束 | 弱：引入完整 Harness/UI，并通过自有 App Server client 把 Codex 当子 Agent | 强：Codex 的对话、审批、diff 和运行细节留在 Codex |
| Craft Hub 定位 | 变成 DSH distribution / Agent 客户端 | 保持跨项目发现、信任、调度与跳转入口 |
| Vendor coupling | DSH/Cordis profile、bundle、event、service 和 RPC | 公共契约只保存外部任务句柄；实现可替换 |
| 现有代码重用 | 需要重构或映射现有 runtime/plugin/trust | 保留现有边界，只新增小型 adapter seam |
| 功能上限 | 很高，立即得到完整 Agent Harness 功能 | 有意保持低，只做控制平面需要的能力 |
| 稳定性 | Developer Preview / RC，breaking changes 明示 | 将变动隔离在单个 adapter 内 |
| 未来接入 DSH | 已内建 | 可在需求出现时增加 `DshAdapter` |

## 建议的实现边界

Craft Hub 自己搭建的不是“另一套 Agent Harness”，而是一个很薄的外部任务契约，例如：

```ts
interface AgentDispatcher {
  dispatch: (input: {
    projectId: string
    cwd: string
    prompt: string
  }) => Promise<ExternalAgentRun>

  getStatus: (run: ExternalAgentRun) => Promise<ExternalAgentStatus>
  openNative?: (run: ExternalAgentRun) => Promise<void>
}
```

公共层只规范 `queued | running | needsAttention | succeeded | failed | cancelled` 之类可映射状态，不尝试统一每个产品的完整 turn、tool call、approval 或 event schema。具体 adapter 可以暴露 provider-specific metadata，但不能反向污染公共 runtime。

对于 Codex，优先直接使用官方 SDK 创建/恢复任务，并验证 thread ID 是否能被桌面端识别和打开。对于 DeepSeek Harness，等出现“用户明确希望派发到 DSH”这一真实需求后，再通过它的 SDK 做可选 adapter；现阶段无需把 DSH plugin system 搬进 Craft Hub。

## 何时重新考虑以 DSH 为底座

只有当 Craft Hub 的定位明确改变为“自建 Agent 执行产品”，并且同时需要自己控制模型路由、Agent loop、工具、会话投影、审批、沙箱和 Web UI，才值得重新评估 DSH。届时应先验证：

1. SDK 和 Profile/Bundle contract 是否已进入稳定版本并提供兼容策略。
2. Craft Hub 是否愿意将 Cordis 作为长期公共扩展模型。
3. DSH 的 workspace、trust 与 permission model 能否成为唯一安全边界，而不是与 Craft Hub 双轨运行。
4. 采用整个 DSH distribution 是否比只提供 DSH adapter 带来明确的用户价值。

在这些条件出现前，DeepSeek Harness 更适合作为**优秀的架构参考和未来的外部 Agent target**，而不是 Craft Hub 的基础框架。
