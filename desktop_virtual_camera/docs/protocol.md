# Desktop Transport Protocol

桌面端接收 Luna 咔手机 App 通过 USB AOA 输出的 Luna UCD2 媒体帧：

```text
0..3    55 43 44 32                 magic
4       01                          version
5       0c                          channel
6       01                          media type
7       sequence                    frame sequence
8..11   uint32 little-endian        payload length
12      20                          video stream type
13..20  uint64 little-endian        timestamp
21..    HEVC/H.265 Annex-B payload
end-4   reserved                    media trailer
```

解析器必须支持 USB Bulk 读取产生的任意分包和粘包，不能假设一次 read 就对应一帧。

当前生产者是手机端：

- `motionbridge_flutter/lib/features/settings/application/usb_video_output_controller.dart`
- `motionbridge_flutter/android/app/src/main/kotlin/com/shuxinwu/motionbridge/UsbVideoOutputBridge.kt`

桌面接收端是：

- `../../electron/media/desktop-virtual-camera/usbAoaReceiver.ts`
- `../../electron/media/desktop-virtual-camera/desktopVirtualCameraService.ts`

App 与平台层的完整接线见 [`app-stream-bridge.md`](app-stream-bridge.md)。

可用参考接收器替代 Host 监听本机 4184，验证 USB AOA 到达电脑的帧：

```bash
node desktop_virtual_camera/tools/receive-luna-stream.mjs --self-test
node desktop_virtual_camera/tools/receive-luna-stream.mjs --port 4184
```
