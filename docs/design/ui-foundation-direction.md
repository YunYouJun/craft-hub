# 工作台 UI 统一与共享设计基础

更新：2026-10-09。已接入 YunLeFun 的 CSS 设计基础，采用 **Workspace / Admin（ToB）** 的中性色、系统字体和控件密度；保留 Craft Hub 的工作台布局、源码组件与 Reka UI 交互。

## 为什么选择 Workspace / Admin

[YunLeFun/design](https://github.com/YunLeFun/design) 将使用场景分为 Consumer 与 Workspace，Workspace 下进一步区分 Admin / Editor。个人使用并不意味着必须选 Consumer：Craft Hub 的主要任务是查看软件与环境状态、配置工具、审阅安装和迁移计划，适合 Admin 的查询和操作密度。Consumer 更偏内容、品牌与轻操作；Editor 更适合画布、时间线和属性面板。

默认正文 14px、辅助文字 12px、页面标题 22px；共享控件桌面默认 32px、紧凑 28px，窄屏或粗指针增至 44px / 40px。控件圆角 6px、面板 10px。保留现有留白、卡片和局部玻璃效果，避免让工作台变成密集数据表。标题栏和侧栏部分历史控件仍有独立尺寸，并非所有导航点击区域都已统一。

## 实际接入方式

- 使用 pnpm catalog 固定 `@yunlefun/ui@0.0.7`，依次导入已发布的 `@yunlefun/ui/css` 与 `@yunlefun/ui/admin.css`，随后导入本地语义 token。不再暂存上游 CSS；Craft Hub 的覆盖只写在 `styles/tokens.css`。
- MIT 许可保存在 Web 的 public/licenses 中，随 Vite 产物和桌面 Web 资源分发。
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

- [x] 固定实际发布的基础 CSS 与 Admin profile，并映射本地语义 token。
- [x] 同步系统与手动主题选择器，分离状态文字与实色前景。
- [x] 补齐上述品牌图标，验证 UnoCSS 的真实输出和未知品牌回退。
- [x] 构建后验证工具总览、环境检测与真实工具配置长列表：系统主题、Portal 继承、键盘焦点、固定头尾、默认/紧凑控件尺寸、320 / 390 / 768 / 1440px 无页面横向溢出；Chromium 完整流程和 WebKit 明暗主题弹层冒烟通过。运行时无相关控制台错误或远程图标/字体请求。
- [x] 构建并安装 macOS arm64 Electron 到 `/Applications/Craft Hub.app`；安装与 release 的 ASAR 一致，333 个 Web / Desktop 资源与当前 dist 的 SHA256 一致，实际进程和本地 API 均来自安装版。原生窗口侧栏顺序、品牌图标和本机环境检测通过，六项工具均可用。
- [ ] 补充 Electron 原生明暗主题与键盘交互的完整验收，以及 Tauri 的原生消费端验证；当前原生启动与环境页检查不代替全部宿主验收。
- [x] 2026-10-17：`@yunlefun/ui@0.0.7` 发布 `admin.css`，与原暂存副本逐字节一致；改为导入包入口并删除暂存副本，复核明暗主题与密度。
- [ ] 逐个评估基础控件内部实现替换，继续保留本地调用接口；不单独发布一套新的通用 UI 包。

本轮验证：`pnpm lint`、根目录及 Web `typecheck`、全量 `pnpm test --run`（926 通过、2 个平台相关跳过）和 `pnpm build` 通过。浏览器插件未提供，使用已有 Playwright 执行验收。抽查正文/辅助文字、品牌按钮及 warning/danger/success 的文字、实底与 hover 配对，明暗主题最低对比度 4.82:1；这不代表所有历史控件已完成无障碍审计。

生产 CSS 中九个品牌规则合并为 30.44 KiB，独立 gzip 10.46 KiB；发布基础 CSS 为 11.79 KiB，独立 gzip 2.35 KiB。独立压缩数值不等于整个安装包的增量，完整图标集合未进入 Web 运行时。

证据：[场景入口](https://github.com/YunLeFun/design/blob/45ad5ba3788de14144a282d0aea0a975fb6c121c/packages/guide/admin.md)、[接入与成熟度](https://github.com/YunLeFun/design/blob/45ad5ba3788de14144a282d0aea0a975fb6c121c/packages/guide/adoption.md)、[现有组件约定](https://github.com/YunYouJun/craft-hub/blob/main/apps/web/src/components/ui/README.md)。

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

## 动效与桌面宿主行为

2026-10-15：对齐 YunLeFun/design main 新增的移动端与动效约定。`styles/tokens.css` 以 `--motion-*` 别名读取上游 `--ylf-*` 变量，调用方只用 `--motion-*`。2026-10-17：`@yunlefun/ui@0.0.7` 已发布这些变量，取值与原本地回退一致，回退值随之移除。上游在减少动态效果时把时长归零、按压缩放设为 1；全局规则原本就将时长压到 0.01ms，实际表现不变。

- 按压：共享 Button 按下 100ms 缩至 0.98，松开用软弹簧回弹；悬停反馈只在 `hover: hover` 且 `pointer: fine` 时出现，触屏依赖按压与选中状态。
- 开关：拇指位移改用软弹簧（480ms），按下时向行程方向拉长 4px。
- 弹层：所有 Reka 定位弹层（菜单、Select、Combobox、Tooltip、Popover）在 `[data-reka-popper-content-wrapper]` 下统一从触发方向轻移 4px、淡入，收起时淡出，开合对称；菜单使用 160ms，接近原生菜单的即时感。居中 Dialog（含默认 `.dialog-content`）使用 240ms 进入、160ms 离开，命令面板保持 160ms。
- 减少动态效果：沿用全局 `prefers-reduced-motion` 规则，并将位移、缩放和拇指拉伸归零；状态仍直接反映最终结果。
- 桌面宿主（Electron / Tauri 注入 `data-desktop-platform`）：按钮、标签页、菜单项、开关等控件使用系统箭头光标且标签不可选中；侧栏、状态栏与面包屑不可选中，控件内图标与链接不可拖拽。链接、输入框、代码和正文保持浏览器行为；普通浏览器继续使用 Web 习惯的手形光标。

本轮在浏览器中验证：变量解析、弹簧曲线有效、菜单弹层方向与变换原点、退出动画结束后卸载并把焦点交还触发器、桌面模式下所有按钮均为箭头光标。尚未在 Electron 安装版与 Tauri 中做原生验收。

### 加载占位与内容进场

2026-10-15：首页同时读取多个来源，原先每块都显示转圈和「正在读取…」文字。改为与结果同形的骨架屏，减少整页转圈。

- 何时用骨架：首次加载、区域内还没有任何结果时，用 `components/ui/skeleton` 的 `SkeletonList`。行数、图标位、标题与说明行和真实列表一致，结果到达后不跳动。已有结果的刷新不替换为骨架：保留旧内容，只让刷新按钮转圈，并给读屏器一条隐藏的状态文字。按钮内的操作中状态（分析中、保存中）保持原位转圈。
- 可访问性：外层 `role="status"` + `aria-busy="true"`，只朗读一句标签；占位形状 `aria-hidden`。
- 外观：底色为 `--skeleton-base`（文字色 7% 混入表面色，深浅主题都可见），所有形状共用一道视口宽的高光，整页同步缓慢扫过。骨架在 120ms 后才淡入，快速响应不会闪一下。减少动态效果时去掉高光，只留静态占位。
- 进场：替换骨架的内容用 `.motion-reveal`（单块）或 `.motion-reveal-list`（列表）上移 4px 淡入，列表行间隔 30ms，最多错开 6 行。动画只保留 backwards 填充，结束后元素不带 transform，不影响弹层定位。

已应用：今日重点、我的工作（来源列表与各来源首次加载）、常用项目、项目目录、工作区项目列表（替换原有私有闪烁样式）。

### 控件状态动效

- 分段标签：共享 `TabsList` 的 segmented 变体渲染 Reka `TabsIndicator`，选中底板以 480ms 软弹簧在分段间滑动，替代原先背景瞬切；sidebar 变体与 `asChild` 用法不变。列表始终为 `position: relative`，指示器首次测量即对齐。
- 导航项：背景、文字色、阴影 160ms 过渡；悬停只在精确指针下出现，与 Button 一致。
- 复选框：底色与边框 160ms 过渡，按下缩至 0.9；对勾只在用户改变状态后以软弹簧弹出，列表首次渲染时已勾选的项不播放。
- 今日重点的展开项：箭头旋转过渡；支持 `::details-content` 与 `interpolate-size` 的引擎（Electron / Chromium）高度平滑展开，其他浏览器直接展开。

在浏览器中人为延迟接口验证：骨架行与结果行对齐，高光运行，两组分段标签的指示器与选中项像素对齐，切换时从 316 回弹到 190 后停在 199。深色主题未做截图验收。

## macOS 窗口材质

2026-10-15：保留 Web UI，在宿主层让 macOS Electron 窗口更接近原生。主窗口启用 `vibrancy: 'sidebar'`、`visualEffectState: 'followWindow'` 与透明背景；失焦时材质随窗口切到非活跃状态，与系统侧栏一致。Windows、Linux 与 Tauri 不变。

- 范围：只有活动栏与主侧栏（`.project-rail` 内的 `.activity-rail`、`.rail-content`）透出材质。顶栏、状态栏、正文、二级分区导航、Dialog 与弹层保持不透明。正文区域旁的容器用零优先级 `:where()` 兜底为 `--surface`，已有背景不受影响。
- 开关：Electron 主进程通过 `--craft-hub-window-material=sidebar` 告诉 preload，preload 暴露 `craftHubDesktop.windowMaterial`，Web 再写入 `data-desktop-window-material`。CSS 同时要求 `data-desktop-platform='darwin'` 和这个属性。Tauri 同样上报 `darwin`，但没有这个属性，因此不会出现透明而无材质的区域。普通浏览器两个属性都没有，宽度不超过 760px 时也不生效。
- 着色：侧栏在材质上叠加原有颜色。浅色叠 75%，深色叠 60%；开启「减少透明度」时为 100%。浅色窗口后方是黑色窗口时最暗，实测材质约为 `rgb(200 204 207)`。叠 60% 后侧栏文字对比度为 4.39:1，低于 4.5:1，因此浅色提高到 75%：实测 4.65:1，图标 3.20:1。深色叠 60%：文字 7.80:1，图标 5.46:1。
- 启动：窗口以 `show: false` 创建，`ready-to-show` 后显示。加载失败时也会显示，以便诊断。非 macOS 的窗口底色改为 Web body 色（深色 `#191c22`，原为 `#1f232b`），首帧前不再出现色差。
- 右键菜单：Electron 默认没有右键菜单。输入框现在弹出原生编辑菜单：拼写建议、撤销、重做、剪切、复制、粘贴、粘贴并匹配样式、全选，可用状态取自 `editFlags`，文案跟随工作台语言。只读文字有选区时只显示「复制」。Reka 自定义菜单会取消 DOM 事件，原生菜单不会叠加出现。

验收：`pnpm dev` 依赖 4318 端口和开发会话锁，二者已被另一个 `pnpm dev:web` 占用。生产模式又会注册正式的 URL 协议，所以未直接运行。改用临时 Electron 脚本，复用真实的 `window-appearance.ts` 与 `preload.cjs`，加载同一份 Vite 页面，在 1440×900 下检查首页和项目页：

- 两种主题下 `html` / `body` 透明，侧栏为半透明色。侧栏外 20 个采样点都落在不透明背景上。
- 输入框弹出完整编辑菜单；侧栏行右键只出现应用自己的菜单。
- 深色启动在显示后 80ms 内已是带样式的深色页面。显示瞬间的白帧在纯红和不透明对照窗口中同样出现，属于截图时机问题，不是闪白。
- 原材质对照：浅色在无背景、白色、黑色窗口后方分别为 207、225、200；深色为 43、83、38。材质跟随 `nativeTheme.themeSource`。
- 普通浏览器下根节点没有宿主属性，背景与改动前一致。

`pnpm lint`、`pnpm typecheck`、`pnpm test --run`（217 个文件，1730 通过，2 跳过）、`pnpm build` 通过。未测量 GPU 与能耗；材质由系统合成，页面没有新增 `backdrop-filter`。尚未在打包安装版、外接显示器以及开启「减少透明度」的系统上做原生验收。

## 启动包体与窗口状态

2026-10-17：首屏只保留首页、项目页和外壳，其余视图与弹窗按需加载，桌面窗口记住上次的位置与大小。

- 按需加载：`App.vue` 在模块级的 `<script lang="ts">` 中用 `lazyComponent()` 包装工具、软件中心、环境、诊断、集成、插件、工作台总览、欢迎页等视图，以及命令面板、设置、快速记录、Agent 操作、市场等弹窗。包装必须放在模块作用域；放进 `<script setup>` 会在每个实例上重建，预取的结果用不上。
- 空闲预取：挂载后 `prefetchLazyComponents()` 每个空闲时段加载一个分块（`requestIdleCallback`，2 秒超时；不支持时 200ms 间隔）。预取经由异步组件自身的加载器完成，首次打开同帧渲染，不再出现 200ms 空白。预取失败会被忽略，组件首次渲染时自己重试。
- 弹窗：`useOpenedOnce()` 让弹窗在第一次打开时才挂载，之后保持挂载，关闭动画和内部状态不丢。
- 结果：Web 主包从 1,073 KB（gzip 304 KB）降到 460 KB（gzip 128 KB）。测试用 `loadLazyComponents()` 在 `beforeAll` 中一次性解析，路由断言仍可同步进行。
- 窗口状态：Electron 主窗口关闭时把非最大化时的位置、大小和最大化状态写入用户数据目录的 `window-state.json`，下次启动恢复。标题栏所在区域不再落在任何显示器上（如外接屏已断开）时改为居中；尺寸限制在最小值与最大工作区之间。文件缺失或损坏时用默认 1440×900。
- 桌面根节点：`data-desktop-platform` 下根节点与 body 设 `overscroll-behavior: none`，整窗不再橡皮筋回弹，内部滚动区保持原有回弹。macOS 宿主开启 `-webkit-font-smoothing: antialiased`，与 AppKit 的灰度抗锯齿一致，深色模式下浅色文字不再发虚加粗。

在浏览器中验证：深色主题下首页、工具、项目页显示正常，懒加载的工具页切换无空白帧，控制台无错误。窗口状态只有单元测试覆盖，尚未在 Electron 中实际验收多显示器场景。

## 窗口焦点与滚动边缘

2026-10-17：补两处 macOS 原生窗口的细节。

- 非活跃窗口：桌面宿主下 `window-focus.ts` 根据 `document.hasFocus()` 在根节点写入 `data-window-inactive`（焦点在内嵌 frame 中仍算活跃）。窗口失焦时，活动栏、主侧栏和页面二级侧栏内的选中项去掉强调色：在这些容器里把 `--accent`、`--accent-soft` 与 `--workbench-sidebar-active-background` 改为中性灰（文字 8% 混入背景），与 AppKit 非活跃侧栏一致。弹窗、正文与普通浏览器不受影响。
- 滚动边缘分隔线：路径栏（面包屑）与页面标题区的下边线默认透明，内容滚到它们下面时才以 160ms 淡入，与 macOS 工具栏的滚动边缘一致。`WorkbenchPageShell` 在捕获阶段监听滚动，只认与内容区顶部齐平的滚动容器，页面中部的嵌套面板不会触发；切换路由时复位。`WorkbenchViewFrame` 标题固定，分隔线画在其下方的整宽布局上；带二级侧栏的页面保留常驻分隔线。

在浏览器中验证：首页滚动 300px 后标题下方出现分隔线，回到顶部消失；模拟非活跃窗口时，选中项文字由 `#2563eb` 变为 `#626b78`，背景改为 8% 中性灰。浏览器面板截图不能反映过渡后的画面，最终观感仍需在 Electron 中确认。

## 侧栏收起与待连接来源

2026-10-17：

- 侧栏收起：活动栏宽度由 `useTransition` 在 176px 与 52px 之间以 220ms easeOutCubic 过渡，CSS 变量 `--workbench-activity-width` 与项目页的 Reka 分栏偏移逐帧跟随。收起时保留展开时的几何：按钮仍满宽、高 32px，导航内边距不变，图标位置只移动约 1px。标签不再 `display: none`，先淡出（展开时延迟 100ms 后淡入），因此宽度变化期间不重排、不出现横向滚动。窄屏与「减少动态效果」直接切换。浏览器逐帧采样：首页 176→52px 约 200ms 完成，图标横坐标保持 17–18px；项目页分栏宽度与活动栏同步变化，记住的侧栏宽度不受影响。
- 待连接来源：首页「我的工作」里，一个来源组的全部列表都需要授权时，只显示「需要连接账号」提示和连接按钮，不再渲染空的子标签、空列表和「查看全部」；组头或来源栏的刷新按钮仍在。刷新时保留上次的连接状态直到新的检查返回，提示不会闪成空列表。
