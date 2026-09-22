# Luna AI Cut 直播控制台集成

## 目标

直播控制台把手机经 USB AOA 转发的 Luna 相机实时流注册为 macOS 系统摄像头。
视频会议和直播软件直接选择 `Luna Virtual Camera` 即可使用，不需要 OBS，
也不需要额外配置媒体源地址。

电脑不连接相机 Wi-Fi。相机由手机连接，电脑网络保留给直播推流。

## 运行链路

```text
Luna 咔手机 App
  -> Annex-B HEVC access unit
  -> USB AOA / UCD2 media frame
  -> UsbAoaReceiver
  -> TCP 127.0.0.1:4184
  -> LunaCameraHost
  -> VideoToolbox
  -> App Group latest-bgra.frame
  -> LunaCameraExtension
  -> 系统摄像头
```

视频帧不经过 React IPC，也不写入磁盘。Electron 主进程从 USB Bulk 端点读取手机发来的
UCD2 包，保持原字节不变并转发给 Host。

## 代码边界

| 层 | 路径 | 职责 |
| --- | --- | --- |
| 页面 | `src/pages/LiveConsolePage.tsx` | 启动、停止、状态和授权指引 |
| 样式 | `src/styles/live-console.css` | 页面布局和状态展示 |
| 类型 | `src/shared/types/desktopVirtualCamera.ts` | renderer 与 main 的稳定契约 |
| IPC | `electron/ipc/ipcDesktopVirtualCameraService.ts` | 暴露状态、安装、启动、停止和打开设置 |
| USB AOA 接收 | `electron/media/desktop-virtual-camera/usbAoaReceiver.ts` | 扫描手机、切换 AOA、读取 Bulk、解析 UCD2 |
| 主进程服务 | `electron/media/desktop-virtual-camera/desktopVirtualCameraService.ts` | Host 生命周期、TCP 转发、状态检查 |
| native 源码 | `desktop_virtual_camera/` | Host、Camera Extension、Rust 核心和诊断工具 |

## 页面动作

- `status`：检查 Host 是否安装/运行、扩展是否启用、当前输出帧数。
- `install`：把已签名的 `LunaCameraHost.app` 安装到 `/Applications` 并启动一次。
- `start`：启动 Host 和 USB AOA 扫描；手机连接并输出后，把完整 UCD2 帧转发到 4184。
- `stop`：停止输出连接；保留 Host 进程和系统扩展注册，便于快速再次启动。
- `openExtensionSettings`：打开系统设置中的扩展管理页。

## 构建与打包

开发构建：

```bash
LUNA_DESKTOP_CAMERA_TEAM_ID=YOUR_TEAM_ID \
CODE_SIGN_IDENTITY='Apple Development' \
pnpm build:desktop-camera
```

生产打包前也必须先运行相同命令。`electron-builder` 会把下列目录整体复制到应用资源：

```text
resources/desktop-virtual-camera/LunaCameraHost.app
  -> Contents/Resources/desktop-virtual-camera/LunaCameraHost.app
```

要求：

- Apple Developer Team 同时拥有 Mac Development / Developer ID profile。
- Host App 和 Camera Extension 的 System Extension、App Group 权限有效。
- 对外发布使用 Developer ID、Hardened Runtime 和 notarization。
- 不要使用 `CODE_SIGNING_ALLOWED=NO` 的产物注册系统摄像头。

## 首次授权

1. 打开 Luna AI Cut 的“直播控制台”。
2. 如果 Host 未安装，点击“安装摄像头组件”。
3. 点击“打开系统设置”。
4. macOS 15 及以上：进入“通用 → 登录项与扩展 → 摄像头扩展”。
5. 启用 `Luna Virtual Camera Extension`。
6. 返回控制台刷新状态。
7. 如果状态仍为等待授权，重启 Luna AI Cut，必要时重新登录 macOS 用户或重启系统。

Host App 必须位于 `/Applications`，否则系统会拒绝加载 Camera Extension。

## USB 接收要求

- 手机端 `usb_accessory_filter.xml` 和电脑端 AOA 描述必须完全一致。
- Android 需要用户授予 USB Accessory 权限。
- npm `usb` 是原生模块，Vite 中必须保持 external，electron-builder 必须 asar unpack。
- macOS 上直接使用；Windows 还需要解决 AOA 设备的 WinUSB/libusb 或 USBdk 驱动部署。

## 兼容范围

- 当前仅支持 macOS 15 及以上。
- 当前手机端已实现 USB AOA 输出桥，桌面端接收完整 UCD2 帧。
- Windows 使用 Windows 11 `MFCreateVirtualCamera` 与软件 Media Source DLL，
  当前仅有实施方案，原生实现尚未完成。细节见
  [`../windows/README.md`](../windows/README.md)。

## 常见问题

### 扩展显示“未注册”

通常是 Host 尚未安装，或当前 Host 没有有效签名/正确 Bundle ID。重新运行
`pnpm build:desktop-camera`，安装 `/Applications/LunaCameraHost.app` 后重试。

### 扩展一直显示“等待系统授权”

按首次授权步骤启用扩展。状态刷新有延迟时，重启 Luna AI Cut。

### 启用后仍找不到摄像头

先确认 `systemextensionsctl list` 中 `com.diamondfsd.luna.virtualcamera.host.extension`
为 `activated enabled`。若已启用但仍不可用，退出并重新登录 macOS，或重启电脑。

### 直播控制台无法启动输出

确认手机已经连接相机并在 Luna 咔中开启 USB 视频输出。电脑端会先启动接收器，再等待
USB AOA 手机连接；系统扩展未启用时启动按钮会被阻止。

### USB 一直显示等待手机连接

检查 USB 数据线是否支持数据传输、Android 是否弹出并允许 USB Accessory 权限，以及
`LUNA_AOA_VENDOR_IDS` 是否需要补充当前手机厂商 VID。电脑端默认识别常见 Android
厂商，也可通过环境变量指定十六进制 VID 列表。

### USB 显示异常或 Access Denied

macOS 需要确认当前用户可访问 USB 设备。Windows 需要先配置 libusb/WinUSB 或 USBdk，
否则 npm `usb` 无法打开 AOA Accessory。
