# App USB AOA Stream Bridge

本文定义 Luna 咔手机 App 到 Luna AI Cut 桌面虚拟摄像头的正式通路。核心原则：
**电脑不连接相机 Wi-Fi。** 相机由手机连接，手机通过 USB AOA 把实时流送到电脑，
电脑保留自己的网络用于直播。

## 完整链路

```text
Luna 相机
  -> 手机 Wi-Fi / 相机连接
  -> Luna 咔实时预览帧（Annex-B HEVC access unit）
  -> UsbVideoOutputController
  -> UsbVideoOutputBridge
  -> Android AOA FileOutputStream
  -> USB Bulk IN endpoint
  -> luna-ai-cut UsbAoaReceiver
  -> UCD2 generic stream parser
  -> video 0x20 / audio 0x21
  -> TCP 127.0.0.1:4184
  -> LunaCameraHost
  -> VideoToolbox / Windows Media Foundation
  -> 系统虚拟摄像头
  -> PCM 音频写入 Luna Virtual Microphone
  -> 系统虚拟麦克风
  -> 直播软件继续使用电脑原网络推流
```

电脑不需要连接相机的 Wi-Fi，因此不会被相机网络占用，也不需要 OBS。

## 手机端职责

手机端项目为 `motionbridge_flutter`（Luna 咔），关键文件：

- `lib/features/settings/application/usb_video_output_controller.dart`
  - 订阅相机实时预览帧。
  - 调用 USB 输出的 `sendFrame()`。
- `lib/data/output/android_usb_video_output.dart`
  - Flutter MethodChannel 客户端。
- `android/app/src/main/kotlin/com/shuxinwu/motionbridge/UsbVideoOutputBridge.kt`
  - 打开 Android USB Accessory。
  - 把每个 HEVC access unit 封装为 UCD2 media frame。
  - 通过 accessory `FileOutputStream` 写入 USB Bulk 通道。
- `android/app/src/main/AndroidManifest.xml`
  - 声明 `android.hardware.usb.action.USB_ACCESSORY_ATTACHED`。
- `android/app/src/main/res/xml/usb_accessory_filter.xml`
  - 精确声明 AOA accessory 的匹配字段。

手机端用户流程：

1. 手机连接 Luna 相机。
2. 打开 USB 视频输出页面，授权 Android USB Accessory。
3. 用 USB 数据线连接手机和电脑。
4. 点击开始输出。

## AOA 切换和匹配字符串

电脑端 `UsbAoaReceiver` 使用 Android Open Accessory 协议切换设备。发送顺序：

```text
GET_PROTOCOL     bmRequestType=0xC0 bRequest=51
SEND_MANUFACTURER bmRequestType=0x40 bRequest=52 wIndex=0
SEND_MODEL        bmRequestType=0x40 bRequest=52 wIndex=1
SEND_DESCRIPTION  bmRequestType=0x40 bRequest=52 wIndex=2
SEND_VERSION      bmRequestType=0x40 bRequest=52 wIndex=3
SEND_URI          bmRequestType=0x40 bRequest=52 wIndex=4
SEND_SERIAL       bmRequestType=0x40 bRequest=52 wIndex=5
START             bmRequestType=0x40 bRequest=53
```

必须与手机端 `usb_accessory_filter.xml` 保持一致：

```xml
<usb-accessory
    manufacturer="LunaKa"
    model="Luna USB Video Demo"
    version="1.0"
    uri="https://motionbridge.local/usb-video"
    description="Luna USB video output" />
```

不要随意改这些字符串。电脑发送的 AOA 描述和手机过滤器不匹配时，Android 不会把
USB 设备交给 Luna 咔。

Accessory 模式下的 VID 默认为 `0x18d1`，PID 使用 AOA 的
`0x2d00/0x2d01/0x2d04/0x2d05/0x2d06/0x2d07`。

## 桌面接收端

关键文件：`../../electron/media/desktop-virtual-camera/usbAoaReceiver.ts`

