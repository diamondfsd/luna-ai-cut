# AGENTS.md

## UI 组件规则

本项目使用 `src/ui` 目录下的本地 UI 层，以及 Radix 基元提供可访问的低级行为。

### 共享组件清单

使用 `src/ui` 组件管理所有共享控件。**所有 UI 组件默认基于 Radix 基元进行二次开发**，不使用原生 HTML 元素自制交互行为（如用 `<select>` 做下拉、用 JS 控制显隐等）。Radix 已提供的行为基元包括：Dialog、Popover、Tabs、Switch、Tooltip、Collapsible、Select 等。

| 组件 | 说明 |
|------|------|
| `Button` | 通用按钮，支持 `primary` / `secondary` / `utility` / `ghost` / `danger` 五种主题和 `default` / `compact` / `mini` 三种尺寸 |
| `IconButton` | 圆形图标按钮，支持 `circle` / `light` / `outline` / `ghost` 四种主题和 `default` / `compact` / `mini` 三种尺寸 |
| `Input` | 输入框，支持 `pill` / `compact` / `ghost` 三种主题，可选 icon 前置图标和 fullWidth 撑满父容器 |
| `SearchField` | 搜索输入框（基于 Input 封装），带放大镜图标 |
| `Select` | 下拉选择器（基于 Radix Select），支持 `pill` / `compact` / `ghost` 三种主题，可选 icon 和 fullWidth |
| `Accordion` | 手风琴折叠面板（基于 Radix Collapsible），支持受控/非受控模式 |
| `ButtonGroup` | 分段选择器，用于媒体过滤和尺寸切换 |
| `Switch` | 开关控件，用于二进制设置项（基于 Radix） |
| `Tooltip` | 悬停提示（基于 Radix） |
| `Dialog` | 弹窗，统一通过 `title` / `description` / `footer` / `children` 等 props 使用（基于 Radix） |
| `Popover` | 弹出面板，含 PopoverContent / PopoverTrigger / PopoverClose（基于 Radix） |
| `Tabs` / `PillTabs` | 标签切换，`PillTabs` 是药丸形预设（基于 Radix） |
| `LoadingIndicator` | 加载状态指示器 |

> `TextField` 已弃用，请使用 `Input variant="pill"` 替代。

### Button 主题对照

| variant | 外观 | 使用场景 |
|---------|------|---------|
| `primary` | 蓝色实心圆角（`--blue` 背景） | 保存、连接、创建等主要操作 |
| `secondary`（默认） | 蓝色边框透明 | 取消、重置、刷新等次要操作 |
| `utility` | 深色矩形按钮 | 工具类操作（如选择目录） |
| `ghost` | 虚线边框文字按钮 | 标签选择、快速操作等低强调场景 |
| `danger` | 红色边框透明 | 删除片段、移除选框等销毁操作 |

**尺寸**：`default`（36px）/ `compact`（32px）/ `mini`（28px）

### IconButton 主题对照

| variant | 外观 | 使用场景 |
|---------|------|---------|
| `circle`（默认） | 44px 灰色圆形 | 关闭、设置等通用图标操作 |
| `light` | 44px 半透明白色圆形 | 深色背景上的图标操作（预览弹窗） |
| `outline` | 32px 蓝色边框圆形 | 刷新、标记等次要图标操作 |
| `ghost` | 28px 透明圆形 | 标签删除等最小干扰场景 |

**尺寸**：`default`（44px）/ `compact`（32px）/ `mini`（28px）

### Input 主题对照

| variant | 尺寸 | 使用场景 |
|---------|------|---------|
| `pill`（默认） | 44px 高，圆角 999px | 设置页表单、WiFi 密码、项目名称 |
| `compact` | 32px 高，圆角 8px | 标签内联编辑、快速输入 |
| `ghost` | 40px 高，圆角 999px | 聊天输入框等场景 |

额外支持：`icon`（前置图标）、`forwardRef`、`fullWidth`（撑满父容器）

### Dialog 弹窗

基于 `@radix-ui/react-dialog`，统一组件通过 props 控制所有内容，无需引入子组件：

```tsx
<Dialog
  open={open}
  onOpenChange={setOpen}
  title="标题"
  description="描述"
  footer={<><Button variant="secondary">取消</Button><Button variant="primary">确认</Button></>}
>
  内容区域
</Dialog>
```

| Prop | 说明 |
|------|------|
| `open` / `onOpenChange` / `defaultOpen` | 受控/非受控模式 |
| `trigger` | 触发按钮（非受控模式） |
| `title` | 弹窗标题 |
| `description` | 弹窗描述 |
| `children` | 主体内容 |
| `footer` | 底部操作栏 |
| `className` | 弹窗内容面板自定义类名 |

