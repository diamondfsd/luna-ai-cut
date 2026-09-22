# Desktop Virtual Camera Agent Guide

本目录是 Luna 桌面虚拟摄像头的唯一维护源。宿主应用是仓库根目录下的 Luna AI Cut
（Electron + React + TypeScript）。旧 Flutter 项目中的 `desktop_virtual_camera`
不再保留，后续代码和文档只在这里更新。

## 核心约束

正式输入必须是 **手机经 USB AOA 转发相机流**：

```text
相机 -> 手机 Luna 咔 -> USB AOA -> Luna AI Cut -> 系统虚拟摄像头
```

电脑不能通过 Wi-Fi 直连相机，因为那会占用电脑网络，导致无法正常直播。电脑只通过
USB 接收手机送来的视频帧，原有网络保留给直播平台。

## 稳定链路

```text
Luna 相机实时预览
  -> Annex-B HEVC access unit
  -> Luna 咔 UsbVideoOutputBridge
  -> UCD2 media frame
  -> Android AOA Bulk endpoint
  -> luna-ai-cut UsbAoaReceiver
  -> TCP 127.0.0.1:4184
  -> LunaCameraHost / Windows Host
  -> system virtual camera
```

USB AOA 描述、UCD2 帧格式和本机 TCP Host 协议是稳定边界。修改任一侧时，必须同步更新
[`docs/app-stream-bridge.md`](docs/app-stream-bridge.md) 和
[`docs/protocol.md`](docs/protocol.md)。

## 必读顺序

1. [`docs/app-stream-bridge.md`](docs/app-stream-bridge.md) - USB AOA 完整接入方式。
2. [`docs/protocol.md`](docs/protocol.md) - UCD2 字节格式速查。
3. [`docs/audio-pipeline.md`](docs/audio-pipeline.md) - 手机音频采集、USB 音频包和未来混音。
4. [`macos/README.md`](macos/README.md) - 已工作的 macOS Host 和 Camera Extension。
5. [`windows/README.md`](windows/README.md) - Windows 11 Media Foundation 实施方案。
6. [`docs/luna-ai-cut-integration.md`](docs/luna-ai-cut-integration.md) - Electron、直播控制台和验收。

## Desktop 接入点

- `../electron/media/desktop-virtual-camera/usbAoaReceiver.ts`
  - 扫描手机、切换 AOA、读取 USB Bulk、解析 UCD2。
- `../electron/media/desktop-virtual-camera/desktopVirtualCameraService.ts`
  - 启动 Host，把完整 UCD2 帧转发到本机 4184。
- `../electron/ipc/ipcDesktopVirtualCameraService.ts`
  - renderer IPC 边界。
- `../src/pages/LiveConsolePage.tsx`
  - 直播控制台。
- `../src/shared/types/desktopVirtualCamera.ts`
  - main/renderer 稳定契约。

不要重新引入 `LunaVideoStreamAdapter` 作为虚拟摄像头输入源。它只服务于电脑端已有的
相机预览功能，不是 USB AOA 直播通路。

## 手机端对端接口

手机端仓库为 `motionbridge_flutter`（Luna 咔）：

- `lib/data/output/android_usb_video_output.dart`
- `lib/features/settings/application/usb_video_output_controller.dart`
- `android/app/src/main/kotlin/com/shuxinwu/motionbridge/UsbVideoOutputBridge.kt`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/res/xml/usb_accessory_filter.xml`

桌面端 AOA 描述字符串必须和 `usb_accessory_filter.xml` 完全一致。当前值为：

```text
manufacturer = LunaKa
model        = Luna USB Video Demo
version      = 1.0
uri          = https://motionbridge.local/usb-video
description  = Luna USB video output
```

## 当前状态

- macOS 15+：Host、VideoToolbox、App Group 帧共享、Camera Extension 已实现并验证。
- 手机端：USB AOA 输出桥和 UCD2 封装已存在。
- 音频传输：PCM16 `0x21` 发送、USB 解复用和桌面统计已接入。
- macOS 虚拟麦克风：Host PCM renderer 和 Core Audio HAL 驱动已实现。
- Luna AI Cut：直播控制台、USB AOA 接收器、Host 生命周期和 IPC 已接入。
- Windows 11：Media Foundation 方案已核验，原生 source DLL 和 Host 尚未实现。

尚未实现：

- Windows 系统虚拟麦克风。
- 手机端同时采集两个麦克风。
- 桌面端多路音频混音和自动音画同步。

## Windows 下一步

1. 保持 Electron 的 `UsbAoaReceiver` 不变，先确保 Windows 能通过 `usb` 包访问 AOA。
2. 解决 Windows 下 AOA Accessory 的 WinUSB/libusb 或 USBdk 驱动部署。
3. 实现 `LunaVirtualCameraSource.dll` 和 `LunaVirtualCameraHost.exe`。
4. Windows Host 继续监听本机 TCP 4184，接收 Electron 转发的同一 UCD2 帧。
5. 用 Windows 相机、`ImageCapture` 和视频会议软件验收。
6. 接入 Windows 虚拟音频设备或 VB-CABLE 联调路径。

Windows 最低版本为 Windows 11 build `10.0.22000`，不实现 Windows 10 路径。

## 验证命令

从仓库根目录执行：

```bash
node desktop_virtual_camera/tools/receive-luna-stream.mjs --self-test
node desktop_virtual_camera/tools/receive-luna-stream.mjs --port 4184
cargo test --manifest-path desktop_virtual_camera/Cargo.toml
pnpm exec tsc --noEmit
```

macOS 签名构建：

```bash
LUNA_DESKTOP_CAMERA_TEAM_ID=YOUR_TEAM_ID \
CODE_SIGN_IDENTITY='Apple Development' \
pnpm build:desktop-camera
```

## 代码纪律

- 不把电脑直连相机 Wi-Fi 作为正式虚拟摄像头输入。
- 不把音频塞进 Camera Extension；麦克风和摄像头是两个系统设备。
- 新增数据类型使用新的 stream type，保持 `0x20` 视频和 `0x21` 音频兼容。
- 不把 HEVC 解码放进 macOS Camera Extension；Windows 同样放在 Host 侧。
- 不改变 AOA 匹配字符串，除非手机端 `usb_accessory_filter.xml` 同步修改。
- 不把 Windows COM source 注册到 `HKCU`，必须使用 `HKLM`。
- 不把签名后的 `LunaCameraHost.app`、`target/`、`macos/.build/` 提交到 Git。
- 不把 `usb` 原生模块打进 Vite bundle；必须保持 external，并在 electron-builder 中 asar unpack。
