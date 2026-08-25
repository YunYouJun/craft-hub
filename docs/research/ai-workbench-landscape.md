# AI 工作台产品与架构调研

> 调研日期：2026-08-25。采用度数据是动态快照；GitHub stars 只用于判断社区覆盖面，不等同于活跃用户或架构质量。

## 结论先行

Craft Hub 最有价值的定位不是另一个通用聊天、RAG 或模型管理平台，而是 **本地、跨项目、可审计的开发能力控制平面**：发现项目能力，解释它将做什么，在信任和权限边界内执行，并把命令、Agent 与未来工作流统一为可观察的 Run。

最值得组合学习的不是单个竞品，而是五套互补范式：

1. **Backstage**：以项目/组件目录为中心组织所有工具和信息。
2. **VS Code**：以 Workspace Trust 和 Restricted Mode 管理本地代码执行风险。
3. **OpenHands**：把 Agent 的决策与隔离 Runtime 中的动作执行分开。
4. **Dify / n8n**：把编排定义、版本、执行实例、日志和凭据分开。
5. **Open WebUI**：用 Models、Knowledge、Prompts、Skills、Tools 这类积木组合可复用 AI 能力。

## 采用度快照

以下数值取自项目官方 GitHub REST API 或官方站点，时间为 2026-08-25。Stars/forks 是知名度代理指标；官网口径彼此不可直接横向比较。

