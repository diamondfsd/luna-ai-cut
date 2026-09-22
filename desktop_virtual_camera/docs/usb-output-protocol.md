# Luna USB Output Protocol

本文是 Luna 咔手机 App 通过 USB AOA 输出音视频数据的桌面端实现规范。接手桌面端开发的
AI 应以本文为准，并参考当前发送实现：

- `motionbridge_flutter/android/app/src/main/kotlin/com/shuxinwu/motionbridge/UsbVideoOutputBridge.kt`
- `motionbridge_flutter/lib/features/settings/application/usb_video_output_controller.dart`
- `motionbridge_flutter/lib/data/output/record_usb_audio_input.dart`

桌面端参考接收器：

- `electron/media/desktop-virtual-camera/usbAoaReceiver.ts`
- `desktop_virtual_camera/tools/receive-luna-stream.mjs`

## 1. 目标和非目标

目标：

- 手机连接 Luna 相机，并把相机预览和手机侧选择的麦克风音频通过一根 USB 线送到电脑。
- 电脑保留自己的网络用于直播推流，不连接相机 Wi-Fi。
- 视频、音频和后续控制数据共用一个可扩展的 UCD2 帧协议。

非目标：

- USB 传输层不做混音。多路音频混音由手机端或桌面端在协议层之上实现。
- 当前不承诺同时采集手机麦克风和蓝牙耳机麦克风。Android/iOS 通常只有一个活动录音输入。
- 视频和音频不做编码复用；`0x20` 是 HEVC access unit，`0x21` 是 PCM 数据。

## 2. 端到端链路

```text
Luna 相机
  -> 手机 Luna 咔 App
  -> Android USB Accessory / AOA
  -> USB Bulk IN endpoint
  -> 电脑 UsbAoaReceiver
  -> UCD2 stream demux
      -> 0x20 video  -> 系统虚拟摄像头
      -> 0x21 audio  -> 虚拟麦克风 / 混音器
      -> 0x22 control -> 音画漂移控制
```

数据只从手机流向电脑。控制命令目前也只沿同一方向发送，例如音频漂移值。

## 3. Android AOA 握手

电脑端必须先让手机进入 Accessory 模式。

### 3.1 设备发现

已经处于 Accessory 模式时，VID/PID 为：

```text
VID        0x18D1
PID        0x2D00 / 0x2D01 / 0x2D04 / 0x2D05 / 0x2D06 / 0x2D07
```

普通 Android 设备需要先发送 AOA 控制请求。桌面端可以参考 `UsbAoaReceiver` 的实现。

### 3.2 控制请求

```text
GET_PROTOCOL        bmRequestType=0xC0  bRequest=51  wValue=0  wIndex=0  length=2
SEND_STRING[0]      bmRequestType=0x40  bRequest=52  wValue=0  wIndex=0
SEND_STRING[1]      bmRequestType=0x40  bRequest=52  wValue=0  wIndex=1
SEND_STRING[2]      bmRequestType=0x40  bRequest=52  wValue=0  wIndex=2
SEND_STRING[3]      bmRequestType=0x40  bRequest=52  wValue=0  wIndex=3
SEND_STRING[4]      bmRequestType=0x40  bRequest=52  wValue=0  wIndex=4
SEND_STRING[5]      bmRequestType=0x40  bRequest=52  wValue=0  wIndex=5
START               bmRequestType=0x40  bRequest=53  wValue=0  wIndex=0
```

字符串索引必须按以下顺序发送：

```text
0 manufacturer = LunaKa
1 model        = Luna USB Video Demo
2 description  = Luna USB Video output
3 version      = 1.0
4 uri          = https://motionbridge.local/usb-video
5 serial       = LunaKa
```

这些值必须与手机端
`android/app/src/main/res/xml/usb_accessory_filter.xml` 完全一致。修改任一项都会导致
Android 不再把设备交给 Luna 咔。

发送 `START` 后手机会重新枚举为 Accessory。电脑端应等待设备重新出现，再打开接口。

### 3.3 Bulk 端点

进入 Accessory 后：

1. 找到包含 Bulk endpoint 的接口。
2. claim 接口。
3. 打开 Bulk IN endpoint 持续读取。
4. 读取缓冲区建议使用 `16 KiB`。

手机端通过 `FileOutputStream` 写入 Accessory，桌面端从 Bulk IN 读取。

## 4. UCD2 通用帧

USB 上没有额外包长度协议；Bulk 数据本身是连续字节流，接收端必须自行搜索 magic 和重组
帧。所有整数均为 little-endian。

```text
offset  size  meaning
0       4     55 43 44 32              magic, ASCII "UCD2"
4       1     0x01                     protocol version
5       1     0x0C                     channel/flags
6       1     0x01                     media type
7       1     sequence                 0..255, wraps
8       4     payloadLength            uint32 LE
12      N     media payload
12+N    4     reserved trailer, zeros
```

约束：

