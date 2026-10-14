# AI 可执行任务视图与 Craft Hub 接入计划

日期：2026-10-13。状态：设计方案；外部看板配置与接入实现待执行。

个人工程与开源任务复用对应仓库的 GitHub Issues 与现有 Projects；团队研发、团队零散事项和个人生活事项分别保留在已有来源。Craft Hub 提供跨来源筛选、本机项目关联和 Agent 交接入口。任务内容与完成状态由来源维护，一项任务可以关联多次执行。额度自动调度放在后续阶段。

本方案承接[日常工作台计划](./daily-workbench.md)，优先验证“选任务 → 确认项目 → 预览上下文 → 打开现有 Agent → 人工验收”的流程。

## 任务来源与工作域

| 任务类型 | 建议保留的权威来源 | 工作域 |
| --- | --- | --- |
| 个人工程、开源项目 | 对应仓库的 GitHub Issues 与现有 Projects | 个人 |
| 团队研发任务 | 团队已有研发管理系统的需求、任务、缺陷 | 工作 |
| 团队零散事项 | 团队已有轻协作事项来源 | 工作 |
| 个人生活事项 | 原有个人待办 | 个人 |

按这四类分工复用已有任务池，不另建一套 Craft Hub 待办库。尚未确认用途的连接或来源容器进入待分类。团队使用的具体产品、连接与资源配置由下游扩展说明；公共计划只定义通用分类与接入边界。

每项任务只有一个权威来源。与代码相关的个人任务进入对应仓库 Issue；Projects 组织这些 Issue。工作任务使用团队已有项目与流程，不把详细内容复制到个人看板。同一事项在多个看板出现时，仍指向同一个原生事项。

同一项研发工作可以关联多个原生事项，但需明确一个主事项决定标题与需求状态；其他事项仅作为关联来源，各自状态分别读取。它们可以共享执行、分支与审查产物，不能据此隐式同步两边状态。验收后的来源回写按具体事项分别执行。

工作域由本机连接和来源容器配置决定：账号设置默认值，组织、仓库或列表可以覆盖。具体容器规则沿用完整的 `WorkItemContainerRef`，即 `providerId + instanceId + accountId + containerId + kind`；缺少明确映射时显示未分类。一个账号可以访问多个工作域，不能只凭服务名称、账号名称或标题判断。

归类优先级为精确来源容器规则 → 组织规则 → 账号默认。同级规则冲突时进入待分类，由用户确认；切换 Project 视图不悄悄改变同一原生事项的工作域。Project 只用于选取事项与字段上下文，GitHub Issue 的工作域跟随确认过的仓库归类。

`personalMembership` 只表示当前账号与事项的拥有或指派关系，不表示个人工作域。工作域也不等同于公开性：个人项目可以私有，工作项目也可以公开。

界面默认分成工作与个人两个入口，另提供用户主动选择的全部视图。卡片保留来源、账号、组织或列表标识。交接前展示目标项目和所选 Agent 连接；仅显示在同一看板不代表共享账号、权限或执行环境。切换工作域后应清除不适用的任务选择和交接草稿。

这些分类规则、项目绝对路径、凭据引用与交接记录属于 OS 用户数据。公共仓库只保存通用契约和中性示例；特定组织的来源适配、账号配置与资源地址由下游扩展维护。

## GitHub Projects 字段

复用现有总看板，新增视图。已有同义字段直接映射，不重复创建；所有视图共享同一个 Project 的字段与事项值。

| 字段 | 类型 | 值与用途 | 首期要求 |
| --- | --- | --- | --- |
| Status | 现有单选 | 沿用项目工作流；参考 Backlog、Todo、In progress、In review、Done | 复用 |
| ai-readiness | 单选 | Needs context、Ready、Blocked、Manual | 新增或映射 |
| Priority | 单选 | P1 优先、P2 常规、P3 有余力再做；沿用已有体系也可以 | 复用或补充 |
| Size | 单选 | S 单一明确改动、M 多步但范围明确、L 需要拆分 | 复用或补充 |
| Repository | 原生字段 | 原生 Issue 所属仓库 | 保留 |
| Assignees | 原生字段 | 负责人；验收人不同时写入任务正文 | 保留 |

目标、验收条件、执行边界和依赖写在 Issue 正文，使用[任务模板](../templates/ai-executable-task.md)。本机路径、Agent 会话、执行次数和实际用量由 Craft Hub 或外部工具记录。Size 是人工估算，不能换算成 token 预算。

GitHub 支持带颜色与描述的[单选字段](https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-single-select-fields)。任务模板中的正文不会自动设置 Project 自定义字段；加入 Project 后仍需设置字段，自动赋值另行配置。

### AI 准备度

