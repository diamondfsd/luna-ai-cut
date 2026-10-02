# Rust ONNX 平台测试与最小探针

独立 Cargo 项目，使用与应用相同的 `ort = 2.0.0-rc.12`、API 23。
只编译独立 Rust 测试程序及推理 worker，不构建或打包 Electron/渲染核心。

## 全部模型的平台测试

先在应用中下载当前所有模型，然后在对应机器的项目根目录执行：

```sh
# macOS：优先 CoreML（ALL），失败回退 CPU
pnpm test:onnx:macos
```

```powershell
# Windows x64：优先 DirectML，失败回退 CPU
pnpm test:onnx:windows
```

默认使用与应用一致的 `ort` 版本、下载与链接方式；首次测试可能获取编译依赖和
ONNX Runtime 开发库。Windows 需 Rust MSVC 工具链、Visual Studio C++ Build Tools 和 Windows SDK；
macOS 需 Rust 与 Xcode Command Line Tools。测试会在启动前补齐运行库依赖，
Windows 不要求开启 Developer Mode。

也可以显式测试已有的动态运行库（不会下载运行库）：

```sh
pnpm test:onnx:macos --runtime /absolute/path/libonnxruntime.dylib
```

```powershell
pnpm test:onnx:windows --runtime C:/runtime/onnxruntime.dll
```

动态库需同架构、支持 API 23，并包含相应 EP；Windows 动态库的附属 DLL 需放在可加载路径中。
指定动态库时测试的是该库，不代表安装包内运行库。
Intel Mac 默认复用应用的 1.23.2 运行库准备流程；若该库未含 CoreML，兼容回退可以工作，
但“至少一个模型实际加速”的验收会失败，需要换成含 CoreML 的运行库。

测试清单从 `src/shared` 当前模型定义生成，覆盖 **18 个 ONNX 文件**：
SegFormer B5、Face Parsing、SCHP ATR、YOLO26s、RMBG、BiRefNet、DINOv2、UltraFace、
闭眼检测、SFace、ReLIC++ CPC、SlimSAM 编码器和解码器、LaMa、Neural-Preset、
Paraformer、Silero VAD、CT-Transformer 标点。
缓存里已经停用的模型、词表文本、远程大模型不计入 ONNX 测试。
缺少文件或 SHA256 不符会直接报出完整清单；测试不下载模型、不修改模型。

每个模型验证：CPU 基准、平台自动后端、连续推理、加载错误回退、推理错误回退、
回退后持续使用 CPU，以及 CPU 本身失败时保留错误。错误注入只存在于 Rust 测试编译中。
推理错误注入将测试会话标记为加速尝试并强制失败，确保实际无法加载加速后端的模型
也能覆盖同一回退路径；不声称模拟了驱动崩溃或进程退出。

浮点输出检查形状、有限值与 CPU 误差（`1e-3 + abs(cpu) * 1e-2`）；回退输出使用 `1e-6`。
整数输出严格一致。容差是兼容性检查阈值，不是视觉或语音质量验收。
输入采用确定性的合成图像/特征/语音窗口/词 ID，测试覆盖真实模型与应用共用的会话代码，
不替代真实照片、音频、完整 worker 工作流或 Electron 交互验收。

每个模型在独立进程中执行，超时上限 300 秒，单个模型失败后继续测试其他模型。
报告保存在 `test-results/onnx-platform/<平台-时间>/report.json`；各模型子目录保存日志与 ORT 执行记录。
正常模型不支持 EP 时允许 CPU 回退；整套测试至少要求一个模型有平台 EP 执行记录，
避免纯 CPU 运行被误报为加速成功。CoreML EP 事件不证明其内部算子全部在 GPU/ANE 上运行。

可选参数：`--models <模型目录>`、`--output <报告目录>`、`--model <模型ID或逗号分隔ID>`。
不传 `--model` 就测试全部模型。缺少模型时请先在应用中完成下载。

macOS 默认只把静态形状节点交给 CoreML，避免本机 Face Parsing 动态形状编译触发的原生进程崩溃。
当前 YOLO26 与量化 SlimSAM 解码器在 CoreML ALL 和 CPUAndGPU 下均未通过 CPU 输出一致性检查，
因此应用在 macOS 上让它们直接使用 CPU；这一限制不影响 Windows DirectML。
加载/推理返回错误可以回退 CPU，原生驱动或编译器导致的进程退出不能由 Rust 错误回退捕获。

## 单模型最小探针

此入口通过 `load-dynamic` 显式加载指定的本地运行库。

目前专用于项目的 **neural-preset-v1-256** 模型，输入为固定的
`content` / `style` float32 `[1,3,256,256]`。不能直接拿去测试 SAM、ASR 等其他输入契约的模型。
输入为可重复的合成数据，不代表真实照片质量验收。

## macOS

需要同架构、包含 CoreML EP、支持 API 23 的 ONNX Runtime。
`coreml-gpu` 使用 `CPUAndGPU`，排除 Neural Engine；`coreml` 使用 `ALL`，
允许 CoreML 在 CPU/GPU/Neural Engine 间调度。MLProgram 要求 macOS 12+。

