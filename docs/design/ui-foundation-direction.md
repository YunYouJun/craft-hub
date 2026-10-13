# 工作台 UI 统一与共享设计基础

更新：2026-10-09。已接入 YunLeFun 的 CSS 设计基础，采用 **Workspace / Admin（ToB）** 的中性色、系统字体和控件密度；保留 Craft Hub 的工作台布局、源码组件与 Reka UI 交互。

## 为什么选择 Workspace / Admin

[YunLeFun/design](https://github.com/YunLeFun/design) 将使用场景分为 Consumer 与 Workspace，Workspace 下进一步区分 Admin / Editor。个人使用并不意味着必须选 Consumer：Craft Hub 的主要任务是查看软件与环境状态、配置工具、审阅安装和迁移计划，适合 Admin 的查询和操作密度。Consumer 更偏内容、品牌与轻操作；Editor 更适合画布、时间线和属性面板。

默认正文 14px、辅助文字 12px、页面标题 22px；共享控件桌面默认 32px、紧凑 28px，窄屏或粗指针增至 44px / 40px。控件圆角 6px、面板 10px。保留现有留白、卡片和局部玻璃效果，避免让工作台变成密集数据表。标题栏和侧栏部分历史控件仍有独立尺寸，并非所有导航点击区域都已统一。

## 实际接入方式

- 使用 pnpm catalog 固定 `@yunlefun/ui@0.0.6`，导入其已发布的 `@yunlefun/ui/css`。
- 官方 main `45ad5ba3788de14144a282d0aea0a975fb6c121c` 已提供 Admin / Editor CSS，但 CSS `0.0.6` 发布包尚未包含这两个入口。暂存该提交的原始 `admin.css`，随后导入本地语义 token；来源见 [vendor 记录](../../apps/web/src/styles/vendor/yunlefun/README.md)。
- MIT 许可保存在 Web 的 public/licenses 中，随 Vite 产物和桌面 Web 资源分发。上游 Admin 入口正式发布后，验证一致性并切换包入口。
- `styles/tokens.css` 将表面、文本、品牌、焦点、状态、字体和间距映射到上游变量；保留工作台页面几何和特定业务状态。根元素的 `.ylf-theme-light` / `.ylf-theme-dark` 与原有 `data-theme` 由同一主题偏好驱动，body 下的 Portal 继承同一套主题。
- 状态文字、实色填充和填充前景分别映射，避免把状态文字色直接用作按钮底色。共享按钮、输入和选择控件消费密度变量，工作台规则不覆盖 Button 的 size 接口。

此次采用 CSS-only，不引入上游 Vue 包、Sass、JS 运行时或远程字体。基础交互继续使用现有的 Button、Badge、Alert、DialogShell 和表单组件；长内容弹层保留固定头尾和滚动内容。

## 软件与环境图标

使用已安装的 UnoCSS / Iconify 管线，并固定本地开发依赖 `@iconify-json/logos@1.2.15`、`@iconify-json/simple-icons@1.2.99`。两套 collection 的声明许可均为 CC0-1.0；应用保留可见软件名称，图标作为装饰。

| 场景 | 图标来源 |
| --- | --- |
| Git、Node.js、pnpm、Homebrew | Logos 彩色品牌标识 |
| Claude、Gemini | Logos 彩色品牌标识 |
| ChatGPT、Perplexity、Raycast | Simple Icons，单色跟随当前文字颜色 |
| fnm、Workstation、Orca | 当前集合无已核实的对应标识，保留终端或工作区语义图标 |
| 自定义网站 | 按实际 HTTPS 主机名精确匹配；未知地址使用网页图标 |

只 safelist 并编译实际使用的图标为 CSS / SVG data URI，浏览器无需访问 Iconify CDN，也不加载完整 collection。彩色标识用 contain 保留比例；不通过用户可编辑的标题或 ID 推断品牌。现有插件声明的自定义图标仍优先保留。

来源：[Iconify Logos](https://icon-sets.iconify.design/logos/)、[Simple Icons](https://simpleicons.org/)。

## 已完成与后续验收

- [x] 固定实际发布的基础 CSS，暂存官方 Admin profile，并映射本地语义 token。
- [x] 同步系统与手动主题选择器，分离状态文字与实色前景。
- [x] 补齐上述品牌图标，验证 UnoCSS 的真实输出和未知品牌回退。
- [x] 构建后验证工具总览、环境检测与真实工具配置长列表：系统主题、Portal 继承、键盘焦点、固定头尾、默认/紧凑控件尺寸、320 / 390 / 768 / 1440px 无页面横向溢出；Chromium 完整流程和 WebKit 明暗主题弹层冒烟通过。运行时无相关控制台错误或远程图标/字体请求。
- [x] 构建并安装 macOS arm64 Electron 到 `/Applications/Craft Hub.app`；安装与 release 的 ASAR 一致，333 个 Web / Desktop 资源与当前 dist 的 SHA256 一致，实际进程和本地 API 均来自安装版。原生窗口侧栏顺序、品牌图标和本机环境检测通过，六项工具均可用。
- [ ] 补充 Electron 原生明暗主题与键盘交互的完整验收，以及 Tauri 的原生消费端验证；当前原生启动与环境页检查不代替全部宿主验收。
- [ ] 上游 Admin CSS 发布后替换暂存入口并复核主题、密度与包体积。
- [ ] 逐个评估基础控件内部实现替换，继续保留本地调用接口；不单独发布一套新的通用 UI 包。

本轮验证：`pnpm lint`、根目录及 Web `typecheck`、全量 `pnpm test --run`（926 通过、2 个平台相关跳过）和 `pnpm build` 通过。浏览器插件未提供，使用已有 Playwright 执行验收。抽查正文/辅助文字、品牌按钮及 warning/danger/success 的文字、实底与 hover 配对，明暗主题最低对比度 4.82:1；这不代表所有历史控件已完成无障碍审计。

生产 CSS 中九个品牌规则合并为 30.44 KiB，独立 gzip 10.46 KiB；发布基础 CSS 为 11.79 KiB，独立 gzip 2.35 KiB。独立压缩数值不等于整个安装包的增量，完整图标集合未进入 Web 运行时。

证据：[场景入口](https://github.com/YunLeFun/design/blob/45ad5ba3788de14144a282d0aea0a975fb6c121c/packages/guide/admin.md)、[接入与成熟度](https://github.com/YunLeFun/design/blob/45ad5ba3788de14144a282d0aea0a975fb6c121c/packages/guide/adoption.md)、[现有组件约定](../../apps/web/src/components/ui/README.md)。

## 日常工作流的界面约定

2026-10-12：待办聚合、项目目录与交接弹层沿用同一套 Workspace / Admin 基础。参考 Apple 的列表、工具栏和布局层级，字体及控件尺寸仍以现有 YLF profile 为准；这不是原生 SwiftUI 控件替换。

- 每个工作来源使用一个中性表面，来源标题与账号名称在组头，事项按连续列表排列。相邻行用完整分隔线，避免每条事项重复边框和阴影。列表最小行高桌面 56px、手机 64px，左右留白使用共享间距。
- 事项标题 14px、状态和截止时间 12px、线性语义图标 16px。显示本地化的可读时间，原始时间放在 `time[datetime]` 与提示里；不把账号 ID 或显示 ID 当作主要信息。保留加载范围、上次更新时间和失败后的过期提示。
- 项目目录同样使用连续列表，项目名称在首行、路径在辅助行。点击主体进入项目，尾部只保留交接图标动作，避免两个等权文字按钮竞争。
- 交接弹层按事项摘要 → 项目与关联范围 → 目标 → 复制上下文排列。项目和范围在桌面并排、手机堆叠。未选择使用 placeholder，显式“无需项目”独立表达。关联保存和清除在紧凑操作行，完整交接文本默认折叠，复制失败时展开供手动选择。
- 表单和按钮使用共享 Field、FormSelect、Textarea 与 Button；工具入口仍是可用的真实链接。固定头尾、内容滚动，头尾使用中性表面与内容形成层级。颜色、字体、焦点、圆角和暗色主题均消费已有 token，不增加另一套局部主题。

实现落在共享 `daily-workbench.css` 和上述三个通用组件中，个人总览与插件工作台保持一致。验收需覆盖明暗主题、1440px 桌面及 390px 手机，包含真实选择、复制、分页、关联保存与重载恢复，并检查键盘焦点、Portal 主题和横向溢出。

本轮验收：隔离演示来源下，Chromium 完整流程和 WebKit 手机暗色弹层通过；1440×1000、390×844、320×720 无页面横向溢出。手机列表主体、选择器与上下文展开入口至少 44px，长上下文由正文区域独立滚动，头尾按钮保持可见。Portal 跟随明暗主题，键盘焦点为 2px；侧栏 `aria-selected`、active 样式和正文一致，截图在颜色过渡结束后采集。截图复查覆盖字阶、连续行、组头留白、固定头尾、共享选择器、暗色表面及移动点击区域。没有新增远程字体或运行时 UI 依赖。

公开边界、lint、根目录 TypeScript、Web Vue 类型检查与完整构建通过；177 个测试文件通过，1103 项通过、2 项跳过。浏览器插件未提供，使用工作区已有 Playwright；本轮不计作原生 Electron 安装版或 iOS 真机验收。

按钮校准：页面与 Portal 直接使用共享 Button 的 500 字重、无外扩阴影和 16px 默认 / 14px 紧凑图标，不再由工作台容器单独覆盖。弹层默认文字动作至少 72px 宽，较长标签按内容扩展；同组动作共用高度、字号、内边距和垂直对齐。清理弹层里独立的 40px 高度规则，密度统一交给 profile。Chromium 桌面测得两个动作均为 32px 高，手机和 WebKit 均为 44px，复制与关闭验证通过。

交接弹层的成对动作进一步统一比例：两个文字按钮在桌面等宽，最小各 112px；手机填满底部并等分。移除复制按钮的图标，以颜色表达主要动作；成功后文案切换为再次复制，按钮不改变宽度。此布局由共享 `dialog-action-pair` 提供，按钮本身继续使用 profile 的 32px / 44px 高度，不强制其他复杂弹层的操作区采用两列。

成对布局验收覆盖 Chromium 1440 / 390 / 320px 和 WebKit 390px 暗色：两个动作的实际宽高与顶部位置一致，中文和英文复制成功前后尺寸稳定，按钮文字放大至 200% 时仍等宽同高且不裁字；焦点、复制完整身份上下文、关闭和 Escape 行为通过。截图按整体比例复查，而非仅以高度相等作为设计通过条件。

参考：[Apple 列表](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)、[布局](https://developer.apple.com/design/human-interface-guidelines/layout)、[材质](https://developer.apple.com/design/human-interface-guidelines/materials)。
