# Windows GPU 导出测试指南

本文用于在 Windows x64 真机验证 Luna AI Cut 的全 GPU 视频导出链路：

```text
Media Foundation / DXVA 解码
  -> D3D11 视频表面与颜色转换
  -> D3D11On12 / wgpu 合成
  -> Media Foundation 硬件编码
  -> MP4 与音频合并
```

测试脚本最多导出源视频的前 10 秒，并自动判断是否真正完成 WinGPU 导出。Windows
上即使生成了输出文件，只要中途回退 FFmpeg，脚本仍会返回失败，便于排查 GPU 链路。

## 1. 测试环境

### 硬件和系统

- Windows 10 或 Windows 11 x64，推荐使用已更新的 Windows 11。
- 支持 Direct3D 12、硬件视频解码和 H.264/HEVC 硬件编码的 Intel、NVIDIA 或 AMD 显卡。
- 使用显卡厂商的正式版驱动，不建议仅依赖 Windows 自动安装的基础驱动。
- 尽量直接登录本机桌面测试。远程桌面、虚拟机或云桌面可能改变可用的显卡设备和视频能力。

### 开发工具

安装以下工具：

1. Git。
2. Node.js 22 或更高版本，必须为 x64。
3. pnpm 11.1.3；也可以通过 Node 自带的 Corepack 启用。
4. Rust stable x86_64 MSVC 工具链。
5. Visual Studio 2022 Build Tools，并勾选：
   - `Desktop development with C++`（使用 C++ 的桌面开发）
   - MSVC v143 x64/x86 build tools
   - Windows 10 SDK 或 Windows 11 SDK

安装完成后重新打开 PowerShell，执行以下命令确认环境：

```powershell
git --version
node --version
node -p "process.arch"
corepack enable
corepack prepare pnpm@11.1.3 --activate
pnpm --version
rustup --version
cargo --version
rustc --version
```

其中 `node -p "process.arch"` 应输出 `x64`。

## 2. 获取测试分支

已有仓库时：

```powershell
cd D:\projects\luna-ai-cut
git fetch origin
git switch feature/windows-gpu-export
git pull --ff-only
git log -1 --oneline
```

最后一条命令应能看到包含 Windows GPU 导出的提交，例如：

```text
2d51f25 feat: add Windows zero-copy GPU export
```

首次克隆时：

```powershell
git clone --branch feature/windows-gpu-export https://github.com/diamondfsd/luna-ai-cut.git
cd luna-ai-cut
```

## 3. 安装依赖并构建

