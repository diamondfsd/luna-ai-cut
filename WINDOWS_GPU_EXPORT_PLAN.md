# Windows GPU 导出实施计划

## 目标

在 Windows 上实现与 macOS GPU 导出接近的全 GPU 视频链路，避免逐帧将 RGBA 从 GPU 回读到 CPU。优先覆盖 Intel、NVIDIA、AMD，并保留当前 FFmpeg 导出作为兼容回退。

目标链路：

```text
Media Foundation / DXVA 硬件解码
  -> Direct3D 纹理
  -> wgpu 现有 WGSL 合成、调色、水印
  -> GPU 颜色转换（NV12）
  -> Media Foundation H.264/HEVC 硬件编码
  -> MP4 与音频封装
```

## 当前状态

- 工作目录：`worktrees/windows-gpu-export`
- 分支：`feature/windows-gpu-export`
- 基线：`main` 的 `c6556fe`
- 已完成第一阶段基础接入：Windows 条件依赖、D3D12 原始设备/队列访问、
  D3D11On12 + `IMFDXGIDeviceManager` 初始化、H.264/HEVC 硬件编码器枚举，
  以及安全回退日志已接入。
- 已将 D3D11 Video Processor 接入输入、输出两侧，完成 NV12/P010 → BGRA 和
  BGRA → NV12 的 GPU 转换；转换结果通过外部 `ID3D12Resource` 进入现有 compositor。
- 已实现 Media Foundation Source Reader 硬件解码基础：绑定现有
  `IMFDXGIDeviceManager`、读取尺寸/旋转/时间戳、区分结束与失败，并从
  `IMFSample` 提取 `IMFDXGIBuffer`、`ID3D11Texture2D` 和子资源索引。
- 已接入 GPU 表面预检，可识别 NV12/P010，并通过
  `ID3D11On12Device2::UnwrapUnderlyingResource` 验证底层 D3D12 资源属于当前
  wgpu 队列；逐帧资源通过 D3D12 fence 归还 D3D11On12，不执行 CPU 像素回读。
- 已实现 Media Foundation Sink Writer H.264/HEVC 硬件编码、MP4 临时文件、源音频
  合并、进度、取消、异常清理和 FFmpeg 安全回退，并接入完整 composition 多图层流程。
- macOS 已有 `CoreVideo + Metal + VideoToolbox` GPU 导出路径，其生命周期、回退和音频处理行为保持不变。
- Windows WinGPU 成功路径已移除逐帧 GPU 回读、`map_async`、`poll Wait` 和 RGBA stdin；仅在能力或运行条件不满足时回退 FFmpeg。
- `scripts/test-gpu-export.mjs` 已支持检查 `Export:WinGPU` 启动、能力探测、完成和回退日志。

## 当前开发阶段：代码完成，等待 Windows 真机验收

完整代码链路已经接通。当前剩余工作是 Windows 真机驱动覆盖测试与性能验收：

```text
Media Foundation Source Reader
  -> DXVA 硬件解码
  -> D3D11 视频表面
  -> D3D11On12 / 共享资源
  -> wgpu 外部输入纹理
  -> 现有 WGSL 合成
```

### 开发任务

1. **实现 Source Reader 解码器（已完成）**
   - 新建 `luna-render-core/src/windows/decoder.rs`。
   - 使用 Media Foundation Source Reader 打开视频并读取基础媒体信息。
   - 将现有 `IMFDXGIDeviceManager` 设置给 Source Reader，启用硬件变换和 Direct3D 表面输出。
   - 支持按时间读取帧、读取旋转信息、区分正常结束与解码失败。

2. **提取 Direct3D 视频表面（已完成代码接入，待 Windows 真机覆盖验证）**
   - 从 `IMFSample` 获取 `IMFDXGIBuffer`。
   - 从缓冲区取得 `ID3D11Texture2D`、子资源索引、尺寸和像素格式。
   - 验证常见 H.264/HEVC 素材是否输出 NV12/P010 等 GPU 表面。

3. **打通 D3D11 与 wgpu D3D12 资源共享（已完成）**
   - 优先验证 D3D11On12 下解码表面对应的 D3D12 资源获取方案。
   - 无法直接取得资源时，验证共享句柄或 GPU 内部复制到共享纹理的方案。
   - 不允许使用逐帧 CPU 锁定、下载或 RGBA 中转作为成功路径。

4. **建立跨 API 同步和资源生命周期（已完成代码接入，待真机压力验证）**
   - 明确 Source Reader、D3D11On12 和 wgpu 队列之间的资源所有权与状态转换。
   - 使用 wrapped resource Acquire/Release、共享 fence 或等价同步机制。
   - 保证解码帧、COM 对象和外部 wgpu 纹理在 GPU 工作完成前保持有效。
   - 每帧独立分配可并行在途表面，通过队列 fence 串联 D3D11On12 与 wgpu，不执行逐帧全局等待。

5. **接入现有 compositor（已完成）**
   - 将解码表面注册为外部输入纹理并生成现有 `RenderLayer`。
   - 复用现有裁剪、旋转、调色、LUT、水印和多图层合成逻辑。
   - 每帧结束后安全注销临时纹理，不污染静态纹理缓存。