标题和描述自动组合为头部（带 `.ui-dialog-header`），footer 自动包裹 `.ui-dialog-footer`。需要自定义 body 样式时在 children 中自行包裹 div。

### Popover 弹出面板

基于 `@radix-ui/react-popover`。用法：

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button>打开</Button>
  </PopoverTrigger>
  <PopoverContent align="end" sideOffset={6}>
    <div data-popover-header>面板标题</div>
    <div>内容区</div>
  </PopoverContent>
</Popover>
```

- `align` — `start` / `center` / `end`，默认 `end`
- `sideOffset` — 与触发元素的间距，默认 6
- 内容面板带阴影和箭头
- 面板头部通过 `data-popover-header` 属性启用样式

### Tabs 标签

- **PillTabs** — 药丸形，类似 SegmentedControl，用于紧凑筛选切换
- **Tabs / TabsList / TabsTrigger / TabsContent** — 原始 Radix 包装，用于内容区域标签

```tsx
// 药丸形
<PillTabs value={tab} onValueChange={setTab}
  items={[{value:'a', label:'素材'}, {value:'b', label:'标注'}]} />

// 内容区标签
<Tabs value={tab} onValueChange={setTab}>
  <TabsList>
    <TabsTrigger value="a">素材</TabsTrigger>
    <TabsTrigger value="b">标注</TabsTrigger>
  </TabsList>
  <TabsContent value="a">素材内容</TabsContent>
  <TabsContent value="b">标注内容</TabsContent>
</Tabs>
```

### 禁止行为

**不要**在页面或功能组件中直接使用原始 CSS 类：
`.pill`、`.icon-pill`、`.circle-button`、`.utility-button`、`.search-pill`、`.segmented-pill`、`.size-switch`、`.toggle-switch`、`.host-field`

应使用对应的 `src/ui` 组件替代。

## 样式规则

保持视觉方向与 `DESIGN.md` 一致：

- 媒体内容为主导地位，控件应紧凑且低调。
- 使用 `src/styles/variables.css` 中定义的设计令牌。
- 保持单一强调色 `--blue`（`#0066cc`）。
- 偏好扁平化设计，按钮和文本不添加厚重阴影。
- CSS 用于布局和功能特定表面，可复用的控件样式放在共享 UI 层（`src/ui/ui.css`）。
- **每个功能组件的 CSS 写在自己的文件里**，并在组件代码中自行 import，不要在 `main.tsx` 统一加载。workspace 子模块已有独立文件约定：`workspace-crop.css`、`workspace-color.css`、`workspace-mode.css` 等，每个由对应的组件引入（如 `WorkspaceCropOverlay.tsx` import `../../styles/workspace-crop.css`）。无论 workspace 内外，功能相关的样式都必须单独建文件、由组件自行加载，不得塞入已有的公共 CSS 文件或全局入口集中加载。

## 文案规则

面向用户可见的组件文案、提示、弹窗、按钮、空状态、错误说明等，不要出现偏开发人员的专业术语（例如 JSON、IPC、WebGL、pipeline、缓存键、序列化等）。需要表达技术实现时，转换成用户能理解的结果或行为，例如“编辑内容会自动保存”“项目会保存在本地资源中”。

## 组件库选择

**优先使用 radix-ui 进行二次封装**。radix-ui 已作为 monorepo 全量安装（`npm install radix-ui`），所有 Radix 基元通过 `radix-ui/*` 路径导入，按需使用。

Radix 基元用于提供行为和可访问性，不施加视觉样式。**不要引入完整的视觉框架**（如 Ant Design 或 MUI），除非设计方向有意变更。

## 维护规范

单个源文件原则上不要超过 500 行。提交前扫描相关改动范围内的 `.ts` / `.tsx` / `.css` 文件，超过 500 行时优先按功能组件、服务职责或样式域拆分；只有历史规格文档、外部资料归档或无法安全拆分的生成类内容可以例外，并在改动说明中标明原因。
行数限制是为了让你在开发的时候，注意组件拆分，不要堆砌组件，需要合理的进行组件开发。

### 测试约定