```text
N = payloadLength
totalFrameLength = 12 + payloadLength + 4
payloadLength >= 9
payloadLength must match the number of bytes between offset 12 and the trailer
```

当前接收端把单帧上限设为 `32 MiB`。超过上限时，接收端应丢弃并以 1 字节步进重新搜索
magic，避免死循环。

`sequence` 对整个 USB 输出通道统一递增，不区分 stream type，因此视频和音频共享同一个
序列号空间，回绕到 0 后继续发送。

## 5. 通用媒体载荷

`media payload` 的前 9 字节统一定义为：

```text
offset  size  meaning
0       1     streamType
1       8     timestamp, uint64 LE, Unix epoch microseconds
9       M     stream-specific body
```

当前定义：

```text
0x20  video    HEVC/H.265 Annex-B access unit
0x21  audio    PCM16-LE
0x22  control  audio drift compensation
```

未知 `streamType` 必须被完整跳过，不能断开连接，也不能阻塞后续帧。这样后续可以增加字幕、
元数据、设备控制等 stream type。

## 6. Video Stream 0x20

```text
media payload
offset  size  meaning
0       1     0x20
1..8    8     timestamp, uint64 LE
9..     M     HEVC Annex-B access unit
```

规则：

- 一个 `0x20` 包承载一个完整 HEVC access unit。
- HEVC 数据保留 Annex-B 起始码，通常为 `00 00 00 01` 或 `00 00 01`。
- 视频包在 USB 写入和读取过程中可能被拆分或合并；外层 UCD2 length 才是帧边界。
- 桌面端必须按 `payloadLength` 收齐完整帧后才能解码。
- 解码端按外层的 `timestamp` 维护 A/V 同步；不能依赖 USB read 的时间作为视频时间。

接收端实现建议：

```text
0x20 -> HEVC decoder -> latest-frame queue -> virtual camera
```

虚拟摄像头应只保留最新完整帧，避免直播延迟持续增长。

## 7. Audio Stream 0x21

### 7.1 音频载荷

在通用媒体头之后，音频 body 为：

```text
body offset  size  meaning
0            1     codec, 0x01 = signed PCM16 little-endian
1            1     source
2..5         4     sampleRate, uint32 LE
6            1     channels
7            1     reserved, zero
8..11        4     sampleCount per channel, uint32 LE
12..         N     interleaved PCM16-LE samples
```

因此完整 `payloadLength` 为：

```text
9 + 12 + sampleCount * channels * 2
```

当前手机端发送：

```text
codec       0x01
sampleRate  48000
channels    1
source      0x01 或 0x02
PCM         mono interleaved PCM16-LE
```

### 7.2 source 字段

```text
0x01  手机内置麦克风
0x02  外部输入设备，例如支持 HFP/SCO 的蓝牙耳机
0x03  手机端已经混合后的音频
```

未来如果手机端能够并发采集两路音频，同一时间可能收到多个 `0x21` 包，分别带不同的
`source`。桌面端解析和缓存应按 `source` 分开，而不是只保留最后一路。

当前产品行为：

- 手机端每次只启动一个输入设备。
- 用户可在手机端选择手机麦克风、外部输入设备或关闭麦克风。
- 蓝牙耳机只有在支持麦克风并建立 SCO/通话输入时才可作为 source `0x02`。
- 蓝牙耳机通常不支持同时采集手机麦克风和耳机麦克风。

### 7.3 时间戳和重采样

- `timestamp` 代表该音频块首个采样的时间，单位微秒。
- 桌面端不能假设所有设备都输出 48 kHz；必须按 `sampleRate` 和 `channels` 处理。
- 推荐统一重采样为 `48 kHz / stereo / PCM16-LE` 后送入虚拟麦克风或混音器。
- 单声道输入应复制到左右声道，除非后续实现真正的多声道混音。
- 音频队列应有上限；优先保持低延迟，不要无限缓存。

### 7.4 建议的音频处理

```text
0x21 -> validate header -> per-source bounded jitter queue
     -> resample to 48 kHz stereo PCM16
     -> optional multi-source mix
     -> virtual microphone
```

推荐抖动缓冲为 `60-120 ms`。多路混音前先统一格式和帧对齐，混音后做轻量限幅，避免叠加
削波。

## 8. Control Stream 0x22

当前用于声音相对画面的漂移补偿。

```text
media payload
offset  size  meaning
0       1     0x22
1..8    8     timestamp, uint64 LE
9..12   4     delayMs, int32 LE
```

范围当前为 `-10000..10000 ms`：

- 正值：延迟声音。
- 负值：提前声音。
- `0`：不补偿。

桌面端收到后应立即应用并重置音频缓冲；不要把该控制帧当作音频播放数据。

## 9. 接收端必须满足的行为

### 9.1 流重组

- 不能假设一次 read 正好对应一帧。
- 必须支持一个 read 中包含多帧。
- 必须支持一帧跨多个 read。
- 必须容忍 magic 前的垃圾字节。
- 发现非法长度时应丢弃最前面的 magic 并继续搜索。
- 设备拔出后清空 pending buffer。

