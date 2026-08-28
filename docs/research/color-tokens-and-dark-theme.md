# Craft Hub 色彩 Token 与暗色主题设计调研

> 调研日期：2026-08-27。本文只定义设计方向和采用边界，不修改当前 UI 实现。

## 结论先行

Craft Hub 已经有一组集中在 [`apps/web/src/styles.css`](../../apps/web/src/styles.css) 的浅色 / 暗色 CSS 变量，但仍缺少一份可审阅的全局色彩 Token 面板，也没有把“背景色”和“其上的前景色”完整配对。因此，暗色模式不应只逐个替换 hex，而应补齐一套分层、可验证的主题契约。

建议采用以下组合：

1. 以 [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/format/) 作为 Token 的文档与未来交换格式。
2. 保留 Craft Hub 自有的语义 Token 名称和视觉风格。
3. 优先评估 [Radix Colors](https://www.radix-ui.com/colors/) 的浅色 / 暗色色阶作为底层原始色板，不直接让组件依赖 `blue-9`、`amber-11` 等色阶名。
4. 以 [WCAG 2.2](https://www.w3.org/TR/WCAG22/) 作为发布验收标准；APCA 目前仅作为辅助观察指标。
5. 先维护 CSS 变量这一份运行时实现；只有出现 Figma 同步、多端输出或自动生成文档的真实需求时，再引入 DTCG JSON 和生成工具。

## 当前状态与已发现的问题

现有变量已经覆盖 `surface`、`text`、`border`、`accent`、`warning`、`success`、`danger`、terminal、tooltip、overlay 和 shadow，并通过 `:root[data-theme='dark']` 切换主题。这是合适的运行时基础。

问题主要在契约不完整：

- `--on-accent` 只有一个固定的白色值，但暗色主题的 `--accent: #6ea8fe` 与白字对比度约为 **2.42:1**。
- `.trust-button` 使用 `--warning: #f1ba63` 背景，却继承 `--on-accent: #fff`；该组合约为 **1.76:1**。即使按大号文字的 3:1 门槛也不合格。
- `#1f232b` 与上述暗色主题 `--accent`、`--warning` 的对比度分别约为 **6.52:1** 和 **8.96:1**，说明这两类亮色实心按钮应使用暗色前景，而不是固定白字。
- 一部分 component / terminal / project visual 色值仍散落在各自文件中，无法在一个面板里同时检查浅色、暗色、状态和对比度。

因此应补充 `--on-warning`，并让 `--on-accent` 在暗色主题中重新映射；同样的成对规则也应覆盖 danger、success 及未来的 info 实心控件。

## 建议的三层 Token 模型

### 1. 原始色板（primitive）

原始色板描述色彩本身，不描述用途，例如 neutral、blue、amber、red、green 的有序色阶。它只允许被语义层引用，业务组件不直接使用。

若采用 Radix Colors，其每个色阶的 12 个步骤已有明确用途：1–2 为页面和弱背景，3–5 为控件默认 / hover / active 背景，6–8 为边框和 focus，9–10 为实心背景及 hover，11–12 为低、高对比文字。详见 [Radix 色阶用途](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)。

### 2. 全局语义 Token（semantic）

语义名称不携带明暗、具体色相或 hex；浅色和暗色主题分别把同一个名称映射到不同 primitive。以下表格可作为全局色彩变量面板的第一版：

| 分组 | 建议 Token | 用途与约束 |
| --- | --- | --- |
| Surface | `--surface`、`--surface-subtle`、`--surface-muted`、`--surface-hover`、`--rail` | 页面、面板、弱区块、交互背景和侧栏层级 |
| Content | `--text`、`--text-secondary`、`--muted` | 主文本、辅助文本、弱化文本；每项都需要对实际相邻 surface 验证 |
| Border | `--border`、`--border-strong`、`--focus-ring` | 分隔、交互边界、键盘焦点；focus 不应复用品牌色后便默认合格 |
| Accent | `--accent`、`--accent-hover`、`--accent-soft`、`--on-accent` | 主操作；实心背景与前景必须成对切换 |
| Warning | `--warning`、`--warning-hover`、`--warning-soft`、`--on-warning` | 未信任、警告和授权；不要借用 `--on-accent` |
| Danger | `--danger`、`--danger-hover`、`--danger-soft`、`--on-danger` | 删除、失败和高风险动作 |
| Success | `--success`、`--success-soft`、`--on-success` | 成功状态；只有出现实心成功控件时才需要 `on` 配对 |
| Overlay | `--overlay`、`--palette-overlay`、`--shadow` | 遮罩和投影；需在实际叠加结果上测试，不能只测原始 rgba |
| Inverse | `--inverse-surface`、`--inverse-text` | tooltip 等反相区域；可逐步替代当前 tooltip 专用值 |
| Terminal | `--terminal-bg`、`--terminal-fg` 及 ANSI 语义色 | 终端是独立高密度阅读场景，应单独做明暗主题与 ANSI 色检查 |

命名的重点不是增加变量数量，而是明确“谁可以搭配谁”。例如实心警告按钮只使用 `warning + on-warning`，弱警告提示使用 `warning-soft + warning` 或专门的 warning text token；组件不再自行猜测前景色。

### 3. 组件 Token（component）

只在一个组件无法由全局语义组合表达时增加，例如 `--command-palette-shadow` 或 `--terminal-selection-bg`。组件 Token 应引用语义 Token 或 primitive，不应复制 hex。这样既能保留 Craft Hub 的产品个性，也避免把 Material、Radix 或 shadcn 的组件命名照搬进来。

这一分层与 DTCG [Color Module](https://www.designtokens.org/tr/2025.10/color/) 对 base、alias、component token 的说明一致；DTCG 的 [Format Module](https://www.designtokens.org/tr/2025.10/format/) 定义 `$type`、`$value` 和引用，[Resolver Module](https://www.designtokens.org/tr/2025.10/resolver/) 则为 light、dark、high-contrast 等上下文解析提供模型。2025.10 是稳定的 Final Community Group Report，明确面向实现，但它也明确说明自己**不是 W3C Recommendation，也不在 W3C Standards Track**。

## 暗色模式设计与验收规则

1. **按角色重映射，不做机械反色。** 同一个语义 Token 在两个主题中保持用途一致，但数值可以完全不同。
2. **前景 / 背景成对设计。** `accent/on-accent`、`warning/on-warning`、`danger/on-danger` 必须作为一个测试单元。
3. **交互状态要完整。** default、hover、active、selected、disabled、focus 都应在变量面板中占有明确位置。
4. **文本采用 WCAG 2.2 门槛。** 普通文字至少 4.5:1，大号文字至少 3:1，且阈值不能四舍五入。来源：[WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)。
5. **控件和焦点采用 3:1 门槛。** 有意义的边界、图标、状态和 focus indicator 与相邻颜色至少 3:1。来源：[WCAG 2.2 SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。
6. **不要只靠颜色表达状态。** trusted / untrusted、成功 / 失败仍需图标、文本或形状差异。
7. **Radix 的可访问性说明不能代替项目验收。** Radix 当前对文字步骤的部分保证使用 APCA 指标；而 W3C 明确说明 WCAG 3 仍是不完整、可能大幅变化的草案，当前草案甚至尚未确定最终对比度算法。参见 [WCAG 3 状态说明](https://www.w3.org/WAI/standards-guidelines/wcag/wcag3-intro/) 和 [WCAG 3 Working Draft](https://www.w3.org/TR/wcag-3.0/)。

建议未来把色彩组合测试放进 CI，并用实际渲染的相邻背景检查，而不是只维护一份“理论通过”的色值表。半透明色、overlay、disabled 和 project accent 都需要在合成后测试。

## 社区方案比较

| 方案 | 适合直接采用的部分 | 不建议直接采用的部分 | 许可与维护成本 | Craft Hub 判断 |
| --- | --- | --- | --- | --- |
| [DTCG 2025.10](https://www.designtokens.org/technical-reports/) | 文件格式、类型、别名、主题解析和跨工具术语 | 它不替项目决定 Token 命名和视觉数值 | 规范可自由实现；无运行时依赖，但需关注后续版本 | **采用为文档 / 交换标准** |
| [Radix Colors](https://www.radix-ui.com/colors/docs/overview/usage) | UI 导向的 12 阶浅色、暗色、alpha 与 P3 色板；CSS 变量可按需导入 | 不让组件直接绑定色阶名；不要在原色阶上随意改值 | [MIT](https://github.com/radix-ui/colors/blob/main/LICENSE)；应锁定版本并在升级时跑视觉回归和对比度测试 | **首选 primitive 候选** |
| [Open Props](https://open-props.style/) | spacing、type、easing 等通用 primitive；支持按包增量引入，也提供 DTCG 2025.10 JSON | 500+ 变量整体引入会扩大命名面；色阶的 UI 角色契约不如 Radix 清晰 | [MIT](https://github.com/argyleink/open-props/blob/main/LICENSE)；选择性引入成本低，整体接管成本高 | **按需参考，不整包接管色彩** |
| [Material 3 / Material Color Utilities](https://github.com/material-foundation/material-color-utilities) | `primary/onPrimary`、container、surface、outline 等成对角色；从 seed 生成 light/dark 主题 | 动态配色和 Material 视觉语义对固定桌面工作台偏重 | [Apache-2.0](https://github.com/material-foundation/material-color-utilities/blob/main/LICENSE)；生成算法与升级面大于静态色板 | **参考角色模型；暂不引入** |
| [Tailwind theme variables](https://tailwindcss.com/docs/theme) | CSS 变量作为主题 API 的思路 | 为 Token 引入 Tailwind 会改变现有 Vue + UnoCSS 技术选择 | 新框架依赖、构建和迁移成本不值得 | **仅参考** |
| [shadcn theming](https://ui.shadcn.com/docs/theming) | `background/foreground`、`primary/primary-foreground` 的语义配对 | 组件与主题方案主要面向 React + Tailwind；不适合作为跨工具源数据 | 拷贝式组件需要项目自行长期维护 | **仅参考命名，不采用实现** |

### 为什么首选 Radix，而不是直接套 Material 或 shadcn

Craft Hub 是一个信息密度较高、需要明确 hover / selected / border / focus 状态的桌面工作台。Radix 的色阶步骤直接对应这些 UI 用途，又不要求引入它的 React 组件。Material 3 更适合需要动态品牌主题或完整 Material 组件语义的产品；shadcn 的优点是组件源码可控，但为了色彩体系引入 React / Tailwind 约定会造成不必要耦合。

Radix 官方还特别说明：Yellow、Amber、Lime、Mint、Sky 的实心背景应配暗色前景，这与当前暗色授权按钮的问题完全一致。来源：[Radix 色阶用途](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)。

## 建议落地顺序

### P0：先修正契约

1. 在当前 CSS 变量中补齐 `on-warning`、暗色 `on-accent`、hover 和 focus ring。
2. 生成一张浅色 / 暗色并排的文档色板，显示 Token 名、色值、用途和关键对比度。
3. 清点 hard-coded 颜色，并分类为 global、component、data visualization 或 terminal。
4. 为所有实心按钮、文本、边框、focus 和状态图标建立自动对比度检查。

### P1：评估 Radix primitive

用一条窄切片验证 slate + blue + amber + red + green 的 light/dark scales，只替换底层 primitive 映射，不改组件语义 API。若采用 npm 包应锁定版本；若复制少量色值，应保留 MIT 许可声明。验证截图、色差和对比度后再扩大范围。

### P2：有跨工具需求时再建立 Token 源文件

当需要 Figma、Web、Electron 或未来原生客户端共享同一来源时，再新增 DTCG 2025.10 `.tokens.json`，由构建产物生成 CSS。可评估 [Style Dictionary](https://styledictionary.com/info/dtcg/)；它采用 [Apache-2.0](https://github.com/style-dictionary/style-dictionary/blob/main/LICENSE)，支持 DTCG 输入和多平台输出，但其官方文档也提示对 2025.10 的完整支持仍在推进中，因此当前不必为了单一 Web 消费端增加生成链。

## 最终决策建议

现在就采用的是：**三层 Token 模型、成对的 `on-*` 语义、WCAG 2.2 验收规则，以及文档中的全局变量面板**。

下一步做小范围技术验证的是：**Radix Colors 作为 primitive 色板**。

暂时只参考、不引入的是：**Material 3、Open Props 全量色板、Tailwind 和 shadcn 主题实现、Style Dictionary 生成链**。