| 值 | 含义 | 转为 Ready 的条件 |
| --- | --- | --- |
| Needs context | 目标、资料、验收方式或执行边界不完整 | 补足缺失内容 |
| Ready | 已具备交接条件 | 保持条件有效 |
| Blocked | 条件清楚，但依赖或环境暂不可用 | 阻塞已解除 |
| Manual | 需要人工判断或操作，暂不交给 Agent | 人工重新确定可委托部分 |

默认使用 Needs context。Ready 至少要求目标明确、验收可验证、仓库或项目范围已知、允许动作写清、必要依赖可用、负责人明确。Ready 表示内容准备充分；启动时仍要检查来源当前状态、本机项目与权限。

新任务从待准备视图收集。GitHub 会把筛选元数据应用到视图中新建的事项，因此从 Ready 筛选视图新增事项可能直接继承 Ready；该值不能替代实际准备度检查。AI 可执行视图用于挑选已检查任务，交接前仍审阅模板内容。

业务状态继续沿用来源的生命周期。参考流程为 Backlog → Todo → In progress → In review → Done。若现有 Project 只有三段状态，先保留原值，待验收可由关联 PR 或 Craft Hub 的交接阶段表达；不为一个视图修改全部团队的共享工作流。

一次执行的 running、completed、failed、cancelled 由执行器记录。completed 表示该次执行结束；产物尚未验收时，原任务仍未完成。失败或取消也不自动改变任务的最终业务状态。

### 视图配置

以下示例假定字段与选项名称采用上表；实际设置使用对应字段菜单确认，并保存视图。

| 视图 | 布局与用途 | 示例筛选 |
| --- | --- | --- |
| AI 可执行 | 表格；只列出可以开始的任务，按 Priority 再 Size 排序 | `ai-readiness:Ready status:Todo is:issue is:open` |
| AI 工作流 | 看板；按现有 Status 分列，卡片显示 Priority、Size、Repository、Assignees | `ai-readiness:Ready -status:Done is:issue is:open` |
| 待准备 | 表格；补上下文后再移入可执行视图 | `ai-readiness:"Needs context" -status:Done is:issue is:open` |
| 阻塞 | 表格；写清解除条件 | `ai-readiness:Blocked -status:Done is:issue is:open` |

如只处理本人负责的任务，可追加 `assignee:@me`，并保证相应 Issue 已指派。未指派的可执行事项单独人工挑选。草稿可以用于收集想法；首期正式执行前转为所属仓库的 Issue，以获得明确来源、仓库和验收记录。

列过滤与排序遵循 GitHub 的[筛选规则](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/filtering-projects)和[看板配置](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout)。列数量限制仅作提示，不能用作执行并发控制。

## 其他来源的映射

工作来源保持自己的需求、任务、缺陷及轻量事项模型。能添加自定义字段时使用相同准备度与工作量定义；不能添加时，可在原有正文中采用固定模板，并由用户在本机显式确认交接条件。

原生状态只有未完成和已完成的来源，不应被映射成已经支持完整五段工作流。准备度用独立字段表达；执行阶段保存在交接记录中。只读接入不更新来源状态，完成回写留给人工验收后的明确动作。

来源适配器保留原生状态，同时提供已有契约支持的规范化表示。未知字段、缺失字段或不能读取的资源显示诊断，不伪造 Ready 或来源成功。账号与资源范围由连接配置选择，不用标题关键词推断。

## Craft Hub 接入阶段

### 第一阶段 配置现有任务池

1. 在现有 Projects 添加或映射字段，保存上面的视图。
2. 选择三项个人任务试用：S、M、Blocked 各一项；使用统一任务模板补齐内容。
3. 在工作来源中配置等价视图或筛选，不复制事项到个人 Project。
4. 人工执行一次准备、交接、结果返回和验收，记录哪些信息仍需补充。

验收：任意一项 Ready 任务无需重新解释目标即可交接；缺少资料与阻塞事项不会混入待启动列表；工作与个人事项来源明确。

本方案不创建外部看板或修改共享字段。真正配置前确定目标 Project 与现有字段，避免把设计中的名称直接写入错误项目。

### 第二阶段 只读来源与现有工具交接

GitHub 来源通过受信任 Host Plugin 提供认证、Project 选择、字段配置读取、事项分页和官方 API。Marketplace Plugin 声明连接界面、资源范围和工作项视图；通用 runtime 保持来源与 Agent 中立。

GitHub 的[Projects GraphQL API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)可查询事项与字段。首期申请读权限，并同时满足关联私有仓库的读取权限；不假设仅有 Project 权限就能取得所有 Issue 正文。不可读事项显示缺失状态，不尝试绕过访问限制。