```sh
cargo run --release --manifest-path scripts/onnx-provider-probe/Cargo.toml --bin luna-onnx-provider-probe -- \
  /absolute/path/libonnxruntime.dylib \
  /absolute/path/neural-preset-v1-256/model.onnx \
  coreml-gpu 10 test-results/onnx-provider-probe/gpu
```

将 `coreml-gpu` 换成 `coreml` 可测自动调度，换成 `cpu` 可仅测 CPU。

## Windows x64

需要支持 API 23、包含 DirectML EP 的 x64 `onnxruntime.dll`，
并把匹配的 `DirectML.dll` 及该发行版要求的依赖放在可加载路径中。
普通 CPU-only 的 DLL 不能通过这个测试。

```powershell
cargo run --release --manifest-path scripts/onnx-provider-probe/Cargo.toml --bin luna-onnx-provider-probe -- `
  C:/runtime/onnxruntime.dll `
  C:/models/neural-preset-v1-256/model.onnx `
  directml 10 test-results/onnx-provider-probe/directml
```

当前使用 adapter 0；双显卡设备上的 adapter 0 未必是最快显卡。
探针不是 WinML 测试，未验证 Windows App SDK 的初始化、EP 获取或部署。

## 输出与边界

- 先测 CPU，再测指定后端；加载、首次推理分开计时。
- 首次推理后再预热两次，输出指定次数的热运行中位数与 CPU 比值。
- 计时包含输入构造、传输、推理和输出读取；启用了执行记录，不能视作纯内核基准。
- 输出形状错误、非有限值、EP 注册失败或执行记录中没有目标 EP 时返回失败。
- 报告相对 CPU 的最大/平均绝对误差，不替模型的视觉质量制定通用阈值。
- `execution_events` 是多次运行累计事件数，不是唯一节点数或 GPU 覆盖率。
- CoreML 执行事件证明图的一部分交给 CoreML，不证明其内部每个算子的硬件归属。
- 本探针未启用 CoreML 持久编译缓存；系统自身缓存可能影响首次运行，不保证完全冷启动。

## 本机实测（2026-10-02）

完整平台测试：Apple M5 / 16 GB，默认链接的 ONNX Runtime **1.24.2**，18/18 个模型通过；
其中 14 个有 CoreML 执行事件，全部模型的加载/推理故障注入及持续 CPU 回退检查通过。
YOLO26、SlimSAM 解码器采用上述 CPU 一致性策略；BiRefNet 因 CoreML 编译缺少 `pad` 参数
自动回退 CPU；Silero VAD 的图由 CPU 执行。
报告位于 `test-results/onnx-platform/macos-verified-20261002/report.json`。
这是合成输入的真实推理兼容性验证；Windows 尚未实机执行。

以下为此前显式指定 1.23.2 动态库的单模型计时，不与完整平台测试混用：

Apple M5 / 16 GB；Rust release 探针；本地 arm64 ONNX Runtime **1.23.2**；
项目已下载的追色模型；每种模式 5 次热运行。
运行库来自本机已有缓存中的独立 dylib，未执行 Python；不是应用打包产物，
不能据此证明应用当前使用的 arm64 运行库已经包含 CoreML。

| 模式 | CPU 中位数 | 加速中位数 | 比值 | 加速加载 + 首次推理 |
|---|---:|---:|---:|---:|
| CoreML CPUAndGPU | 14.71 ms | 5.34 ms | 2.75× | 2185.39 ms |
| CoreML ALL | 14.23 ms | 7.57 ms | 1.88× | 483.95 ms |

两种模式的最大绝对误差约 0.000001，均有 CoreML 和 CPU 执行事件。
两次顺序运行，首次耗时可能受系统缓存影响，不用于严格比较冷启动。
Windows 尚未实机执行。

## 兼容性资料

- [DirectML EP](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)：Windows 10 1903+、DirectX 12；已转入持续维护。
- [CoreML EP](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)：基础支持 macOS 10.15+；MLProgram 要求 macOS 12+。
- [新 Windows ML](https://learn.microsoft.com/en-us/windows/ai/new-windows-ml/overview)：CPU/DirectML 路径覆盖 Windows App SDK 支持的系统；厂商优化的 GPU/NPU EP 要求 Windows 11 24H2+。
- [Windows App SDK 系统支持](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/support)：需结合具体 SDK 版本和 Windows 服务周期核对。

应用已统一通过 `luna-render-core/src/onnx_session.rs` 创建会话并执行 CPU 回退。CoreML 需注册 EP，
不能因为应用已有 wgpu/Metal 渲染就认为 ONNX 自动使用 GPU。
WinML 可减少随应用分发的运行库，但共享运行库、首次 EP 获取与离线部署仍需单独验证；
现有 Rust `ort` 接口不是 Windows App SDK 生命周期管理的直接替代品。