### 9.2 分类型处理

```text
0x20  video   解码并输出到系统虚拟摄像头
0x21  audio   解析 PCM，重采样并输出到虚拟麦克风或混音器
0x22  control 更新音频漂移，不进入媒体队列
other         安全跳过
```

### 9.3 队列和背压

- 视频使用 latest-frame 语义，旧帧可以丢弃。
- 音频必须有界缓存，避免内存持续增长。
- 建议分批读取 Bulk；不要在主线程做重采样或混音。
- 接收端统计应按视频和音频分别计数，便于区分“USB 已连接但只有视频”和“音频格式异常”。

### 9.4 推荐状态字段

桌面端状态至少应包含：

```text
usbConnected
videoFrames / videoBytes / lastVideoFrameAt
audioFrames / audioBytes / lastAudioFrameAt
audioSource / audioSampleRate / audioChannels
decodeError / audioFormatError
```

## 10. 解析伪代码

```ts
while (pending.length >= 12) {
  const magicAt = pending.indexOf(MAGIC)
  if (magicAt < 0) return pending.slice(-3)
  if (magicAt > 0) pending = pending.subarray(magicAt)

  const payloadLength = pending.readUInt32LE(8)
  const totalLength = 12 + payloadLength + 4
  if (payloadLength < 9 || totalLength > MAX_FRAME_BYTES) {
    pending = pending.subarray(4)
    continue
  }
  if (pending.length < totalLength) return pending

  const payload = pending.subarray(12, 12 + payloadLength)
  const streamType = payload[0]
  const timestampUs = payload.readBigUInt64LE(1)
  const body = payload.subarray(9)

  switch (streamType) {
    case 0x20:
      enqueueVideo(body, timestampUs)
      break
    case 0x21:
      enqueueAudio(body, timestampUs)
      break
    case 0x22:
      applyAudioDelay(body)
      break
    default:
      break
  }

  pending = pending.subarray(totalLength)
}
```

## 11. 测试数据

### 11.1 视频帧

假设 HEVC access unit 为：

```text
00 00 00 01 40 01 AA
```

则：

```text
payloadLength = 9 + 7 = 16
totalLength   = 12 + 16 + 4 = 32
streamType    = 0x20
```

### 11.2 音频帧

假设 mono 48 kHz，4 个采样点：

```text
PCM bytes = 4 * 1 * 2 = 8
audio body = 12 + 8 = 20
payloadLength = 9 + 20 = 29
totalLength = 12 + 29 + 4 = 45
streamType = 0x21
codec = 0x01
source = 0x01
sampleRate = 48000
channels = 1
sampleCount = 4
```

## 12. 本地验证工具

USB AOA 收到的音视频也可以经本机 TCP 4184 转发给 Host。协议相同。

解析器自检：

```bash
node desktop_virtual_camera/tools/receive-luna-stream.mjs --self-test
```

接收并导出：

```bash
node desktop_virtual_camera/tools/receive-luna-stream.mjs \
  --port 4184 \
  --output /tmp/luna-video.hevc \
  --audio-output /tmp/luna-audio.pcm
```

输出：

- `/tmp/luna-video.hevc`：HEVC Annex-B access unit 连续流。
- `/tmp/luna-audio.pcm`：PCM16-LE 裸流，当前为 48 kHz mono。

## 13. 桌面端验收清单

1. 能从普通 Android 设备发起 AOA 握手并等待重新枚举。
2. 能打开 Accessory 的 Bulk IN endpoint 并持续读取。
3. 能处理分包、粘包、垃圾数据和 sequence 回绕。
4. 能将 `0x20` 解码并输出到系统虚拟摄像头。
5. 能解析 `0x21` 的 PCM 头并输出到虚拟麦克风或混音器。
6. 能解析 `0x22` 并立即应用音画漂移。
7. 未知 stream type 不影响后续帧。
8. 设备拔出后释放接口；重新插入后能重新连接。
9. 状态页分别显示视频帧、音频帧、音频采样率和声道。
10. 在上面的基础上，再接入系统虚拟摄像头和虚拟麦克风。

## 14. 已知限制和演进

- 当前手机端只采集一路音频。
- 蓝牙耳机麦克风通常走 HFP/SCO，采样率较低且为单声道。
- 手机麦克风和蓝牙耳机麦克风同时采集不是通用 Android/iOS 能力，必须做机型实测。
- 多路音频并发时，使用同一个 `0x21` stream type 和多组 `source` 值，桌面端按 source
  分别缓冲和混音。
- 新增字幕、设备状态或控制能力时增加新的 stream type，不改变 UCD2 外层结构。
- 音频 codec 字段可扩展 Opus/AAC；新 codec 必须先定义 codec id、码率、帧长和 timestamp
  规则，再让接收端切换解析器。
