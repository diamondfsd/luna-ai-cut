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
| `SegmentedControl` | 分段选择器，用于媒体过滤和尺寸切换 |
| `Switch` | 开关控件，用于二进制设置项（基于 Radix） |
| `Tooltip` | 悬停提示（基于 Radix） |
| `Dialog` | 弹窗，含 DialogContent / DialogHeader / DialogBody / DialogFooter / DialogTitle / DialogDescription（基于 Radix） |
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

基于 `@radix-ui/react-dialog`。用法：

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>标题</DialogTitle>
      <DialogDescription>描述</DialogDescription>
    </DialogHeader>
    <DialogBody>内容区域</DialogBody>
    <DialogFooter>
      <Button variant="secondary">取消</Button>
      <Button variant="primary">确认</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- **DialogContent** — 包含遮罩层 + 内容面板 + 右上角关闭按钮，自动 Portal
- **DialogHeader** — 顶部，含 border-bottom，自动给 DialogTitle 预留关闭按钮空间
- **DialogBody** — 可滚动内容区域
- **DialogFooter** — 底部操作栏，flex-end 对齐

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

## 组件库选择

Radix 基元仅用于提供行为和可访问性，不施加视觉样式。**不要引入完整的视觉框架**（如 Ant Design 或 MUI），除非设计方向有意变更。

## 维护规范

单个源文件原则上不要超过 500 行。提交前扫描相关改动范围内的 `.ts` / `.tsx` / `.css` 文件，超过 500 行时优先按功能组件、服务职责或样式域拆分；只有历史规格文档、外部资料归档或无法安全拆分的生成类内容可以例外，并在改动说明中标明原因。

在添加新的可复用控件之前：

1. 检查 `src/ui` 是否已有匹配的组件。
2. 如果行为是共享的，以保守的 prop 扩展现有组件。
3. 只有当样式属于特定页面或工作流时，才添加功能特定的 CSS 类。
4. 提交 UI 改动前运行 `npm run build:app`。

## 项目概述

Luna AI Cut 是一款面向 Insta360 Luna Ultra 相机的桌面媒体管理。

### 核心流程

1. **连接相机** → 连接 Luna Wi-Fi 热点 → 应用自动检测并加载媒体库
2. **浏览与下载** → 按日期分组浏览 → 单选/组选/框选 → 下载到本地
3. **设置** → 下载目录、开发者模式、Mock Server、AI 配置

### 技术栈

- **前端**：React + TypeScript + Vite
- **路由**：React Router（HashRouter）
- **图标**：lucide-react
- **UI 基元**：@radix-ui（react-dialog / react-tabs / react-popover / react-switch / react-tooltip）
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
├── styles/          # 全局样式
├── lib/             # 工具函数
├── shared/          # 共享类型定义
├── styles/          # 全局样式
└── .github/workflows/  # CI 打包配置

## 项目基础信息

### 包管理器
- 使用 **npm**（不是 pnpm），`package-lock.json` 是锁定文件

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build:app` | 仅构建前端（tsc + vite build） |
| `npm run build` | 完整构建（tsc + vite build + electron-builder） |
| `npm run pack:mac:arm64` | 打包 macOS ARM64 DMG |
| `npm run pack:win:x64` | 打包 Windows x64 NSIS |
| `npm run lint` | ESLint 检查 |
| `npm run mock:luna` | 启动模拟 Luna 相机服务器 |

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
```
