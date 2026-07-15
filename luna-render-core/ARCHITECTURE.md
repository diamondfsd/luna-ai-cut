# luna-render-core 目录规划与开发规范

本文档说明 `luna-render-core` 的模块边界、依赖方向和后续开发约束。目标是让媒体探测、时间线编排、GPU 渲染和平台能力各自演进，避免功能持续堆积到 `lib.rs`、`composition.rs` 或 `compositor.rs`。

## 1. 模块定位

`luna-render-core` 是 Luna AI Cut 的原生渲染核心，主要负责：

- 通过 N-API 向 Electron/Node.js 提供稳定的渲染接口。
- 探测和解码图片、视频等媒体资源。
- 计算合成时间线、图层状态和预览布局。
- 使用 wgpu 完成纹理管理、颜色处理、LUT 和图层合成。
- 导出单帧图片和视频，并提供任务进度与取消能力。
- 在 macOS 上接入 Metal、CoreVideo 和 VideoToolbox 等平台能力。

它不负责前端业务状态、项目文件管理或 UI 交互。

## 2. 总体依赖方向

依赖只能从上层编排流向下层能力：

```text
N-API 入口与数据契约
        |
        v
合成与导出编排 composition
        |
        v
GPU 渲染 compositor <------ 平台桥接 macos
        |
        v
媒体公共能力 media
```

具体约束：

- `lib.rs` 可以调用各领域模块，但只负责实例生命周期、参数转换和接口转发。
- `composition` 可以依赖 `compositor`、`media` 和 `export`。
- `compositor` 可以依赖 `media`，不能反向依赖合成任务或导出流程。
- `media` 是底层公共层，不依赖 `composition` 或 `compositor`。
- 平台模块可以调用渲染核心，但平台句柄和 `unsafe` 代码不能扩散到通用模块。

## 3. 目录结构

```text
luna-render-core/
├── ARCHITECTURE.md
├── Cargo.toml
├── build.rs
└── src/
    ├── lib.rs
    ├── api_types.rs
    ├── color_source.rs
    ├── logging.rs
    ├── export.rs
    ├── composition.rs
    ├── composition/
    │   ├── timeline.rs
    │   ├── frame.rs
    │   ├── video_export.rs
    │   └── image_export.rs
    ├── compositor.rs
    ├── compositor/
    │   ├── gpu.rs
    │   ├── texture.rs
    │   ├── lut.rs
    │   ├── render.rs
    │   ├── playback.rs
    │   ├── preview.rs
    │   └── external.rs
    ├── media/
    │   ├── mod.rs
    │   ├── geometry.rs
    │   ├── image.rs
    │   └── probe.rs
    ├── macos/
    │   ├── mod.rs
    │   └── av_bridge.m
    └── shaders/
        └── *.wgsl
```

## 4. 根模块职责

### `lib.rs`

crate 门面和 N-API 入口，允许包含：

- 模块声明和对外类型导出。
- 预览、导出两套 `Compositor` 实例的生命周期管理。
- N-API 参数到领域模型的轻量转换。
- 对领域服务的薄调用。

禁止在这里实现 FFmpeg 命令、时间线计算、GPU 资源创建或复杂业务分支。一个入口函数如果出现多阶段处理，应下沉到对应领域模块。

### `api_types.rs`

存放跨 N-API 边界的数据契约，例如渲染图层、颜色参数、变换参数和预览输入输出。

- 类型应以数据表达为主，不承载 I/O 或渲染流程。
- 新字段必须考虑旧调用方未传值时的兼容性，优先使用 `Option<T>` 或合理默认值。
- 修改字段名、类型或必填性属于接口变更，需要同步检查 TypeScript 调用方。

### `color_source.rs`

负责颜色空间探测、HDR/广色域识别和 SDR 规范化。通用的视频尺寸、帧率探测仍应放在 `media`，不要把所有 ffprobe 功能集中到这里。

### `logging.rs`

统一管理文件日志、标准错误输出和 panic hook。领域模块通过 crate 日志宏记录信息，不直接维护各自的日志文件句柄。

### `export.rs`

只管理导出任务的注册、进度、取消状态和质量预设，不包含具体图片或视频编码流程。

## 5. 合成层 `composition`

`composition.rs` 只保留合成数据模型、子模块声明和必要导出。

| 文件 | 职责 |
| --- | --- |
| `timeline.rs` | 素材时间映射、图层激活、合成时长/帧率推断、音频封装、渲染层生成 |
| `frame.rs` | 单帧合成和异步 N-API 任务 |
| `video_export.rs` | 编码器选择、逐帧渲染、视频编码、任务进度和取消 |
| `image_export.rs` | 静态帧渲染和图片编码 |

开发要求：

- 时间规则只能在 `timeline.rs` 中实现，预览与导出必须复用同一套时间映射。
- 图片导出和视频导出共享的单帧渲染能力放在 `frame.rs`。
- 编码器探测或导出降级策略属于 `video_export.rs`，通用媒体信息探测属于 `media`。
- N-API `Task` 的 `compute` 执行耗时工作，`resolve` 只完成结果转换。
- 所有长循环都必须检查取消状态，并持续更新可查询的任务进度。

## 6. 渲染层 `compositor`

`compositor.rs` 保存 `Compositor` 核心状态、构造过程以及少量跨子模块共享的结构和算法。

| 文件 | 职责 |
| --- | --- |
| `gpu.rs` | 无状态的 GPU 管线、纹理、bind group、LUT 资源创建和上传工具 |
| `texture.rs` | 纹理加载、更新、释放、文字栅格化和纹理生命周期 |
| `lut.rs` | `.cube` LUT 读取、校验和缓存 |
| `render.rs` | 图层参数打包、render pass、GPU 提交和像素回读 |
| `playback.rs` | 图片纹理缓存、视频解码器、预览帧获取和缓存淘汰 |
| `preview.rs` | 输出尺寸、图层矩形、裁剪、定位和变换规划 |
| `external.rs` | 外部 GPU 纹理包装、注册、同步和平台互操作 |

