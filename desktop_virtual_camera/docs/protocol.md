# Desktop Transport Protocol

> 完整实现规范见 [`usb-output-protocol.md`](usb-output-protocol.md)。本文保留快速字段
> 速查，桌面端 AI 应以完整规范为准。

本文定义 Luna 手机 App 与 Luna AI Cut USB 接收层之间的通用 UCD2 media frame。
当前使用三个 stream type：

```text
0x20  video  HEVC Annex-B access unit
0x21  audio  PCM16-LE
0x22  control  audio drift
```

未知 stream type 必须被接收端跳过但不能破坏后续帧。新增媒体能力时优先增加 stream
type，而不是修改外层 UCD2 帧头。

桌面端接收 Luna 咔手机 App 通过 USB AOA 输出的 Luna UCD2 媒体帧：

```text
0..3    55 43 44 32                 magic
4       01                          version
5       0c                          channel
6       01                          media type
7       sequence                    frame sequence
8..11   uint32 little-endian        payload length
12      stream type                 20 video / 21 PCM audio / 22 control
13..20  uint64 little-endian        timestamp
21..    stream payload
end-4   reserved                    media trailer
```

## Video Payload

`stream type = 0x20`，payload 为 HEVC/H.265 Annex-B access unit。

## Audio Payload

`stream type = 0x21`：

```text
0      01                          PCM signed 16-bit little-endian
1      audio source id
2..5   uint32 little-endian        sample rate
6      channel count
7      reserved
8..11  uint32 little-endian        sample count
12..   interleaved PCM samples
```

当前只支持 48 kHz 音频。非 48 kHz 数据在 Host 中做线性重采样，单声道自动复制为左右声道。

## Audio Drift Control

`stream type = 0x22`：

```text
0..3   int32 little-endian        声音漂移毫秒数
```

正值延迟声音，负值提前声音。Host 收到控制帧后会重建音频缓冲，并从下一帧音频开始应用新值。

解析器必须支持 USB Bulk 读取产生的任意分包和粘包，不能假设一次 read 就对应一帧。
音频采集设计见 [`audio-pipeline.md`](audio-pipeline.md)。

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