- 日常开发默认不启动应用执行界面化 UI 测试；必须验证 Electron 生命周期或关键用户行为时由 Codex 执行行为自动化，截图、视觉效果和手感集中在里程碑或 RC 验收。
- 用户可以参与里程碑/RC 验收并提交 Bug 或需求，但用户验收不替代 Codex 的风险测试和发布前回归。
- 仍需按改动风险执行构建、类型检查、Lint 和适用的非界面自动化测试。
- 测试顺序默认是非视觉自动化优先：先运行逻辑、服务、文件、持久化和错误日志断言，再运行 Electron 行为自动化；截图、效果观察和鼠标手感集中到功能里程碑或 RC，不穿插阻塞日常实现。
- 测试按风险选择最小集合，不按功能点逐项堆用例。按钮文案、图标/枚举映射、静态布局、简单显隐、无分支 getter/setter 和薄封装默认不写专用测试，由 TypeScript、变更范围 Lint、代码审查或上层流程覆盖。
- 必测范围集中在数据安全、持久化与迁移、IPC/文件/工作进程契约、异步取消和过期结果、下载中断恢复、模型空/坏结果、渲染与导出一致性，以及已发生的严重回归。
- 新增测试必须对应明确故障；同一风险已有稳定上层覆盖时不重复补低层断言。优先纯函数/服务测试，只有必须验证 Electron 生命周期或真实用户行为时才启动应用。
- 日常开发只运行与改动直接相关的测试、类型检查和变更范围 Lint；共享基础设施或公共契约变更运行相邻回归；完整 Electron、视觉、全量模型、三平台和完整套件只在里程碑、RC 或发布前执行。
- 对重复、脆弱、长期缓慢且不能定位真实故障的测试，应合并、替换或删除，不以测试数量作为质量指标。

Electron E2E 必须统一使用 Playwright Test。禁止新增基于 `agent-browser`、手写 CDP 客户端或其他测试执行器的 Electron E2E；临时人工排查不能替代仓库内的 Playwright 用例。

- 使用 `@playwright/test` 的 `_electron.launch()` 直接启动已构建应用，不通过外部 CDP 端口或全局浏览器自动化 CLI 控制 Electron。
- 所有 Electron E2E 统一放在 `e2e/`，复用 `e2e/fixtures/lunaElectron.ts`，并通过 `pnpm test:e2e` 执行；不得为单个功能另建测试执行器。
- 需要隔离设置、缓存和项目数据时，为测试创建独立临时目录并设置 `LUNA_E2E_USER_DATA_DIR`，同时将 `downloadDir`、`localResourcesDir` 和 `exportDir` 指向该目录；不得复用用户现有项目制造损坏或只读场景。
- Electron E2E 默认单 worker 串行运行；每个用例自行启动和关闭应用，涉及重启恢复时复用该用例的隔离数据目录。
- 优先使用 `getByRole`、`getByLabel` 等用户语义 locator 和 Playwright 自动等待；页面更新后重新查询 locator，不持有 DOM ElementHandle 跨更新使用。
- 失败证据写入 `test-results/playwright/`，测试临时目录在成功后清理、失败时保留；新用例必须检查 fixture 收集的 renderer `pageerror` 与 error console。
- 截图、视频、视觉效果和鼠标手感仍集中在里程碑或 RC 验收；日常 E2E 只验证可重复的行为与状态，不把主观视觉检查写入自动化。

在添加新的可复用控件之前：

1. 检查 `src/ui` 是否已有匹配的组件。
2. 如果行为是共享的，以保守的 prop 扩展现有组件。
3. 只有当样式属于特定页面或工作流时，才添加功能特定的 CSS 类。
4. 提交 UI 改动前运行 `pnpm run build:app`。

## 项目概述

Luna AI Cut 是一款面向 Insta360 Luna Ultra 相机的桌面媒体管理。

## 项目用途与 AI 模型许可