在项目根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm run init:rust
pnpm run build:rust
pnpm run build:app
```

`pnpm run build:rust` 成功后应生成：

```text
luna-render-core\luna-render-core.node
```

可以用 PowerShell 确认：

```powershell
Test-Path .\luna-render-core\luna-render-core.node
```

应输出 `True`。

## 4. 准备测试素材

建议准备以下本地视频。素材路径可以包含空格，但运行命令时必须加双引号。

| 编号 | 编码 | 分辨率/帧率 | 音频 | 目的 |
|---|---|---|---|---|
| A | H.264 | 1920×1080，30fps | 有 | 最小成功用例 |
| B | H.264 | 3840×2160，30fps | 有 | 4K 性能与显存压力 |
| C | H.264 | 3840×2160，60fps | 有 | 高帧率压力 |
| D | HEVC 8-bit | 3840×2160，30fps | 有 | HEVC 硬件解码 |
| E | HEVC 10-bit | 3840×2160，30fps | 有 | P010/10-bit 解码输入 |
| F | H.264 或 HEVC | 任意 | 无 | 无音频输入处理 |

优先先用 A 完成冒烟测试，再测试其他素材。不要直接使用网络 URL；脚本需要本地文件路径。

## 5. 执行快速测试

在项目根目录运行：

```powershell
node .\scripts\test-gpu-export.mjs "D:\Videos\h264-1080p.mp4"
```

测试生成两个主要文件：

```text
test-output\test-gpu-export.mp4
test-output\luna-rc-test.log
```

脚本退出码为 `0` 才表示 WinGPU 链路通过。执行后可以查看退出码：

```powershell
$LASTEXITCODE
```

应输出 `0`。

## 6. 如何判断成功

控制台最后应显示：

```text
TEST PASSED — WinGPU export succeeded without FFmpeg fallback
```

日志中应同时出现以下关键信息：

```text
GPU adapter: ... backend=Dx12
[Export:WinGPU] start ...
[Export:WinGPU] capabilities d3d11on12=true h264=true ...
[Export:WinGPU] decoder=media-foundation output=NV12 ... sharing=d3d11on12-unwrap
[Export:WinGPU] pipeline=mf-decode,d3d11-video-process,wgpu-compose,mf-h264 sync=d3d12-fence readback=false
[Export:WinGPU] completed
```

HEVC 10-bit 素材的解码输出可能显示 `output=P010`。最终编码默认优先 H.264；只有系统没有
H.264 硬件编码器且存在 HEVC 硬件编码器时，才会选择 `mf-hevc`。因此“HEVC 输入”不代表
输出文件必须是 HEVC。

以下任意情况都不能算 WinGPU 测试成功：

- 出现 `[Export:WinGPU] unavailable`。
- 出现 `[Export:FFmpeg]`。
- 日志显示 `readback=true`。
- 控制台显示 `Output exists, but WinGPU fell back to FFmpeg`。
- 仅生成 MP4 文件，但脚本退出码不是 `0`。

## 7. 检查画面和音频

用播放器完整检查导出的 10 秒视频，重点观察：

- 画面方向是否正确，尤其是手机竖屏或带旋转信息的视频。
- 是否存在绿屏、黑屏、花屏、撕裂或间歇性旧帧。
- 色彩和亮度是否明显偏绿、偏紫、过亮或过暗。
- 裁剪是否符合 `cover` 效果，画面比例是否正确。
- 帧播放是否连贯，音画是否同步。
- 输入有音频时输出也应有音频；输入本身无音频时，输出无音频是正常结果。

测试期间可以打开“任务管理器 → 性能 → GPU”，观察以下引擎：

- Video Decode
- 3D 或 Compute
- Video Encode

三类引擎通常会先后或同时出现负载。不同显卡驱动的引擎名称可能略有差异。

## 8. 保存每次测试结果

测试脚本每次运行都会清理上一次的固定输出和日志。每个素材测试完成后，先复制结果：

```powershell
$case = "nvidia-h264-1080p30"
Copy-Item .\test-output\test-gpu-export.mp4 ".\test-output\$case.mp4"
Copy-Item .\test-output\luna-rc-test.log ".\test-output\$case.log"
```

建议同时记录：

| 项目 | 示例 |
|---|---|
| Windows 版本 | Windows 11 24H2 |
| GPU | NVIDIA RTX 4060 Laptop |
| 驱动版本 | 具体版本号 |
| 素材 | H.264 3840×2160 60fps，有音频 |
| 测试结果 | PASS / FAIL |
| 10 秒导出耗时 | 例如 4.8 秒 |
| 输出画面 | 正常 / 异常描述 |
| 日志文件 | 对应 `.log` 文件名 |

## 9. 推荐测试顺序

在每台 Intel、NVIDIA、AMD 设备上按以下顺序执行：

1. H.264 1080p30 冒烟测试。
2. H.264 4K30。
3. H.264 4K60。
4. HEVC 8-bit 4K30。
5. HEVC 10-bit 4K30。
6. 无音频素材。
7. 连续重复同一素材 5 次，检查偶发同步、驱动重置和临时文件清理问题。
8. 测试过程中取消一次正式应用导出，确认应用可继续发起下一次导出。

## 10. 在应用中复测

脚本通过后，可以启动开发版应用：

```powershell
pnpm dev
```

在应用内选择同一素材并执行硬件导出，检查：

- 进度能持续更新到完成。
- 取消操作能够停止导出。
- 完成后输出文件可播放，画面、裁剪、水印、调色和音频正确。
- 连续导出多个素材时不会越来越慢，也不会残留 `.win-gpu-partial.mp4` 等临时文件。
- 不支持的素材能够自动使用兼容导出，而不会导致应用崩溃。

如果还需要验证 Windows 安装包：

```powershell
pnpm pack:win:x64
```

安装包输出在 `release` 目录。安装后重复应用内导出测试。

## 11. 常见问题

### 找不到 `luna-render-core.node`

重新执行：

```powershell
pnpm run build:rust
```

如果构建失败，先确认 Rust、Visual Studio C++ Build Tools 和 Windows SDK 已安装，并重新打开 PowerShell。

### 提示找不到 `link.exe`、`cl.exe` 或 Windows SDK

打开 Visual Studio Installer，修改 Build Tools 安装，确认已勾选“使用 C++ 的桌面开发”、
MSVC v143 和 Windows SDK。安装后关闭并重新打开终端。

### GPU Backend 不是 `Dx12`

- 更新显卡驱动。
- 在 Windows“设置 → 系统 → 显示 → 图形”中，将 Node.js 或 Luna AI Cut 设置为高性能显卡。
- 笔记本连接电源后重试。
- 避免通过远程桌面或虚拟机测试。
- 使用 `dxdiag` 确认系统和显卡支持 Direct3D 12。

### 日志提示没有硬件编码器

- 更新或重新安装 Intel/NVIDIA/AMD 官方驱动。
- 确认显卡型号本身支持 H.264 或 HEVC 硬件编码。
- 关闭可能长期占用编码器的录屏、直播或远程桌面软件后重试。

### 日志出现 `[Export:WinGPU] unavailable`

该行后面会包含具体回退原因。请保留：

1. 完整控制台输出。
2. `test-output\luna-rc-test.log`。
3. GPU 型号和驱动版本。
4. 素材的编码、分辨率、帧率和位深。
5. 能复现问题的短视频样本；如果素材涉及隐私，可提供同规格的替代样本。

### 输出无音频

先确认输入文件本身有音频。脚本开头会打印 `Audio: ✅` 或 `Audio: ❌ none`：

- 输入无音频：输出无音频正常。
- 输入有音频但输出无音频：保存日志和样本，作为音频合并问题报告。

### 测试崩溃、卡住或出现设备移除

- 保存崩溃前的日志，不要立即再次覆盖运行。
- 记录任务管理器中的 GPU 和专用显存占用。
- 在事件查看器中检查“Windows 日志 → 系统”是否存在显示驱动恢复记录。
- 先用 H.264 1080p30 重试，再逐级增加到 4K/60fps，以确定问题边界。

## 12. 提交测试反馈

反馈至少包含以下信息：

```text
Windows 版本：
CPU：
GPU：
驱动版本：
Node.js / pnpm / rustc 版本：
素材编码、分辨率、帧率、位深、是否有音频：
测试命令：
脚本退出码：
测试结果：
导出耗时：
画面或音频现象：
```

同时附上对应的 `luna-rc-test.log`。如果测试失败但生成了 MP4，也请一并说明该文件是否可以播放。
