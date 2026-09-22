# Windows Virtual Camera

Windows 版本目标为 Windows 11 build `10.0.22000` 及以上，使用 Microsoft
Media Foundation 的 virtual camera API，不依赖 OBS，也不安装内核驱动。

正式输入必须来自手机 USB AOA。Windows 电脑不连接相机 Wi-Fi，原有网络继续用于直播。

开始实现前先阅读 [`../AGENTS.md`](../AGENTS.md) 和
[`../docs/app-stream-bridge.md`](../docs/app-stream-bridge.md)。当前 App 已经按照该
协议发送 HEVC access unit，Windows Host 不应另起一套输入协议。

当前 App 的实际接收者是
`../../electron/media/desktop-virtual-camera/usbAoaReceiver.ts`。它从手机 USB AOA
Bulk 端点读取完整 UCD2 帧，再由 `desktopVirtualCameraService.ts` 原样转发到本机 TCP
4184。Windows Host 只需要实现该端口的接收和系统摄像头侧提交。

## 为什么不能复用 macOS 结构

Windows 没有 CoreMediaIO Camera Extension。Windows 11 的正式接口是
`MFCreateVirtualCamera` / `IMFVirtualCamera`，应用需要提供并注册一个
Media Foundation software camera source。

Frame Server 会在自己的服务进程中加载该 source，因此摄像头源不能直接运行在
Electron 渲染进程或普通 Node.js 上下文中。

## 最小组件

```text
LunaVirtualCameraSource.dll
  实现 IMFMediaSource / IMFMediaStream / IMFActivate
  从命名共享内存读取最新 BGRA 帧
  注册到 HKLM\Software\Classes\CLSID\{Luna CLSID}

LunaVirtualCameraHost.exe
  调用 MFCreateVirtualCamera 创建会话级虚拟摄像头
  调用 IMFVirtualCamera::Start
  监听 UCD2 TCP 4184，接收 Electron 从 USB AOA 转发的 HEVC access unit
  调用 FFmpeg 解码为 BGRA
  将最新帧写入命名共享内存
```

建议的帧共享格式：

```text
magic       4 bytes   LUNA
version     4 bytes   uint32
sequence    8 bytes   uint64
timestamp   8 bytes   uint64, microseconds
width       4 bytes   uint32
height      4 bytes   uint32
stride      4 bytes   uint32
pixelFormat 4 bytes   uint32, BGRA = 1
payloadSize 4 bytes   uint32
reserved    4 bytes
payload     width * height * 4 bytes
```

共享内存只保留最新帧，Media Source 在 `RequestSample` 时复制当前帧并转换为
NV12 或 RGB32。不能把摄像头帧通过 Electron IPC 发送给 Frame Server。

## 与 Electron 的边界

Luna AI Cut 主进程继续复用现有桌面虚拟摄像头服务：

```text
Android 手机 / Luna 咔
  -> USB AOA / UCD2 media frame
  -> Electron UsbAoaReceiver
  -> TCP 127.0.0.1:4184
  -> LunaVirtualCameraHost.exe
  -> shared memory
  -> LunaVirtualCameraSource.dll
  -> system camera
```

macOS 与 Windows 在 Electron 侧使用同一套状态模型，但安装和原生 helper 不同。

当前 Electron 服务仍在 `desktopVirtualCameraService.ts` 里显式判断
`process.platform !== 'darwin'`。Windows 实现完成后，需要把该分支替换为平台
策略：macOS 启动 `LunaCameraHost.app`，Windows 启动 `LunaVirtualCameraHost.exe`。
两种平台都复用 `UsbAoaReceiver` 和相同的 UCD2 转发格式。

Windows 还必须先解决 USB AOA 设备访问。npm `usb` 基于 libusb；如果 Accessory 没有
被 WinUSB 绑定，需要安装合适的 WinUSB/libusb 驱动，用户态可使用 `usb.useUsbDkBackend()`
配合 USBdk。该驱动部署属于 Windows 发布验收的一部分。

在接 Windows source 前，先用参考接收器确认 App 帧通路：

```bash
node desktop_virtual_camera/tools/receive-luna-stream.mjs --port 4184
```

## 安装流程

1. 应用把 `LunaVirtualCameraSource.dll` 和 `LunaVirtualCameraHost.exe` 放到
   `%ProgramData%\Luna AI Cut\VirtualCamera\`，确保 Frame Server 的
   Local Service / Local System 进程可以读取。
2. 通过 UAC 管理员权限执行 `regsvr32 /s LunaVirtualCameraSource.dll`。
3. 启动 `LunaVirtualCameraHost.exe`，创建并启动虚拟摄像头。
4. 退出直播输出时调用 `IMFVirtualCamera::Remove()`，避免留下失效实例。

COM source 必须注册到 `HKEY_LOCAL_MACHINE`。`HKCU` 注册不会被 Frame Server 发现。

## 构建要求

- Windows 11，版本 `10.0.22000` 或更高
- Visual Studio 2022，Desktop development with C++
- Windows SDK `10.0.22621` 或更高
- NuGet：Microsoft.Windows.ImplementationLibrary、Microsoft.Windows.CppWinRT
- FFmpeg 运行时由 Luna AI Cut 现有 `resources/ffmpeg` 提供

参考实现：

- [Microsoft Windows-Camera VirtualCamera sample](https://github.com/microsoft/Windows-Camera/tree/master/Samples/VirtualCamera)
- [VCamSample](https://github.com/smourier/VCamSample)

`VCamSample` 为 MIT License。该项目的合成帧生成部分需要替换为 Luna 共享内存帧，
不能直接作为最终产品使用。

## 验收

```powershell
Get-PnpDevice -Class Camera | Format-Table FriendlyName, Status, InstanceId
```

应出现 `Luna Virtual Camera`。再使用 Windows 相机、浏览器 `ImageCapture` 或
任意视频会议软件验证画面。

最低验收项：

- source DLL 能被 Frame Server 加载，无 Access Denied。
- Host 启动后系统摄像头列表出现设备。
- Host 停止后虚拟摄像头实例被移除。
- 应用卸载时注销 COM source 并清理 ProgramData 文件。
- 1080p/720p、30 FPS 下只保留最新帧，延迟不会持续增长。

## 当前状态

Windows 尚未实现。该目录目前是经过 API 和官方示例核验后的实施方案；不得把
Windows 标记为可用，直到原生 source DLL、Host、安装器和 Windows 11 实体机验收
全部完成。
