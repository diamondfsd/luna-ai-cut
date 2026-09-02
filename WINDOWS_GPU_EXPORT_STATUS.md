# Windows GPU 导出状态

## 当前结论

Windows 严格 GPU 导出测试已经在 `NVIDIA RTX 5880 Ada-8Q` 上通过。

当前已验证链路：

```text
进程内 FFmpeg/libavcodec D3D11VA 硬件解码
  -> D3D11 VideoProcessor：P010/NV12 -> 共享 BGRA 纹理
  -> D3D11/D3D12 共享 fence 同步
  -> WGPU / D3D12 合成到共享 BGRA 纹理
  -> 同一显卡的原生 D3D11 设备打开共享纹理
  -> D3D11 VideoProcessor：BGRA -> NV12
  -> NVIDIA NVENC：NV12 -> H.264 Annex B
  -> FFmpeg.exe：封装 MP4/MOV，并在需要时混入音频
```

该路径没有 CPU 像素下载或上传。由于当前驱动不能直接共享 FFmpeg 解码器返回的 P010 texture array，解码帧会先在 GPU 内通过一次 D3D11 VideoProcessor 转换到可共享 BGRA 纹理。它不是“直接共享原始解码纹理”，但视频像素始终留在 GPU。

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

## 进程内 D3D11VA 解码

测试源是 4K HEVC Main 10。Windows 导出不再初始化或尝试 Media Foundation，直接在 Rust 进程内通过 FFmpeg/libavcodec 启动 D3D11VA 解码，并把共享 BGRA 资源交给 WGPU。Media Foundation 仍只用于现有 Windows 原生预览，不参与导出。

本次 10 秒严格 GPU 导出日志确认使用了 D3D11VA，没有触发软件解码兜底：

```text
decoder=ffmpeg-in-process-d3d11va transport=D3D11-shared-to-D3D12
media-foundation-device=disabled
encoder backend=nvenc-directx api=13.0 codec=h264 input=BGRA-via-D3D11-video-process
backend=vendor-gpu frames=298 total_ms=16184
```

输出检查结果：

```text
codec: h264
resolution: 3840x2160
pixel format: yuv420p
frames: 298
duration: 9.943267 seconds
file size: 61,469,658 bytes
```

第 5 秒画面已抽取检查，没有发现空帧、损坏或颜色通道错误。

此前 FFmpeg D3D11VA 子进程方案需要执行 `D3D11VA -> P010 -> CPU RGBA -> WGPU 上传`，同一段素材耗时 `24.562s`。进程内共享纹理方案首次验证为 `17.478s`，跳过 Media Foundation 后本轮为 `16.184s`。相对旧子进程方案本轮缩短约 34%，也快于此前约 `22.8s` 的真实导出结果。单轮间存在 GPU 和缓存波动，不能把约 1.2 秒差值全部视为跳过 Media Foundation 的固定收益；主要收益是移除了兼容性差且必然失败的启动分支。

双向共享 fence 保证 D3D11 写完后 WGPU 才采样、WGPU 用完后 D3D11 才复用纹理。FFmpeg 返回的物理 HEVC texture 高度是 2176，但有效帧高度来自 `AVFrame`，按 2160 处理，避免把对齐填充行带入画面。

解码降级顺序仍然保留：进程内 FFmpeg D3D11VA 不可用时，退回 FFmpeg D3D11VA 子进程和 CPU RGBA 传输；该路径也失败时，再退回 FFmpeg 软件解码。不会再退回 Media Foundation。严格模式只禁止软件编码，不禁止兼容解码兜底。

Windows 构建现在使用 FFmpeg 8.1.2 full shared 包，并把 `avformat-62.dll`、`avcodec-62.dll`、`avutil-60.dll`、`swresample-6.dll` 放在 `luna-render-core.node` 同目录。该 full build 启用了 GPL 组件，正式发布前必须完成许可证和可再分发范围审计；包内 `LICENSE` 已复制为 `FFmpeg-LICENSE.txt`。

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
  --output 'C:\Users\admin\luna-ai-cut\test-output\windows-gpu-export-no-mf-10s.mp4' `
  --log 'C:\Users\admin\luna-ai-cut\test-output\windows-gpu-export-no-mf-10s.log'
```

测试程序直接运行时出现的 `Load Node-API ... GetProcAddress failed` 来自没有 Electron/Node 宿主的独立 Rust 二进制，不影响 GPU 导出结果。