6. **回退、日志与测试（代码与脚本已完成，待 Intel/NVIDIA/AMD 真机矩阵）**
   - 共享失败、格式不支持、驱动异常或素材不兼容时返回明确原因并回退 FFmpeg。
   - 增加解码方式、输出表面格式、共享方式和同步方式日志。
   - 扩展 `scripts/test-gpu-export.mjs`，验证实际进入硬件解码和外部纹理路径。
   - 至少验证 H.264、HEVC、1080p、4K，以及 Intel/NVIDIA/AMD 可用环境。

### 本阶段验收条件

- 视频帧由 Media Foundation/DXVA 解码为 GPU 表面。
- 解码帧能作为 wgpu 外部输入纹理进入现有 compositor，并正确完成至少一段视频的逐帧合成。
- 成功路径不调用 FFmpeg 视频解码，不执行 `map_async`、CPU RGBA 回读或逐帧内存复制。
- 裁剪、旋转、调色和水印结果与现有预览/FFmpeg 路径一致。
- 取消、结束和异常情况下 COM 对象、共享纹理及临时资源均能正确释放。
- 不支持的设备或素材仍能安全回退到现有 FFmpeg 导出。

### 输出侧全 GPU 阶段（已完成）

1. compositor 的 BGRA 合成结果已通过 D3D11 Video Processor 在 GPU 上转换为 NV12。
2. Direct3D 表面已直接提交给 Media Foundation H.264/HEVC 硬件 Encoder MFT。
3. 已完成 MP4 输出、源音频复制与裁剪、进度、取消和临时文件清理。
4. WinGPU 成功路径已移除 RGBA readback 和 FFmpeg stdin 逐帧输入。

## 实施步骤

1. **能力与架构验证**
   - 确认 wgpu 30 的 D3D12 原始设备、队列、纹理包装接口。
   - 确定 D3D12 与 Media Foundation D3D11 设备之间的共享方式：优先共享句柄与同步栅栏，必要时使用 D3D11On12。
   - 验证硬件编码 MFT 是否接受 Direct3D 表面，以及 BGRA 到 NV12 的 GPU 转换路径。

2. **Windows 原生模块**
   - 新建 `luna-render-core/src/windows/`，按职责拆分设备管理、解码、颜色转换、编码和导出编排。
   - 增加 Windows 条件依赖与链接库，避免影响 macOS 构建。
   - 初始化 Direct3D/Media Foundation 设备和 `IMFDXGIDeviceManager`。

3. **wgpu 外部纹理桥接**
   - 将 compositor 的外部纹理入口扩展到 Windows。
   - 复用现有 WGSL 和 composition 数据结构，不创建第二套视觉算法。
   - 使用多缓冲纹理和 GPU 同步，避免每帧 `map_async`、`poll Wait` 和 CPU RGBA 拷贝。

4. **硬件解码与编码**
   - 使用 Media Foundation Source Reader/DXVA 解码到 GPU 表面。
   - 合成结果在 GPU 上转换为 NV12。
   - 枚举并验证 H.264/HEVC 硬件 Encoder MFT，Intel/NVIDIA/AMD 走同一套 Media Foundation 接口。
   - 不支持的素材、驱动或设备自动回退当前 FFmpeg 管线。

5. **封装、音频与任务控制**
   - 保留源音频复制和裁剪时间逻辑。
   - 确保进度、取消、临时文件清理和失败回退行为与 macOS 路径一致。
   - 日志统一使用 `[Export:WinGPU] start/completed/unavailable`。

6. **测试与验收**
   - 更新 `scripts/test-gpu-export.mjs`，验证是否真正进入 WinGPU 路径、输出音频轨和回退原因。
   - 覆盖 Intel、NVIDIA、AMD；至少测试 H.264、HEVC、1080p、4K、30/60fps、有/无音频。
   - 对比导出耗时、GPU/CPU 占用、峰值内存和输出画面一致性。
   - 运行 Rust Windows target 检查、`pnpm run build:app` 及相关脚本。

## 验收标准

- WinGPU 成功路径不再调用 compositor 的 RGBA readback，也不再向 FFmpeg stdin 写逐帧 RGBA。
- GPU 支持时日志出现 `[Export:WinGPU] completed`；不支持时能安全回退并记录明确原因。
- 导出画面与预览/macOS 导出一致，音频、裁剪、进度和取消功能正常。
- Windows 4K 导出速度相较当前版本有显著提升，且 CPU 占用明显下降。
- macOS 现有 GPU 导出和其他平台 FFmpeg 回退不受影响。

## Windows 真机验收入口

完整的环境准备、构建、测试矩阵、成功判定和故障排查参见
[`WINDOWS_GPU_EXPORT_TEST_GUIDE.md`](WINDOWS_GPU_EXPORT_TEST_GUIDE.md)。

进入 worktree 后，先执行：

```bash
cd /Users/zhouchao/projects/luna-ai-cut/worktrees/windows-gpu-export
git status --short --branch
```

在 Windows 真机运行 `node scripts/test-gpu-export.mjs <视频路径>`，分别覆盖
Intel/NVIDIA/AMD、H.264/HEVC、1080p/4K，并依据日志确认 `readback=false`、
`[Export:WinGPU] completed` 且没有 FFmpeg fallback。
