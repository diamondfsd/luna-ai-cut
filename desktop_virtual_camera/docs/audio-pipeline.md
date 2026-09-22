# USB Audio Pipeline

## 目标

直播推流不仅要把相机画面发送到电脑，还要把手机侧选择的麦克风音频通过同一条 USB AOA
链路送到电脑，后续供虚拟麦克风或混音器使用。

电脑不连接相机 Wi-Fi；相机、手机和电脑的连接关系保持不变：

```text
相机 -> 手机 Luna 咔 -> USB AOA -> Luna AI Cut -> 虚拟摄像头 + 虚拟麦克风
```

## 当前实现

已完成：

- 手机端可选择“手机麦克风”“外部输入设备”或“关闭麦克风”。
- 手机端以 PCM16-LE、48 kHz、单声道采集。
- 手机端通过通用媒体包发送音频，不新增 USB endpoint。
- 桌面端解析音频包，统计帧数、字节数、采样率和声道数。
- 视频继续走原有 HEVC `0x20` 流，音频走 `0x21` 流。
- 桌面 Host 将 PCM 音频写入 `Luna Virtual Microphone`。
- 直播控制台可设置 `-10000..10000 ms` 的声音漂移。
- 参考接收器 `receive-luna-stream.mjs` 可导出 PCM 验证。

尚未完成：

- 手机麦克风和外部麦克风同时采集。
- 多路音频混音。
- 自动估算音视频偏移；当前使用手动漂移值校准。

## 手机端采集

页面入口：相机控制页右侧“直播推流”。

可选音源：

- `none`：不采集音频。
- `phone-microphone`：手机内置麦克风。
- 外部设备：`record` 返回的输入设备 ID，例如 USB / 蓝牙 SCO 设备。

实现位置：

- `lib/domain/output/usb_audio_input.dart`
- `lib/data/output/record_usb_audio_input.dart`
- `lib/features/settings/application/usb_video_output_controller.dart`

### 蓝牙耳机说明

普通 Android/iOS 应用通常只能有一个活动录音输入。支持麦克风的蓝牙耳机接入后，系统通常
会把输入路由切到 HFP/SCO。此时应选择耳机输入，而不是期望手机麦克风和耳机麦克风同时
录音。HFP/SCO 通常是低采样率单声道，不能按高保真音乐录音评估。

如果平台和具体机型允许并发采集，可以扩展为两路 `0x21` 音频包，用 `source` 字段区分：

```text
1 = 手机麦克风
2 = 外部/蓝牙设备
3 = 手机侧已混合
```

但并发采集必须做机型白名单实测，不能作为通用能力。

## USB 音频包

外层仍复用 UCD2 media frame，媒体 payload 的 stream type 改为 `0x21`。

```text
UCD2 media payload
offset  size  meaning
0       1     0x21                         audio stream type
1       8     timestamp                    uint64 LE, microseconds
9       1     codec                        1 = PCM16 little-endian
10      1     source                       1 phone / 2 external / 3 mixed
11      4     sampleRate                   uint32 LE, e.g. 48000
15      1     channels                     1 = mono
16      1     reserved
17      4     sampleCount                  uint32 LE, per channel
21      N     PCM16-LE samples
```

外层帧头、长度和 sequence 与视频完全相同，见 [`protocol.md`](protocol.md)。

音频包头放 `source` 是为了后续扩展：即使当前系统只允许单路采集，桌面端也不需要改动
USB 协议即可识别未来多输入源。

## 桌面接收和解复用

`electron/media/desktop-virtual-camera/usbAoaReceiver.ts` 负责：

1. 解析所有 UCD2 media stream。
2. `0x20` 视频原样转发给本机 TCP 4184 和虚拟摄像头 Host。
3. `0x21` 音频原样转发给本机 `LunaCameraHost`，同时更新统计。
4. 未知 stream type 不导致连接断开，方便后续协议扩展。

Camera Host 解析 PCM16-LE，把音频重采样到 48 kHz 后写入隐藏的
`Luna Virtual Microphone Sink`。Core Audio HAL 驱动在同一进程内把数据送到可见的
`Luna Virtual Microphone` 输入设备。

参考验证：

```bash
node desktop_virtual_camera/tools/receive-luna-stream.mjs \
  --port 4184 \
  --output /tmp/luna-video.hevc \
  --audio-output /tmp/luna-audio.pcm
```

`luna-audio.pcm` 为 48 kHz、单声道、PCM16-LE 裸流。

## 虚拟麦克风

系统摄像头和系统麦克风是两套完全不同的原生能力。

### macOS

使用 Core Audio AudioServerPlugIn / HAL plugin 实现 `Luna Virtual Microphone`。
Camera Extension 不替代麦克风设备。驱动随 `LunaCameraHost.app` 一起构建，并由直播控制台
通过一次管理员授权安装到 `/Library/Audio/Plug-Ins/HAL`。

驱动发布两个设备：

- `Luna Virtual Microphone`：可见、仅输入，供 OBS、Zoom、Teams 选择。
- `Luna Virtual Microphone Sink`：隐藏、仅输出，只供 Camera Host 写入 PCM。

## 音画同步

USB 音频和视频分别到达，系统摄像头扩展只发布最新 BGRA 画面，因此不能用绝对时间戳保证
严格同步。当前方案先提供手动声音漂移补偿：

- `0 ms`：不补偿。
- 正值：延迟声音。
- 负值：提前声音。

Host 通过 `0x22` 控制帧接收新值。调整时会重置音频缓冲，避免保留旧的缓冲深度。

### Windows

需要实现用户态虚拟音频设备，通常涉及 AVStream / PortCls 或已有虚拟音频驱动框架。
Media Foundation Virtual Camera 只负责视频，不能提供麦克风。

Windows 也可以先使用 VB-CABLE 等虚拟音频设备完成联调，再评估自研驱动。

## 后续混音方案

推荐把混音放在桌面端，而不是强制手机端同时采集：

```text
source 1 PCM ----\
                  -> resample / align -> software mix -> virtual microphone
source 2 PCM ----/
```

桌面端混音步骤：

1. 按 `source` 分流。
2. 把所有输入重采样到统一格式，建议 48 kHz / mono / PCM16。
3. 使用小缓冲按时间戳对齐，目标端到端延迟 60-120 ms。
4. 做轻量限幅或自动增益，避免两路叠加削波。
5. 输出到虚拟麦克风设备。

如果目标机型不支持并发采集，备选方案是手机端硬件混音，或只选择一路输入。

## 扩展约束

- 新数据类型增加新的 stream type，不改变 UCD2 外层帧头。
- 视频 `0x20` 行为保持不变。
- 音频 `0x21` 的 codec 字段可扩展 Opus、AAC，但必须先协商或从 codec 字段判断。
- 控制、状态和元数据建议使用独立 stream type，不与音视频 payload 混用。
- 音视频时间戳都使用 Unix epoch 微秒；未来可在桌面端做相位校正。
- USB 接收端必须继续容忍未知 stream type。