| 项目 | GitHub stars / forks | 其他官方采用度信号 | 判断 |
| --- | ---: | --- | --- |
| [n8n](https://api.github.com/repos/n8n-io/n8n) | 202,336 / 60,364 | 官方曾披露 200K+ 用户、3,000+ 企业 | 工作流生态最强的样本之一 |
| [Langflow](https://api.github.com/repos/langflow-ai/langflow) | 153,644 / 9,925 | 官方曾披露数万 DAU | AI 可视化编排代表 |
| [Dify](https://api.github.com/repos/langgenius/dify) | 153,431 / 24,242 | 1.4M+ 运行机器、175 个国家 | AI 应用生命周期代表 |
| [Open WebUI](https://api.github.com/repos/open-webui/open-webui) | 149,826 / 21,855 | 官网称 377M+ downloads、480K+ 社区成员 | 自托管 AI 工作区代表 |
| [Cline](https://api.github.com/repos/cline/cline) | 66,804 / 7,205 | VS Marketplace 约 509 万安装 | 编码 Agent 交互代表 |
| [AnythingLLM](https://api.github.com/repos/Mintplex-Labs/anything-llm) | 65,165 / 7,181 | 5M+ Docker pulls | 本地知识工作区代表 |
| [Flowise](https://api.github.com/repos/FlowiseAI/Flowise) | 55,390 / 24,948 | 已宣布 2026-08-31 EOL | 可研究，不应作为长期依赖 |
| [LibreChat](https://api.github.com/repos/danny-avila/LibreChat) | 42,422 / 8,794 | 47.6M Docker pulls | 多模型聊天前端代表 |
| [Continue](https://api.github.com/repos/continuedev/continue) | 35,620 / 5,283 | VS Marketplace 约 399 万安装 | 配置化 Agent 适配代表；2026 年已被 Cursor 收购 |
| [Roo Code](https://api.github.com/repos/RooCodeInc/Roo-Code) | 24,328 / 3,414 | VS Marketplace 约 195 万安装 | 多模式编码 Agent 代表 |

补充来源：[Dify 采用度](https://join.dify.ai/)、[Open WebUI 采用度](https://openwebui.com/)、[AnythingLLM](https://anythingllm.com/)、[n8n 用户披露](https://blog.n8n.io/series-b/)、[Cline 安装量](https://cline.bot/blog/5m-installs-1m-open-source-grant-program)、[Flowise EOL 公告](https://flowiseai.com/sunset)。

## 值得重点分析的架构

### 1. Backstage：Catalog-first 开发者门户

Backstage 不是 AI 工作台，但它与 Craft Hub 的“跨项目工作台”结构最接近，也是最应优先研究的基础样本。

- 核心对象不是页面或插件，而是可搜索、有 owner、metadata 和 relations 的软件实体。
- 仓库内 YAML 是声明来源，Catalog 是汇总和查询层，而不是替代真实系统的终极数据源。
- 工具通过插件挂到实体上下文上，用户从“这个项目”进入命令、文档、部署、监控等能力。
- Core、App、Plugin 分层；插件通过稳定接口和 extension points 组合，而不是互相穿透实现。

对 Craft Hub 的直接启发：

- 将 `ProjectRecord` 逐步深化为 Project Catalog 实体：tags、owner、repository、tech stack、last activity、relations。
- Capability 应总能回答“来自哪个项目、哪个 provider、哪个文件、哪个版本”。
- 全局 Palette 是目录的快捷入口，但目录本身还需要项目主页、最近运行、健康状态与关联资源。
- 插件应围绕 Project/Capability/Run 扩展视图与行为，不应拥有绕过 runtime 的旁路。

来源：[Software Catalog](https://backstage.io/docs/features/software-catalog/)、[架构概览](https://backstage.io/docs/overview/architecture-overview/)、[Catalog Graph 边界](https://backstage.io/docs/features/software-catalog/creating-the-catalog-graph/)。

### 2. VS Code：信任是工作台状态，不是一次弹窗

VS Code 的 Workspace Trust 将未知工作区置于 Restricted Mode，限制 Agent、终端、Tasks、调试、设置和扩展；扩展还可以声明在不可信工作区中是可用、受限还是禁用。

对 Craft Hub 的直接启发：

- 保持“发现只读、执行需信任”的现有方向，这是产品核心，不只是安全实现细节。
- 将 capability 的安全属性显式化：`readOnly`、`requiresTrust`、`riskLevel`、`requiredEnv`、文件/网络/进程权限。
- 未信任项目仍应完整可浏览，并解释哪些能力被限制及原因。
- 插件信任与项目信任应是两条独立轴：可信插件不能自动信任项目，可信项目也不能自动授权新插件。
- 未来 Agent 必须继承同一项目 trust state，不能另建一套安全开关。

来源：[Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust)、[扩展的 Workspace Trust 支持](https://code.visualstudio.com/api/extension-guides/workspace-trust)。

### 3. OpenHands：Agent Controller 与 Runtime 隔离

OpenHands 将 Agent 发出的 action 交给独立 Runtime 执行，再以 observation 返回。Docker Runtime 用客户端/服务端结构隔离任意代码执行，并支持不同 runtime 实现。

对 Craft Hub 的直接启发：

- Agent 适配器只负责规划和产生结构化 action，不能直接调用 shell。
- runtime 仍是命令、文件和工具操作的唯一执行入口，并负责校验 cwd、信任、权限、取消和日志。
- 将 Run 演进为事件流：request → approval → action → output/observation → artifact → result。
- 现在不必强制 Docker，但应尽早定义 `ExecutionBackend` seam，使本机进程、容器、远程 runner 可以共享协议。
- 高风险动作增加逐步审批，而不是只在会话开始时做全量授权。

来源：[OpenHands Runtime Architecture](https://docs.openhands.dev/openhands/usage/architecture/runtime)。

### 4. Dify：定义、运行和发布分离

Dify 的价值不只是画布，而是围绕 AI 应用提供模型适配、Prompt、Knowledge、Tools、Workflow、运行记录和发布等完整生命周期。Workflow 是声明式图，执行实例与定义分开。

对 Craft Hub 的直接启发：

- Workflow definition 必须是 data-only、可校验、可版本化的；不要直接复用旧 Electron runtime 对象。
- 节点输入输出需要 schema，边只连接兼容类型；命令、Skill、Agent、文件转换都可成为节点。
- 保存执行时使用的 definition snapshot，避免编辑工作流后无法解释历史运行。
- 设计态、试运行态和稳定发布态应分开；Workflow Studio 不应默认把草稿暴露成全局 capability。

不宜照搬：模型供应商市场、RAG 数据管线和 SaaS 应用发布都不是 Craft Hub 当前核心。

来源：[Dify 官方仓库与功能概览](https://github.com/langgenius/dify)、[Dify Workflow 文档](https://docs.dify.ai/en/guides/workflow)。

### 5. n8n：成熟的执行语义与凭据边界

n8n 是通用自动化平台。比节点画布更值得学习的是节点契约、trigger/action 区分、执行历史、错误路径、重试、部分执行、凭据引用和人工介入。

对 Craft Hub 的直接启发：

- Workflow Run 是一等实体，记录每个节点的输入摘要、输出、耗时、状态、重试与错误。
- secret 只以 credential reference 进入定义，实际值留在 OS 数据目录或系统密钥链。
- 支持从失败节点重试、取消、超时和输出上限；长任务需要 checkpoint/resume 再考虑后台运行。
- 节点插件需要版本和迁移机制，否则旧工作流会随插件升级失效。

不宜照搬：海量 SaaS connector 市场和多租户自动化运营面板会过早扩大范围。

来源：[n8n Workflows](https://docs.n8n.io/workflows/)、[Executions](https://docs.n8n.io/workflows/executions/)、[Credentials](https://docs.n8n.io/credentials/)。

### 6. Open WebUI：把 AI 能力拆成可组合积木

Open WebUI 的 Workspace 将 AI 定义为五类可组合构件：Models、Knowledge、Prompts、Skills、Tools；各构件可独立维护再绑定成可复用模型。

对 Craft Hub 的直接启发：

- 不要把“Agent”做成一个不可拆的聊天页；把 Model、Instructions/Skill、Context、Tool、Policy、Execution Backend 分开。
- 项目页可展示 Context Pack：当前 Agent 将获得哪些 Skill、文件、工具和环境信息，并允许用户预览。
- 全局能力与项目能力需要明确作用域，避免同名 Skill、Tool 或 Prompt 静默覆盖。

不宜照搬：聊天记录、模型预设和知识库不应成为 runtime 核心，可由 distribution/plugin 提供。

来源：[Open WebUI Workspace](https://docs.openwebui.com/features/workspace/)。

### 7. Continue / Cline / Roo Code：Agent UX 与适配层

这些项目证明了仓库上下文、规则、工具、模型角色、计划/执行模式、diff 审核和 MCP 集成的广泛需求。它们更适合作为 Agent adapter 和交互样本，而不是 Craft Hub 的总体架构模板。

值得学习：

- 配置和规则靠近仓库，用户级 secrets 和偏好留在用户目录。
- 工具调用前显示意图、参数和影响；文件修改以 diff/artifact 呈现。
- Plan 与 Act 分离，允许只读分析后再授予执行能力。
- 统一 session timeline 展示消息、工具调用、命令输出和文件变更。

需要避免：让某个模型厂商、IDE 或 MCP 实现渗入公共 runtime contract。Continue 已被收购也说明适配器边界比绑定单一产品更重要。

来源：[Cline 官方仓库](https://github.com/cline/cline)、[Roo Code 官方仓库](https://github.com/RooCodeInc/Roo-Code)、[Continue 状态](https://continue.dev/)。

## 建议的 Craft Hub 功能架构

```text
Project Catalog
  └─ Project
      ├─ Capability Index
      │   ├─ Command
      │   ├─ Skill
      │   ├─ Agent
      │   └─ Workflow
      ├─ Context Pack
      └─ Trust / Policy

Invocation Service
  ├─ validate + preview + approve
  ├─ Agent Adapter / Workflow Engine
  └─ Execution Backend (local first; sandbox/remote later)

Run Ledger
  ├─ events + logs
  ├─ node/action observations
  ├─ artifacts + diffs
  └─ cancel / retry / replay

Plugin Host
  ├─ capability providers
  ├─ adapters and workflow nodes
  └─ project/run UI extensions
```

核心不变量应是：**任何入口最终都生成结构化 invocation，任何有副作用的 invocation 都经过统一 trust/policy 校验，任何执行都进入统一 Run Ledger。**

## 路线优先级

### P0：alpha 前后，先做深现有主线

1. Capability contract 增加 input/output schema、provenance、risk、required permissions、artifact 类型。
2. Run 从 stdout/stderr 记录升级为 append-only event timeline，支持取消、重试和 artifacts。
3. Project Catalog 增加 tags、recent/favorite、repository metadata 和全局搜索。
4. 插件 manifest 显示来源、版本和声明权限；插件异常继续隔离。
5. 完善 Restricted Mode：未信任项目可浏览，但所有执行入口一致禁用并解释原因。

### P1：真正的 AI 工作台

1. 定义 vendor-neutral `AgentAdapter`，实现一个真实的 “Use with Agent” 端到端切片。
2. Agent Session 使用 action/observation 事件模型，并复用 Run、trust、cancel 和 output streaming。
3. 增加 Context Pack 预览：Skills、选中文件、项目文档、Tools、环境信息。
4. 增加按动作审批、diff/artifact 展示和 secret 引用。
5. 抽象 `ExecutionBackend`，保留未来 container/remote runner 的兼容面。

### P2：Workflow Studio

1. data-only、typed、versioned workflow definition。
2. 命令、Agent、资源处理器使用同一 capability invocation contract 成为节点。
3. definition snapshot、逐节点事件、错误分支、重试、取消与 checkpoint。
4. 草稿、试运行、发布版本分离；发布后才进入全局 Palette。

### 暂缓

- 自建模型网关与模型市场。
- 通用 RAG/向量数据库平台。
- SaaS connector 数量竞赛。
- 企业多租户计费、复杂 RBAC 和云端部署控制台。
- 任意 shell 字符串或自动执行未审查插件。

这些能力在 Dify、Open WebUI、n8n 等项目中已经很成熟，但会模糊 Craft Hub “本地项目能力控制平面”的差异化，并扩大当前安全边界。

## 最值得直接阅读的顺序

1. [Backstage Software Catalog](https://backstage.io/docs/features/software-catalog/)：决定 Project Catalog 的长期模型。
2. [VS Code Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust)：校准信任与受限模式。
3. [OpenHands Runtime Architecture](https://docs.openhands.dev/openhands/usage/architecture/runtime)：设计 Agent 与执行层 seam。
4. [n8n Executions](https://docs.n8n.io/workflows/executions/)：设计 Run Ledger 与失败恢复。
5. [Open WebUI Workspace](https://docs.openwebui.com/features/workspace/)：设计 AI 构件与 Context Pack。
6. [Dify Workflow](https://docs.dify.ai/en/guides/workflow)：设计 Workflow Studio 的声明模型。