读取 Project 字段与选项 ID 后建立显式映射，不依赖本地显示名称硬编码。插件自行复现已配置的筛选条件；不承诺完整执行任意网页视图的过滤表达式。

沿用现有 sourceRef 保存精确来源身份。GitHub Issue 使用所属仓库的节点 ID 作为 containerId、`issue` 作为 kind、Issue 节点 ID 作为 itemId；Project ID、Project item ID、字段值和筛选上下文单独保存到来源扩展数据。一个 Issue 在多个 Projects 出现时，以原生事项识别重复，保留所选 Project 上下文；不因不同看板重复派发。不同看板的准备度或状态不一致时显示所选上下文与差异，不合并为一个虚构状态。

主应用复用项目关联与共享交接界面：

1. 用户选择工作域、来源与 AI 可执行视图。
2. 选择事项，确认或复用本机项目关联。
3. 重读原生 Issue 与所选 Project item 的字段，确认未关闭、未归档、该上下文的准备度仍有效；其他 Projects 的 Ready 值不替代所选上下文。
4. 预览来源、目标、验收条件、允许动作、项目和目标工具。
5. 复制上下文并打开现有 Agent 工具，显示实际交接结果。

复用现有 Agent 连接是默认方向。仅打开应用时继续报告 `contextTransferred: false`；接收方确认收到上下文之后，才显示已接收。选择项目和打开工具不授予项目 trust。

验收重点：分页完整性、账号切换与工作域切换、字段缺失、私有事项不可读、同一 Issue 多看板、失效项目路径、来源失败保留可辨识的旧数据，以及打开成功与接收成功的区别。新增 runtime 行为须按仓库要求补 discovery 与 trust/execution 测试。

### 第三阶段 保存交接与人工验收

先增加独立交接记录，保存 sourceRef、所选 Project 上下文、工作域配置引用、确认的本机项目、工具、交接时间和实际结果。只有真实接收并启动后才关联执行 ID、外部聊天或 PR。纯复制、启动失败与一次实际执行是不同事件。

一个原生事项关联多个交接与多次执行。来源事项 ID、Project item ID、交接 ID 和执行 ID 分别保存。当前 AgentTaskRecord 尚无 sourceRef；实施时通过可选来源引用或独立关系记录兼容已有任务，不重定义现有 running/completed/failed/cancelled 的含义。

首期结果由用户关联聊天、PR 或报告。执行器返回完成只进入待验收；来源标记 Done、关闭 Issue 或更新其他来源完成状态通过独立人工动作完成。后续正式回写时重读来源状态，展示拟修改的原生字段，并处理失败与重试。

验收：可以从原事项找到全部尝试，从一次执行回到准确原事项；失败和完成不会误关闭事项；切换来源账号后不会把结果写给同名的其他事项。

## Vibe Kanban 的复用范围

Vibe Kanban 的本地 workspace 包含独立代码环境、Agent 会话、diff 审查与预览，适合比较并行编码与审查体验。[官方仓库](https://github.com/BloopAI/vibe-kanban)

官方于 2026-04-10 宣布关闭背后的公司，远程任务、评论、项目与组织服务在过渡期后移除，本地 workspaces 继续保留；旧文档中的云端规划能力不能当作仍可用的托管服务。[关闭公告](https://www.vibekanban.com/blog/shutdown)

第一阶段只参考任务 → 工作区 → 会话 → 审查的模型，以及一项任务多次尝试的界面。GitHub Projects 与其他来源仍负责任务。实际编码和完整工作区继续使用现有工具。

如果试用证明本地 Vibe Kanban 能改善并行执行与审查，再加入可选 executor 插件，通过其[本地 MCP](https://www.vibekanban.com/docs/integrations/vibe-kanban-mcp-server)创建 workspace 或继续其会话。它启动自己的 CLI Agent 会话，不能因此宣称已连接用户现有桌面聊天；接口、结果摘要和恢复能力需对固定版本实际联调。

本轮不移植整套 Rust 服务端与 React UI。若后续复用源码，单独审查其 [Apache 2.0 许可证](https://github.com/BloopAI/vibe-kanban/blob/main/LICENSE)与分发要求，保留上游归属和适用声明，不把上游代码改标为本项目自有代码。

## 后续事项

- 实际用量接入：按执行器采集可获取的用量，明确缺失与统计范围，不能通过 Size 推算。
- 额度自动调度：读取当前额度、预留容量、任务占用、防重复、暂停和重试。
- 更完整的来源状态回写与任务变更通知。
- 可选本地执行器，依据实际交接与审查收益选择。

本轮只交付任务视图、模板与接入计划。额度触发、自动挑选、后台循环与无人值守派发没有进入当前实现范围。
