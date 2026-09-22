# Desktop Transport Protocol

本文定义 Luna 手机 App 与 Luna AI Cut USB 接收层之间的通用 UCD2 media frame。
当前使用五个 stream type：

```text
0x20  video  HEVC Annex-B access unit
0x21  audio  PCM16-LE
0x22  control  audio drift
0x30  request  desktop control command, UTF-8 JSON
0x31  result   desktop control result, UTF-8 JSON
```

未知 stream type 必须被接收端跳过但不能破坏后续帧。新增媒体能力时优先增加 stream
type，而不是修改外层 UCD2 帧头。

桌面端接收 Luna 咔手机 App 通过 USB AOA 输出的 Luna UCD2 媒体帧：

Android 使用 USB AOA Bulk IN/OUT；iOS 使用 App 内 TCP `4184`，电脑经 `iproxy` 映射本地
端口后连接。两种传输共享完全相同的 UCD2 字节格式，桌面端不得在解析层区分平台。

```text
0..3    55 43 44 32                 magic
4       01                          version
5       0c                          channel
6       01                          media type
7       sequence                    frame sequence
8..11   uint32 little-endian        payload length
12      stream type                 20 video / 21 audio / 22 drift / 30 command / 31 result
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

`audio source id` 当前使用：

```text
0x01  手机内置麦克风
0x02  手机侧外部输入设备
0x03  手机端混合后的音频
0x04  电脑侧麦克风或电脑外接麦克风
```

当前只支持 48 kHz 音频。非 48 kHz 数据在 Host 中做线性重采样，单声道自动复制为左右声道。

## Audio Drift Control

`stream type = 0x22`：

```text
0..3   int32 little-endian        声音漂移毫秒数
```

正值延迟声音，负值提前声音。Host 收到控制帧后会重建音频缓冲，并从下一帧音频开始应用新值。

## Desktop Control

`0x30` 从电脑通过 USB AOA Bulk OUT 发往手机，`0x31` 从手机返回电脑。payload 为 UTF-8
JSON，只承载云台、焦段、点击对焦、区域跟踪和曝光补偿等用户意图。PC 端不包含相机鉴权或
厂商协议字段，手机端负责复用 Luna 咔现有能力执行。坐标统一相对于无黑边的视频帧
`0..1`。`audio.listInputs` 和 `audio.selectInput` 用于把手机端可用的麦克风音源同步到
直播控制台，并切换正在发送给虚拟麦克风的声音来源。

`capabilities.get` 由桌面端在控制通道建立后调用，手机端返回云台、焦段、点击对焦、区域
跟踪、曝光和麦克风音源的能力、范围、档位与当前值。桌面端不得自行写死这些参数。

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