职责：

1. 扫描 Android 手机或已经切换完成的 USB Accessory。
2. 发送 AOA 切换控制请求，等待设备重新枚举。
3. 找到 Bulk IN endpoint 并持续读取数据。
4. 对任意 USB 分包、粘包执行 UCD2 帧重组。
5. 按 stream type 解复用：视频和 PCM 音频都转发给 Local Host。

USB 接收器不负责解码 HEVC，不把 USB 数据穿过 React renderer，也不会尝试读取电脑
网卡或相机 Wi-Fi。

关键文件：`../../electron/media/desktop-virtual-camera/desktopVirtualCameraService.ts`

职责：

1. 安装/启动已签名的 `LunaCameraHost.app`。
2. 连接本机 Host 的 `127.0.0.1:4184`。
3. 把 `UsbAoaReceiver` 收到的 `0x20` 视频帧和 `0x21` 音频帧原样写入 Host。
4. 维护直播控制台状态、帧数、字节数和最后帧时间。

关键文件：`../../electron/ipc/ipcDesktopVirtualCameraService.ts`

Renderer 只通过以下稳定 IPC 操作：

```ts
window.luna.desktopVirtualCamera.status()
window.luna.desktopVirtualCamera.install()
window.luna.desktopVirtualCamera.start({ port: 4184 })
window.luna.desktopVirtualCamera.setAudioDelay(0)
window.luna.desktopVirtualCamera.stop()
window.luna.desktopVirtualCamera.openExtensionSettings()
window.luna.desktopVirtualCamera.revealInstallSource()
```

## UCD2 帧格式

手机端发送、电脑端接收的字节格式：

```text
offset  size  value / meaning
0       4     55 43 44 32              UCD2 magic
4       1     01                       version
5       1     0c                       channel
6       1     01                       media type
7       1     sequence                 uint8, wraps at 255
8       4     payloadLength            uint32 little-endian
12      1     20                       video stream type
13      8     timestamp                uint64 little-endian, microseconds
21      N     HEVC Annex-B access unit
末尾    4     reserved                 zero
```

`payloadLength = 9 + HEVC length`，整帧长度为 `12 + payloadLength + 4`。

音频 `0x21` 共用外层帧头，媒体 payload 增加 codec、source、采样率、声道和采样数；
控制帧 `0x22` 用来实时设置声音漂移。格式见 [`audio-pipeline.md`](audio-pipeline.md)。

接收端必须支持：

- 一次 USB read 包含多帧；
- 一帧跨多个 USB read；
- magic 前存在垃圾数据；
- sequence 回绕；
- 设备拔出后停止当前传输，重新插入后重新扫描。

## 接收验证

无依赖的参考接收器可以替代 Host 监听 4184，用来确认 App 的 USB 链路确实到达电脑：

```bash
node desktop_virtual_camera/tools/receive-luna-stream.mjs --port 4184
node desktop_virtual_camera/tools/receive-luna-stream.mjs --port 4184 --output /tmp/luna-preview.hevc
```

如果使用参考接收器，不要再启动占用 4184 的 `LunaCameraHost`。更简单的验证方式
是在直播控制台启动输出，然后观察：

```text
USB 状态：正在接收视频帧
已接收：持续增长
最后视频帧：持续更新
```

## Windows 要求

Electron 通过 npm `usb` 包访问 USB。项目已在 `pnpm-workspace.yaml` 允许
`usb` 构建脚本，并在 electron-builder 中设置 asar unpack。

Windows 首次部署还需要确认 AOA Accessory 能被 libusb 访问；如果系统没有合适的
WinUSB/libusb 驱动，需要安装 WinUSB 驱动或使用 USBdk。该部署项必须在 Windows 11
实体机验收，不能只依赖 macOS 测试结果。

Windows 的媒体源仍使用 `MFCreateVirtualCamera`；Electron 到 Windows Host 的 UCD2
TCP 格式不变。具体见 [`../windows/README.md`](../windows/README.md)。