- Luna AI Cut 是**开源、非商业用途**的软件，当前不用于商业销售、商业服务或闭源商业产品。
- 选择 ONNX 或其他 AI 模型时，可以使用许可明确允许开源非商业使用、研究或评估用途的模型和权重，不要因为其不允许商业使用而直接排除。
- 仍需逐个核对并记录模型代码、权重和训练数据相关许可；禁止引入来源不明、明确禁止再分发，或连开源非商业用途也不允许的模型资源。
- 每个随应用发布的模型必须记录官方来源、模型版本、许可证文件和 SHA256；许可证与必要声明应随打包资源一同发布。
- 模型加载接口应保持可替换，不要让业务逻辑绑定到单个模型。后续若项目用途变更为商业用途，必须重新审计并替换不支持商业使用的模型权重。
- 本项目计划持续叠加 ONNX 模型。优先使用统一的 ONNX 推理运行时、统一的模型清单和平台资源目录，避免为每个模型重复引入不同推理框架。
- ONNX 模型运行时下载源只允许 ModelScope（魔搭社区）和 Luna GitCode resource release：ModelScope 中完全相同的固定模型文件优先，GitCode 镜像其次；没有字节一致的 ModelScope 文件时只使用 GitCode。境外官方上游仅保留为发布来源、许可与哈希审计信息，不得进入客户端 `url` 或 `mirrors`。不得为命中国内源而替换成不同模型或权重；多个运行时源必须匹配同一大小与 SHA256，并统一通过 `electron/modelLoader.ts` 和通用断点续传下载器加载，不把模型二进制提交到代码仓库或打入安装包。
- 发布 GitCode 安装包、runtime resources 或模型镜像时，凭证配置默认读取主仓库 `/Users/REDACTED/projects/luna-ai-cut/scripts/deploy-release.conf`。该文件已被 Git 忽略，不得打印、复制到工作树或提交；文件不存在、字段缺失或凭证失效时再请求用户提供。

### 核心流程

1. **连接相机** → 连接 Luna Wi-Fi 热点 → 应用自动检测并加载媒体库
2. **浏览与下载** → 按日期分组浏览 → 单选/组选/框选 → 下载到本地
3. **设置** → 下载目录、开发者模式、Mock Server、AI 配置

### 技术栈

- **前端**：React + TypeScript + Vite
- **路由**：React Router（HashRouter）
- **图标**：lucide-react
- **UI 基元**：radix-ui（全量安装的 Radix UI monorepo，统一依赖管理，无需逐个安装 @radix-ui/* 包）
- **桌面**：Electron（通过 contextBridge 通信）
- **AI**：openai SDK
- **构建**：Vite + electron-builder

### 目录结构

```
src/
├── ui/              # 共享 UI 组件层
│   ├── Button.tsx      # 按钮
│   ├── IconButton.tsx  # 圆形图标按钮
│   ├── Input.tsx       # 输入框
│   ├── Dialog.tsx      # 弹窗（Radix）
│   ├── Popover.tsx     # 弹出面板（Radix）
│   ├── Tabs.tsx        # 标签切换（Radix）
│   ├── SegmentedControl.tsx  # 分段选择器
│   ├── Switch.tsx      # 开关（Radix）
│   ├── Tooltip.tsx     # 提示（Radix）
│   ├── SearchField.tsx # 搜索输入框
│   ├── LoadingIndicator.tsx
│   ├── TextField.tsx   # 已弃用
│   ├── ui.css          # 组件样式
│   ├── utils.ts        # cx() 工具函数
│   └── index.ts        # 统一导出
├── components/      # 功能组件
├── pages/           # 页面组件
├── context/         # React Context
├── hooks/           # 共享 React Hooks
├── lib/             # 工具函数
├── routes/          # 路由定义
├── shared/          # 共享类型定义
├── styles/          # 全局样式与设计令牌
└── workspace/       # 编辑工作区及各功能模块
electron/             # Electron 主进程、Preload 与本地服务
luna-render-core/     # Rust 本地渲染核心
luna_mock_server/     # Luna 相机模拟服务
scripts/              # 构建、打包、发布与非 UI 测试脚本
.github/workflows/    # CI 打包、热更新与 Pages 部署
```

## 项目基础信息

### 包管理器
- 使用 **pnpm**，`pnpm-lock.yaml` 是锁定文件

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动 Vite 开发服务器 |
| `pnpm build:app` | 仅构建前端（tsc + vite build） |
| `pnpm build` | 完整构建（tsc + vite build + electron-builder） |
| `pnpm pack:mac:arm64` | 打包 macOS ARM64 DMG |
| `pnpm pack:win:x64` | 打包 Windows x64 NSIS |
| `pnpm lint` | ESLint 检查 |
| `pnpm mock:luna` | 启动模拟 Luna 相机服务器 |
| `pnpm test:workspace` | 执行工作区几何逻辑测试 |
| `pnpm test:diagnostics` | 执行崩溃诊断逻辑测试 |

### Electron 配置
- 主进程入口：`electron/main.ts`
- Preload 脚本：`electron/preload.ts`
- 构建产物输出到 `dist-electron/`
- 图标文件在 `build/` 目录（icon.icns / icon.ico / icon.png）
- 打包产物输出到 `release/` 目录

### CI 打包
- 推送 `v*` tag 时自动触发
- 工作流文件：`.github/workflows/package-artifacts.yml`
- macOS: macos-latest runner，生成 DMG
- Windows: windows-latest runner，生成 NSIS 安装包
