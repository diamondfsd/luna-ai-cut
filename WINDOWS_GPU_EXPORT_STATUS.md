# Windows GPU 导出状态

## 当前结论

Windows 严格 GPU 导出测试已经在 `NVIDIA RTX 5880 Ada-8Q` 上通过。

当前已验证链路：

```text
Media Foundation 硬件解码
  -> 失败时 FFmpeg D3D11VA 硬件解码
  -> D3D11VA 帧下载并转换为 RGBA
  -> RGBA 上传到 WGPU
  -> WGPU / D3D12 合成到共享 BGRA 纹理
  -> 同一显卡的原生 D3D11 设备打开共享纹理
  -> D3D11 VideoProcessor：BGRA -> NV12
  -> NVIDIA NVENC：NV12 -> H.264 Annex B
  -> FFmpeg.exe：封装 MP4/MOV，并在需要时混入音频
```

该路径不使用 D3D12 Video Encode，也不通过 FFmpeg 的 `h264_nvenc` 编码。NVENC 由 Rust 直接动态加载 `nvEncodeAPI64.dll`，FFmpeg 只负责容器封装和音频处理。

## 验证结果

测试输入：

```text
C:\Users\admin\Downloads\VID_20260830_202350_532.mp4
```

测试输出：

```text
C:\Users\admin\luna-ai-cut\test-output\windows-gpu-export-nvenc.mp4
```

严格测试参数包含 `--require-gpu`，不会退回软件编码。结果：

```text
codec: h264
resolution: 3840x2160
pixel format: yuv420p
frames: 30
duration: 1.001 seconds
file size: 6,079,032 bytes
```

首帧已抽取检查，画面有效，没有白帧、空帧或明显的 RGBA/BGRA 通道错误。

关键日志：

```text
encoder backend=nvenc-directx api=13.0 codec=h264
input=BGRA-via-D3D11-video-process
encoder-manager selected backend=nvenc codec=h264
ffmpeg=container-packaging format=h264 pixel_transport=GPU
windows-gpu-export-test OK
```

## D3D11VA 解码兼容路径

测试源是 4K HEVC Main 10。当前 Windows 环境未安装可供 Media Foundation 使用的 HEVC 解码器，初始化返回 `0xC00D5212`。现在 Media Foundation 失败后会优先启动持久 FFmpeg D3D11VA 解码管道；如果 D3D11VA 启动或读取失败，再从当前时间点切换到 FFmpeg 软件解码。

本次 10 秒严格 GPU 导出日志确认使用了 D3D11VA，没有触发软件解码兜底：

```text
decoder=ffmpeg-d3d11va codec=hevc source_format=yuv420p10le download_format=p010le
encoder backend=nvenc-directx api=13.0 codec=h264 input=BGRA-via-D3D11-video-process
backend=vendor-gpu frames=298 total_ms=24562
```

输出检查结果：

```text
codec: h264
resolution: 3840x2160
pixel format: yuv420p
frames: 298
duration: 9.943267 seconds
file size: 61,904,989 bytes
```

第 5 秒画面已抽取检查，没有发现空帧、损坏或颜色通道错误。

这一版不是零拷贝解码。当前随应用分发的是独立静态 `ffmpeg.exe`，Rust 进程无法直接取得 FFmpeg 内部的 `ID3D11Texture2D`，所以仍需执行 `D3D11VA -> P010/NV12 -> RGBA -> CPU 管道 -> WGPU 上传`。单独解码基准从软件解码的约 `13.42s` 降到约 `4.88s`，但完整导出由 4K RGBA 搬运、WGPU 合成及同步共同限制，本次完整链路为 `24.56s`，未优于此前约 `22.8s` 的真实导出结果。

这只影响源视频解码阶段。WGPU 合成、BGRA 到 NV12 转换和 H.264 编码仍走 GPU；严格模式只禁止软件编码，D3D11VA 不可用时的软件解码仍是兼容兜底。

## 后端范围

当前编码后端优先级为：

```text
NVENC -> AMF -> QSV/oneVPL -> FFmpeg 软件兜底
```

- NVENC H.264：已实现并在真实 4K 输入上验证。
- NVENC HEVC/P010：接口已预留，尚未实现。
- AMD AMF：后端位置已预留，尚未实现。
- Intel QSV/oneVPL：后端位置已预留，尚未实现。
- FFmpeg 软件编码：仅用于应用非严格模式的兼容兜底。

## 测试命令

```powershell
& 'C:\Users\admin\.cargo\bin\cargo.exe' build --bin windows-gpu-export-test

& 'C:\Users\admin\luna-ai-cut\luna-render-core\target\debug\windows-gpu-export-test.exe' `
  --seconds 10 `
  --require-gpu `
  --output 'C:\Users\admin\luna-ai-cut\test-output\windows-gpu-export-d3d11va.mp4' `
  --log 'C:\Users\admin\luna-ai-cut\test-output\windows-gpu-export-d3d11va.log'
```

测试程序直接运行时出现的 `Load Node-API ... GetProcAddress failed` 来自没有 Electron/Node 宿主的独立 Rust 二进制，不影响 GPU 导出结果。
