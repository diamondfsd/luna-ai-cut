# Luna AI Cut

> Insta360 Luna Ultra 相机的桌面搭档 —— 媒体管理 · 水印导出 · 一站式完成

Luna AI Cut 是一款面向 Insta360 Luna Ultra 相机的桌面媒体管理工具。通过 Wi-Fi 连接相机后，可以浏览、选择、下载相机中的照片和视频，支持水印导出、批量操作、边到边预览等丰富功能。

## 下载

前往 [GitHub Releases](https://github.com/diamondfsd/luna-ai-cut/releases) 下载最新版本：

| 平台 | 格式 | 架构 |
|------|------|------|
| macOS | `.dmg` | Apple Silicon（M 系列芯片） |
| Windows | `.exe` (NSIS) | x64 |

## 使用文档

- 产品介绍与使用指南：[https://diamondfsd.github.io/luna-ai-cut/](https://diamondfsd.github.io/luna-ai-cut/)（源码在 [`landing/`](landing/) 目录）

## 核心功能

- **一键连接相机** — 连接 Luna Wi-Fi 热点后，应用自动检测设备并加载媒体库
- **媒体浏览管理** — 按日期分组浏览，支持全部/照片/视频快速筛选，三种缩略图尺寸自由切换
- **高效选择下载** — 框选、单选、组选灵活切换，批量下载到本地日期目录，实时进度显示
- **边到边预览** — 全屏暗色预览，右侧信息面板展示分辨率、文件大小、拍摄时间等关键元数据
- **水印与导出** — 支持多种水印样式、位置和大小，导出时自动添加品牌标识
- **本地资源管理** — 已下载文件跨会话保持状态，无需重复连接相机即可浏览管理

## 开发指南

### 环境要求

- Node.js >= 22
- npm（项目使用 npm 管理依赖）

### 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器（Vite + 热更新）
npm run dev
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器（支持热更新） |
| `npm run build:app` | 仅构建前端（tsc + vite build） |
| `npm run build` | 完整构建（tsc + vite build + electron-builder 打包） |
| `npm run pack:mac:arm64` | 打包 macOS ARM64 DMG |
| `npm run pack:win:x64` | 打包 Windows x64 NSIS |
| `npm run pack:all` | 同时打包 macOS 和 Windows |
| `npm run lint` | ESLint 代码检查 |
| `npm run mock:luna` | 启动模拟 Luna 相机服务器 |
| `npm run preview` | 预览构建产物 |

### 项目结构

```
luna-ai-cut/
├── src/                  # 前端源码（React + TypeScript）
│   ├── ui/               # 共享 UI 组件层（Button、Dialog、Tabs 等）
│   ├── components/       # 功能组件
│   ├── pages/            # 页面组件
│   ├── context/          # React Context
│   ├── styles/           # 全局样式与设计令牌
│   ├── lib/              # 工具函数
│   └── shared/           # 共享类型定义
├── electron/             # Electron 主进程
│   ├── main.ts           # 主进程入口
│   └── preload.ts        # preload 脚本（contextBridge）
├── landing/              # 产品介绍页（GitHub Pages 部署）
├── luna_mock_server/     # 模拟 Luna 相机服务器
├── scripts/              # 构建脚本
├── build/                # 应用图标
├── public/               # 静态资源
├── dist/                 # Vite 构建产物
├── dist-electron/        # Electron 构建产物
└── release/              # 打包产物输出目录
```

### 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | React 18 + TypeScript |
| 构建 | Vite 5 |
| 桌面 | Electron 30 |
| UI 基元 | @radix-ui（Dialog / Tabs / Popover / Switch / Tooltip） |
| 图标 | lucide-react |
| 路由 | React Router（HashRouter） |
| 媒体解析 | exifr |
| 打包 | electron-builder |

### Electron 配置

- 主进程入口：`electron/main.ts`
- Preload 脚本：`electron/preload.ts`
- 构建产物：`dist-electron/`
- 图标文件：`build/` 目录（icon.icns / icon.ico / icon.png）
- 打包产物：`release/`

## License

MIT © [diamondfsd](https://github.com/diamondfsd)

---

> 本项目与 Insta360 公司无关联。Insta360 是 Arashi Vision 公司的注册商标。
