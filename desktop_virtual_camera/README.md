# Luna Desktop Virtual Camera

> 维护位置：本目录是唯一源，原 Flutter 项目中的 `desktop_virtual_camera` 已移除。

跨平台桌面虚拟摄像头开发目录。正式输入是手机经 USB AOA 转发相机流；电脑不连接
相机 Wi-Fi，原有网络用于直播。当前已集成到 Luna AI Cut，并由“直播控制台”页面驱动。

准备继续开发或交给其他 AI 接手时，先读 [`AGENTS.md`](AGENTS.md) 和
[`docs/app-stream-bridge.md`](docs/app-stream-bridge.md)。前者说明目录边界、当前
状态和 Windows 下一步，后者定义当前 App 与平台 Host 之间真实可接收的视频通路。

目标链路：

```text
Luna 相机实时预览
  -> Luna 咔手机 App
  -> USB AOA
  -> Luna AI Cut UsbAoaReceiver
  -> UCD2 / TCP 4184
  -> LunaCameraHost
  -> VideoToolbox HEVC Decoder
  -> LunaCameraSharedFrameStore
  -> macOS Camera Extension
  -> 系统摄像头
```

## 目录

```text
desktop_virtual_camera/
├── core/       Rust 公共核心：UCD2 接收、Luna 帧解析、帧队列和解码接口
├── macos/      macOS Camera Extension 适配层
├── windows/    Windows Media Foundation Virtual Camera 适配层
├── docs/       协议、平台、授权和 Luna AI Cut 集成记录
└── tools/      PC 端接收与诊断工具
```

## 开发边界

- `core` 不依赖 Flutter、Electron 或具体桌面 UI。
- 平台目录只负责把公共帧提交给系统虚拟摄像头。
- Luna `UCD2` 媒体帧解析规则与 Flutter 项目中的 `luna_frame.dart` 保持一致。
- 当前真实预览流为 HEVC/H.265 媒体帧，桌面端先按 HEVC 接收和解码。
- Luna AI Cut 的 Electron 主进程负责 USB AOA 接收、UCD2 解析、Host 转发、状态管理
  和生命周期；renderer 只通过 preload 暴露的 `desktopVirtualCamera` API 操作。
- 电脑不再连接相机 Wi-Fi，本机网络保持可用于直播推流。

## 当前阶段

- 手机端：已实现 USB AOA 输出桥、HEVC access unit 订阅和 UCD2 封装。
- macOS：已实现 Host、HEVC 解码、App Group 最新帧共享和 Camera Extension。
- Luna AI Cut：已实现 `/live-console`、USB AOA 接收、Electron IPC、Host 管理和授权指引。
- Windows：已完成 Windows 11 Media Foundation 方案的 API 核验，但没有可发布实现；
  当前状态和组件边界见 [`windows/README.md`](windows/README.md)。

## 在 Luna AI Cut 中构建

首次构建前，需要在 Xcode 登录包含签名证书和 Mac Development profile 的开发者账号。
然后从仓库根目录执行：

```bash
LUNA_DESKTOP_CAMERA_TEAM_ID=YOUR_TEAM_ID \
CODE_SIGN_IDENTITY='Apple Development' \
pnpm build:desktop-camera
```

脚本会签名构建 `LunaCameraHost.app`，校验签名，并复制到：

```text
resources/desktop-virtual-camera/LunaCameraHost.app
```

开发模式下，直播控制台也会从以下签名构建目录查找 Host：

```text
desktop_virtual_camera/macos/.build/SignedData/Build/Products/Debug/LunaCameraHost.app
```

完整集成说明见 [`docs/luna-ai-cut-integration.md`](docs/luna-ai-cut-integration.md)，Windows
原生实现边界见 [`windows/README.md`](windows/README.md)。

## 启用系统摄像头扩展

1. 在“直播控制台”安装并启动 `Luna Camera Host`。
2. 打开“系统设置”。
3. macOS 15 及以上：前往“通用 → 登录项与扩展 → 摄像头扩展”。
4. 启用 `Luna Virtual Camera Extension`。
5. 返回直播控制台刷新状态；如果状态未更新，重启 Luna AI Cut。

Camera Extension 只能由位于 `/Applications` 的 Host App 申请安装。

## USB AOA 要求

- 手机必须先连接相机，再由 Luna 咔读取实时预览。
- USB 数据线连接手机和电脑后，Android 需要授予 USB Accessory 权限。
- 电脑端 AOA 描述必须与手机端 `usb_accessory_filter.xml` 完全一致。
- 电脑的网络接口不参与相机连接，只用于直播平台推流。

## 抓包回放

已有的解包 follow stream 可以恢复为真实 HEVC：

```bash
node desktop_virtual_camera/tools/extract_luna_hevc_from_follow.mjs
```

默认输入为：

```text
protocol_analysis/artifacts/luna-exposure-focus-tracking-follow-0.txt
```

默认输出为：

```text
desktop_virtual_camera/tools/recovered/luna-preview.hevc
```

该工具只提取 `UCD2 media type=0x01` 且 `streamType=0x20` 的真实 HEVC payload，
不会把控制帧或跟踪数据混入视频。