开发要求：

- 不修改 `Compositor` 状态的 GPU 工具函数放到 `gpu.rs`。
- 涉及纹理所有权、缓存或生命周期的逻辑放到 `texture.rs` 或 `playback.rs`。
- 布局计算必须与 GPU 提交分离，纯计算放在 `preview.rs`，实际绘制放在 `render.rs`。
- 新增 shader 参数时，需要同时更新 Rust 侧参数结构、WGSL 参数布局和构造代码，并确认内存对齐。
- 渲染主循环中避免频繁创建大 Buffer、管线或解码进程，应优先复用和缓存。
- 跨兄弟模块调用优先使用 `pub(super)`，不要为了方便把内部方法全部设为 `pub`。

## 7. 媒体公共层 `media`

`media` 存放不依赖 GPU 和合成任务的通用媒体能力。

| 文件 | 职责 |
| --- | --- |
| `geometry.rs` | 与媒体输出尺寸相关的纯计算 |
| `image.rs` | 本地路径规范化、图片方向探测、静态图片解码 |
| `probe.rs` | 视频尺寸、帧率、时长、音频流等 ffprobe 信息 |

新增 FFmpeg/ffprobe 能力时，先判断是否能被预览和导出共同使用。可复用能力必须进入 `media`，调用方不应重复拼接相同命令或重复解析同一份 JSON。

命令执行应遵守：

- 使用 `Command` 和参数数组，不拼接后再交给 shell 执行。
- 错误中包含工具名称、输入资源和退出状态，但避免记录大段二进制数据。
- 使用 `serde_json` 解析 ffprobe 输出，不用字符串查找代替结构化解析。
- 对 `file://`、URL 编码、图片方向和零尺寸输入保持统一处理。

## 8. 平台层与 shader

### `macos/`

- Objective-C/系统框架桥接保留在 `av_bridge.m`。
- Rust FFI、资源释放和安全封装保留在 `macos/mod.rs`。
- 每个原始句柄必须有明确所有者，并通过 `Drop` 或单一释放路径回收。
- `unsafe` 块应尽量短，并在边界处验证空指针、尺寸和返回状态。
- 通用渲染算法不能只写在 macOS 分支；平台层只负责解码、纹理互操作和编码加速。

### `shaders/`

- 按顶点、公共函数、颜色、细节、曲线和片元职责维护 WGSL 文件。
- 公共 WGSL 函数放入对应公共文件，避免复制到多个 shader 阶段。
- 修改 shader 后至少执行一次真实 GPU 初始化或渲染验证，仅通过 Rust 编译不能证明 WGSL 可用。

## 9. 新功能放置决策

开发新功能时按以下顺序判断：

1. 是否改变 Node.js 调用契约？是则先更新 `api_types.rs` 和薄 N-API 入口。
2. 是否属于时间线、图层激活或导出流程？放入 `composition/` 对应模块。
3. 是否属于 GPU 绘制、纹理或布局？放入 `compositor/` 对应模块。
4. 是否是不依赖 GPU 的通用媒体能力？放入 `media/`。
5. 是否持有平台句柄或包含 FFI？放入平台模块或 `external.rs`。
6. 两个以上模块出现同类实现时，先抽取到已有公共层，不新增 `utils.rs` 大杂烩。

只有在现有职责无法准确容纳、并且新能力有独立生命周期时才创建新模块。

## 10. 通用编码规范

- 单个 `.rs` 文件原则上不超过 500 行，接近 450 行时就评估拆分。
- 按职责拆分，不以“把后半段挪到另一个文件”作为最终结构。
- 优先使用 `pub(super)`、`pub(crate)`，仅 N-API 数据契约和导出入口使用公开可见性。
- 纯计算函数尽量无副作用，便于单元测试和多流程复用。
- 错误使用 `Result<T, String>` 保持当前 crate 风格，并在模块边界补充上下文。
- 面向用户的错误信息描述结果和解决方向，内部日志可以包含工具、阶段和资源路径。
- 不用 `unwrap()` 处理文件、锁、FFmpeg、GPU 或 FFI 等可失败边界。
- 注释解释约束、所有权或算法原因，不重复描述代码表面行为。
- 避免一次提交同时进行无关格式化，确保结构变更容易审阅。

## 11. 测试规范

以下逻辑必须优先补充单元测试：

- 时间映射、循环播放、图层显示区间和 reveal 进度。
- 尺寸、裁剪、方向、定位和变换计算。
- 帧率、时长、旋转和颜色元数据解析。
- 缓存命中、缓存淘汰和解码尺寸选择。
- 导出取消、进度计算和降级分支。

涉及 FFmpeg、真实媒体或 GPU 的功能，应补充最小集成样例，验证输入、输出尺寸、像素格式和资源释放。修复缺陷时，先添加能够复现问题的测试，再修改实现。

## 12. 提交前检查

在 `luna-render-core` 目录执行：

```bash
cargo fmt -- --check
cargo check
cargo test
```

同时完成以下人工检查：

- 相关 `.rs` 文件是否都低于 500 行。
- N-API 参数或返回值是否影响 TypeScript 调用方。
- 预览与导出是否复用了相同的布局、时间和颜色规则。
- 新增缓存是否有上限、淘汰策略和释放路径。
- 新增 FFmpeg 子进程、GPU 资源或 FFI 句柄是否在成功和失败路径都能释放。
- macOS 专用改动是否保留了非 macOS 的回退路径。
- shader 改动是否完成实际渲染验证。
