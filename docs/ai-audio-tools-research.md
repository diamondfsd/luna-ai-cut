# AI 音频工具调研报告（跨平台本地 ONNX 复审）

> 本节是 2026-09-14 针对“macOS + Windows、完全本地、优先复用 Rust/ONNX”的复审结论。它优先于后文上一轮只按模型能力排序的结论。

## 本轮复审结论

### 硬约束

- 推理过程不能依赖在线 API；模型和运行时安装到本地后，断网也应能完成任务。
- 第一目标平台是 macOS Apple Silicon 和 Windows x64。Windows ARM64 暂未验证，不作为第一阶段发布目标。
- 优先复用当前 `luna-render-core` 的 Rust Worker、`ort` 和模型资源校验体系。
- Agent 只能调用本地工具，不能自行安装 Python、下载依赖或临时访问模型站点。

### 最终推荐

| 能力 | 严格 Rust/ONNX 路线 | 产品质量路线 | 本轮建议 |
| --- | --- | --- | --- |
| 音乐生成 | [MusicGPT](https://github.com/gabotechs/MusicGPT) 的 MusicGen ONNX 管线 | [Stable Audio Open](https://huggingface.co/stabilityai/stable-audio-open-1.0) 的本地 Worker | ONNX 是硬约束时选 MusicGen；背景音乐片段质量优先时对照 Stable Audio Open；需要长音频/歌曲能力再评估 ACE-Step |
| 节奏识别 | [beat-this-rs](https://github.com/danigb/beat-this-rs)，ONNX 模型 + Rust `rten`/可选 ORT | 原始 [Beat This](https://github.com/CPJKU/beat_this) Python 实现 | 首选 beat-this-rs；默认使用纯 Rust `rten`，需要统一 ONNX Runtime 时切到 `ort` 后端 |

最重要的判断是：**现阶段没有发现一个同时满足“现代高质量音乐生成、官方 ONNX、Rust、Windows/macOS、长音频”的成熟开源方案**。不能因为模型可以从 PyTorch 导出，就把导出后的模型自动视为可维护的产品方案；音乐生成还包含文本编码、逐 token 采样、KV cache、延迟码模式和 EnCodec 解码等完整管线。

## 结论摘要

本报告调研两个计划提供给外部 AI Agent 的本地工具：

1. **音乐生成**：如果 Rust + ONNX + 跨平台是硬约束，首选 [MusicGPT](https://github.com/gabotechs/MusicGPT) 的 MusicGen ONNX 管线；如果背景音乐片段质量优先，对照 [Stable Audio Open](https://huggingface.co/stabilityai/stable-audio-open-1.0)；如果需要 60 秒以上的歌曲式结构，再评估 [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5)，但它需要独立的 Python/MLX 本地 Worker。
2. **节奏识别**：首选 [beat-this-rs](https://github.com/danigb/beat-this-rs)。它将 Beat This 模型和特征处理封装为 Rust 管线，能输出 beat、downbeat 和 BPM，适合在 Windows/macOS 上作为本地 Worker 运行。
3. **轻量兜底**：使用 [librosa](https://github.com/librosa/librosa) 的 `beat_track`。它没有预训练模型，安装和维护成本较低，但复杂音乐上的稳定性不应替代神经网络节拍器。

如果“Rust + ONNX + 跨平台”是硬约束，音乐生成应优先研究 [MusicGPT](https://github.com/gabotechs/MusicGPT) 的 MusicGen ONNX 实现；如果“背景音乐片段质量和声场”更重要，则对照 Stable Audio Open；如果“长音频和歌曲式结构”更重要，再保留 ACE-Step 1.5。所有路线都必须由应用预装或管理模型，推理时禁止自动联网。

## 背景音乐专项判断

这次的目标是**视频背景音乐素材**，不是生成一首有主歌、副歌、人声和完整歌曲结构的歌曲。选型标准应调整为：

- 默认纯音乐，禁止歌词、演唱、旁白和明显的人声主旋律。
- 支持 15 到 60 秒的目标时长，或者能稳定生成短片段后无感延长。
- 优先能控制 BPM、调式、能量和乐器密度；节奏识别工具负责生成后复核。
- 结尾不能突然截断，最好支持 loop、continuation 或应用层 beat 对齐拼接。
- 背景音乐应保持中低前景密度，给口播、环境声和字幕留出空间，而不是追求歌曲级别的高潮和人声表现。

按这个标准，推荐顺序是：

1. **当前硬约束的第一阶段**：MusicGPT 的 MusicGen ONNX 管线。它不是专门的 BGM 模型，但能生成纯音乐片段，最符合 Rust、ONNX、Windows/macOS 和离线要求。
2. **质量对照**：Stable Audio Open。它更偏短音频片段、loop、riff 和 sound bed，背景音乐适配度高，但需要 Python/PyTorch，且没有官方 ONNX/Rust 管线。
3. **连续生成研究方向**：Magenta RealTime 2。它支持流式和 60 秒批量生成，更接近可延展的背景音乐，但 C++ 推理核心明确面向 Apple Silicon，不能作为 Windows/macOS 统一方案。
4. **视频条件研究方向**：CMT 和 SONIQUE。它们直接研究视频到背景音乐的匹配，但依赖旧的 Python/GPU/多模型链路，不进入第一阶段产品方案。

因此，第一版不应强行寻找“直接生成 60 秒完整歌曲”的模型，而应把工具设计成：**生成 15 到 30 秒的纯音乐片段 -> 节奏分析 -> 按 beat/downbeat 延长、循环或拼接 -> 根据视频时长淡入淡出**。这样既适合背景音乐，也能让 MusicGPT 的短时长限制变成可控的应用层能力。

## 调研范围与环境

- 调研日期：2026-09-14
- 调研来源：GitHub 仓库、仓库 README、仓库许可证文件，以及候选项目公开模型卡链接
- 本地开发机：macOS、Apple Silicon arm64、16 GB 统一内存
- 发布平台目标：macOS Apple Silicon 和 Windows x64；Windows ARM64 暂不纳入第一阶段
- 产品当前定位：开源、非商业用途；模型代码、权重和训练数据许可需要分开审计
- 本阶段只做资料调研，不下载模型、不引入依赖、不修改应用功能

GitHub CLI 查询方式：

```bash
gh search repos "music generation" --stars '>200' --language Python --limit 15
gh search repos "beat tracking" --stars '>50' --language Python --limit 15
gh repo view gabotechs/MusicGPT --json licenseInfo,stargazerCount,updatedAt,url
gh api repos/gabotechs/MusicGPT/readme -H 'Accept: application/vnd.github.raw+json'
gh repo view danigb/beat-this-rs --json licenseInfo,stargazerCount,updatedAt,url
gh api repos/danigb/beat-this-rs/readme -H 'Accept: application/vnd.github.raw+json'
gh repo view Stability-AI/stable-audio-tools --json licenseInfo,stargazerCount,updatedAt,url
gh repo view magenta/magenta-realtime --json licenseInfo,stargazerCount,updatedAt,url
gh repo view wzk1015/video-bgm-generation --json licenseInfo,stargazerCount,updatedAt,url
gh repo view zxxwxyyy/sonique --json licenseInfo,stargazerCount,updatedAt,url
gh repo view ace-step/ACE-Step-1.5 --json licenseInfo,stargazerCount,updatedAt,url
gh api repos/ace-step/ACE-Step-1.5/readme -H 'Accept: application/vnd.github.raw+json'
```

仓库星标和更新时间会变化，报告中的结论以项目 README 和许可证内容为准，不以星标数量作为质量证明。

## 一、音乐生成模型

### 1. MusicGen via MusicGPT：严格 Rust/ONNX 候选

仓库：[gabotechs/MusicGPT](https://github.com/gabotechs/MusicGPT)

这是本轮找到的最接近“Rust + ONNX + 跨平台 + 本地”的音乐生成实现：

- 主程序是 Rust，使用 ONNX Runtime 加载 MusicGen 的文本编码器、解码器和 EnCodec 解码器，不要求用户安装 Python 或 PyTorch。
- 仓库发布 macOS Apple Silicon、Windows x64 和 Linux x64 可执行文件；CI 对 Windows 和 macOS 做了构建、单元测试和短音频 smoke test。
- 提供 small、small-quant、small-fp16 等模型配置；ONNX 文件由 `text_encoder.onnx`、`decoder_model_merged.onnx` 或 decoder split 文件、`encodec_decode.onnx`、tokenizer 和 config 组成。
- 支持 CPU；仓库还提供 CoreML 和 CUDA feature。Windows x64 的基础方案应以 CPU 为保底，GPU 加速作为按设备探测的可选路径。
- 当前 CLI 的默认生成长度是 10 秒，最大约 30 秒；这适合先生成短循环或片段，不适合作为一次生成 60 秒以上、结构连续的完整背景音乐。
- 生成模型只支持 MusicGen，尚未覆盖参考旋律、复杂音乐编辑或 ACE-Step 的 BPM/调式/拍号控制。可以在应用层调用节奏识别并做循环/拼接，但不能把拼接结果当成模型原生长曲能力。
- 仓库代码为 MIT，但 README 明确说明下载的 MusicGen 权重是 CC BY-NC 4.0。当前项目是非商业用途，这条路线仍需记录权重许可和训练数据声明，未来若用途变化不能直接沿用。
- MusicGPT 默认会在启动时从 Hugging Face 下载模型。要满足“离线运行”，必须改为应用安装阶段下载并校验，推理阶段只接受本地绝对路径或受控模型目录，禁止模型库自动回退联网。

结论：它是**严格 ONNX/Rust 方案的最佳参考和第一阶段技术验证对象**，但不是当前“最高质量长背景音乐”的最终答案。可以先用 small-quant 做 Windows/macOS 的管线验证；若背景音乐片段质量不合格，再用同一 MCP 接口对照 Stable Audio Open，而不是让 Agent 直接切换运行环境。

### 2. Stable Audio Open：背景音乐片段和 Loop 候选

模型工具仓库：[Stability-AI/stable-audio-tools](https://github.com/Stability-AI/stable-audio-tools)；模型：[stabilityai/stable-audio-open-1.0](https://huggingface.co/stabilityai/stable-audio-open-1.0)

它比 ACE-Step 更接近当前的背景音乐用途：Stable Audio Open 面向短音频样本、乐器片段、鼓组、riff 和 sound bed，模型卡标注最高约 47 秒、44.1 kHz 立体声输出。它适合生成“轻快旅行氛围、低密度钢琴铺底、无主唱电子节奏”这类背景素材，而不是完整歌曲。

- `stable-audio-tools` 提供本地推理入口，也允许从本地模型配置和 checkpoint 加载。
- 仓库代码是 MIT，但模型权重使用单独的 Stability AI 模型许可，不能用代码许可证替代权重条款；发布前必须锁定模型版本并审计条款。
- 上游依赖 Python 3.10、PyTorch 2.5+，README 没有提供 Windows/macOS 的统一预编译 Worker，也没有官方 ONNX/Rust 推理管线。
- 47 秒不是无限延长能力；60 秒以上仍需生成多个片段，或者在应用层按 beat 对齐、交叉淡化和循环。
- “loop”出现在提示词里不等于模型保证首尾无缝，必须由应用计算首尾节奏、波形边界和交叉淡化质量。

结论：它是**背景音乐质量路线最值得做的对照模型**，但不符合当前“复用 Rust/ONNX、Windows/macOS 同一套 Worker”的硬约束。可以在接口层预留，不应让 Agent 自己安装 Python 或临时下载模型。

### 3. Magenta RealTime 2：连续背景音乐候选

仓库：[magenta/magenta-realtime](https://github.com/magenta/magenta-realtime)

Magenta RealTime 2 的定位是开放权重的实时音乐生成，不以完整歌曲为主要卖点。它有 `mrt2_small`（230M）和 `mrt2_base`（2.4B），支持流式生成，文档还提供生成 60 秒片段的批处理脚本。对背景音乐来说，它的“持续生成、可延长、可通过提示词控制风格”比一次性生成歌曲更有价值。

- Apple Silicon 上有 MLX 和 C++ 推理核心；small 模型可在 M 系列 Mac 实时运行，base 模型质量更高但需要更强的 Pro/Max 芯片。
- 文档说明可以离线推理；模型和资源下载完成后不需要在线服务。
- C++ 核心要求 macOS 14+ Apple Silicon，README 明确写明 Windows 不在支持范围内；Python/JAX 路线面向 Linux/NVIDIA 的离线批处理，不能视为 Windows 原生支持。
- 模型资源是 `.mlxfn`、TFLite 和 safetensors，不是 ONNX，不能直接复用当前 `ort` Worker。
- 代码仓库是 Apache-2.0，但开放权重和各模型资源仍需单独记录来源、版本、SHA256 和许可。

结论：它是**Mac 专用的连续 BGM 研究候选**，不是当前 Windows/macOS 产品的统一落地方案。后续若保留平台专用高质量后端，可以与 MusicGen 共用 MCP 接口，但不能把它作为跨平台默认模型。

### 4. ACE-Step 1.5：长音频和歌曲能力候选

仓库：[ace-step/ACE-Step-1.5](https://github.com/ace-step/ACE-Step-1.5)

适合 Luna AI Cut 的原因：

- README 明确支持 macOS Apple Silicon，并提供 MLX 启动脚本；同时也支持 MPS 和 CPU。
- README 同时提供 Windows CUDA、Windows ROCm、Windows CPU 和 macOS Apple Silicon 的启动路径，跨平台覆盖比上一轮评估更明确。
- 支持 10 秒到 600 秒的音频生成，能够覆盖短视频配乐和较长背景音乐。
- 支持文本生成、参考音频、重绘、Cover、Vocal2BGM、音轨分离和多轨生成。
- 支持控制时长、BPM、调式/音阶和拍号。对于“生成一首适合 30 秒或 60 秒视频卡点的配乐”，这些控制比只传一段风格描述更有用。
- 提供 Python 调用方式和 REST API，默认 API 地址为 `localhost:8001`，便于由独立本地 Worker 封装成 MCP 工具。
- 2B DiT 的 README 标注约 4.7 GB 权重；LM 还有 0.6B、1.7B 和 4B 版本。当前 16 GB Apple Silicon 机器建议从 2B turbo、无 LM 或 0.6B LM 开始，实际速度和峰值内存仍需后续基准测试。
- 当前上游代码树包含 PyTorch、MLX 和 API 实现，未找到官方 ONNX 导出模型或 Rust 推理管线；因此不能直接复用现有 `ort` Worker，需要单独维护 Python/MLX 运行时，或另行完成模型转换和数值一致性验证。
- GitHub 仓库为 MIT；ModelScope 的 `ACE-Step/Ace-Step1.5` 模型页也标注 MIT。发布前仍需要固定具体版本、下载文件大小和 SHA256，并核对模型、代码及训练数据声明。

推荐初始配置：

| 项目 | 建议 |
| --- | --- |
| 生成模式 | 纯音乐优先；用户明确需要人声时再开启歌词/人声模式 |
| 时长 | 先按视频目标时长生成，例如 15 秒、30 秒、60 秒 |
| 模型 | 2B turbo |
| LM | 16 GB 机器先关闭；需要更强提示词理解时尝试 0.6B |
| 节拍控制 | 将用户指定 BPM 和拍号传入模型；生成后仍用节奏识别工具复核 |
| 服务方式 | 独立 Python Worker 或本地 REST 服务，不放进 Electron 主进程 |

需要注意：模型 README 中的速度和质量是项目方基准，不能直接等同于本机表现；Apple Silicon 的 MPS/MLX 路径、量化组合和长音频耗时需要实际基准测试后再定默认值。

### 5. DiffRhythm：完整歌曲备选

仓库：[ASLP-lab/DiffRhythm](https://github.com/ASLP-lab/DiffRhythm)

- 偏向完整歌曲生成，提供文本风格、参考音频、歌词和歌曲续写能力。
- README 提供 macOS 部署说明；`base` 模型至少需要 8 GB VRAM，显存不足时使用 `--chunked`。
- README 声明代码和 DiT 权重使用 Apache 2.0，但 VAE、歌词处理和其他附加资源仍应逐项核对。
- 生成长度和歌曲结构比短视频配乐更偏“完整歌曲”，本地服务/API 体验也不如 ACE-Step 1.5 直接。

结论：适合作为完整歌曲生成的对照方案；但本地服务封装和资源组合复杂，不作为当前短视频配乐的第一阶段默认引擎。

### 6. HeartMuLa：人声歌曲备选

仓库：[HeartMuLa/heartlib](https://github.com/HeartMuLa/heartlib)

- 以歌词和标签为主要条件，定位是带人声的多语言歌曲生成。
- README 推荐 3B 模型，当前推理速度约为 RTF 1.0，且提供 `lazy_load` 以降低显存占用。
- README 的安装和设备示例主要围绕 CUDA，没有看到针对 Apple Silicon/MPS 的明确支持说明。
- 仓库和相关模型权重在 README 中声明更新为 Apache 2.0，但依然要锁定具体 checkpoint 和版本后复核。
- README 将参考音频条件列为后续计划，而参考音频对视频配乐风格复用很重要。

结论：更适合有 NVIDIA GPU 的“歌词歌曲生成”场景，暂不作为当前 Mac 本地首选。

### 7. YuE2：能力强但硬件和权重许可不匹配

仓库：[multimodal-art-projection/YuE](https://github.com/multimodal-art-projection/YuE)

- 支持歌词加风格生成、零样本 Cover、可编辑乐谱和对话式编辑，能力范围很完整。
- 当前 README 给出的本地要求是 Linux、Python 3.12、支持 BF16 的 NVIDIA GPU，建议 24 GB VRAM。
- 仓库代码、Skill 和文档为 Apache 2.0，但模型权重单独为 CC BY-NC 4.0。

结论：当前 16 GB Apple Silicon 开发机不适合作为本地第一阶段依赖；只有在明确接受非商业权重限制并准备 NVIDIA 运行环境后再评估。

### 8. MusicGen / AudioCraft：研究原型备选

仓库：[facebookresearch/audiocraft](https://github.com/facebookresearch/audiocraft)

- MusicGen 提供 small、medium、large 等规模，文本和旋律条件比较成熟。
- 仓库代码是 MIT，但 README 明确说明模型权重是 CC BY-NC 4.0，不能把代码许可证当成权重许可证。
- PyTorch 依赖较重；官方文档对 medium 的 GPU 内存要求较高，不适合作为当前桌面应用的默认本地服务。

结论：适合研究对比和原型实验，不建议作为 Luna AI Cut 第一阶段的发布集成方案。

### 9. OpenMusic / QA-MDT：长音频研究候选

仓库：[ivcylc/OpenMusic](https://github.com/ivcylc/OpenMusic)

- QA-MDT 是文本到音乐研究模型，仓库宣称已经以 zero-shot 方式扩展到 infinite-length music generation。
- 它更适合做长背景音乐的研究对照，不能把论文中的长音频扩展能力直接当成稳定的产品 API。
- 官方实现是 Python/PyTorch，依赖 AudioLDM、PixArt、T5、CLAP 等组件，没有官方 ONNX/Rust 推理管线，也没有 Windows/macOS 统一发布包。

结论：值得关注，但当前只能作为质量研究候选，不进入第一阶段 Worker。

### 10. CMT 和 SONIQUE：视频条件 BGM 研究参考

#### CMT

仓库：[wzk1015/video-bgm-generation](https://github.com/wzk1015/video-bgm-generation)

- 这是少数直接以“视频背景音乐生成”为目标的公开研究实现，会从视频运动和节奏关系生成条件音乐。
- 输出主要是 MIDI，需要再通过 GarageBand、FluidSynth 和音源渲染成音频；它不是端到端的 ONNX 音频生成模型。
- README 要求 Python、旧版 FFmpeg 和 GPU，视频建议短于 2 分钟；跨平台桌面发布和 CPU 回退没有被验证。

#### SONIQUE

仓库：[zxxwxyyy/sonique](https://github.com/zxxwxyyy/sonique)

- 目标也是根据视频内容生成背景音乐，支持乐器、风格、速度和旋律条件。
- 它串联 Video-LLaMA、Mistral/Qwen/Gemma 和 `stable-audio-tools`；README 标注 NVIDIA 4090 约需 14 GB GPU，3070 Laptop 也需要数分钟。
- 整条链路依赖 Python、多个模型和 GPU，没有 Windows/macOS 统一本地 Worker，也没有官方 ONNX/Rust 管线。

结论：CMT/SONIQUE 证明“视频内容 -> 音乐标签 -> BGM”是可行方向，但不适合作为当前应用的基础依赖。Luna 应在应用侧提供轻量的视频摘要或用户指定风格，再调用统一的音乐生成工具，不把整套视频理解模型塞进音乐 Worker。

### 11. MusicLDM 和 Mustango：短片段控制型备选

- [MusicLDM](https://github.com/RetroCirce/MusicLDM) 的仓库示例直接使用 `theme loop` 提示词，适合验证短背景片段；但公开实现主要是 16 kHz、10 秒生成，许可证为 CC BY-NC-SA，依赖 Python/Conda 和 GPU。
- [Mustango](https://github.com/AMAAI-Lab/mustango) 可通过文字描述乐器、节奏和速度，生成 16 kHz 音频片段；它基于 LDM、Flan-T5 和 PyTorch，没有官方 ONNX/Rust 管线。

结论：两者在“短 BGM 片段”语义上比歌曲模型更接近，但音频规格、运行环境和许可证都不如 MusicGen ONNX，保留为研究对照，不作为跨平台默认方案。

### 音乐生成候选对比

| 候选 | 当前机器可行性 | 适合场景 | 主要风险 | 建议 |
| --- | --- | --- | --- | --- |
| MusicGen via MusicGPT | 高，已有 Rust/ONNX 和 Windows/macOS 构建 | 短循环、短视频配乐原型 | 30 秒上限、质量和权重许可 | 严格 ONNX 路线先验证 |
| Stable Audio Open | 未确认，Python/PyTorch 本地运行 | 纯音乐片段、loop、riff、sound bed | 约 47 秒上限、无官方 ONNX/Rust、模型条款独立 | 背景音乐质量对照 |
| Magenta RealTime 2 | Mac 高，Windows 不支持 | 连续生成、可延长、实时 BGM | 原生只支持 Apple Silicon，模型不是 ONNX | Mac 专用研究候选 |
| ACE-Step 1.5 | Windows/macOS 有本地路径，但非 Rust/ONNX | 长音频、参考音频、可控 BPM | 上游没有官方 ONNX/Rust 管线，歌曲能力偏重 | 质量路线备选 |
| OpenMusic / QA-MDT | 未确认，Python/PyTorch | 长音频研究、文本到音乐 | 论文能力未等同于稳定产品，依赖复杂 | 后续研究 |
| MusicLDM / Mustango | 低，Python/GPU，约 10 秒片段 | 短 BGM、主题 loop、乐器/节奏控制 | 16 kHz、无官方 ONNX/Rust、许可证需审计 | 研究对照 |
| DiffRhythm | 中，提供 macOS 说明 | 完整歌曲、歌曲续写 | 服务封装和资源组合较复杂 | 后续候选 |
| HeartMuLa | 未确认，文档主要面向 CUDA | 歌词、人声歌曲 | 3B 模型、Apple 支持不明确 | NVIDIA 环境再评估 |
| YuE2 | 低，README 要求 Linux/NVIDIA/24 GB VRAM | 歌曲、Cover、乐谱编辑 | 权重 CC BY-NC 4.0 | 暂不接入 |
| MusicGen | 中低，PyTorch 较重 | 研究和旋律条件生成 | 权重 CC BY-NC 4.0 | 仅作对照 |
| CMT | 低，要求 GPU/Python，并输出 MIDI | 视频条件 BGM、节奏和运动匹配 | 旧依赖、需要音源渲染、不是 ONNX | 研究参考 |
| SONIQUE | 低，4090 约需 14 GB GPU，且是多模型链路 | 视频条件 BGM、乐器/风格/速度控制 | Video-LLaMA + LLM + diffusion，未提供统一跨平台包 | 暂不接入 |

## 二、音频节奏识别工具

### 1. beat-this-rs：跨平台 Rust/ONNX 第一候选

仓库：[danigb/beat-this-rs](https://github.com/danigb/beat-this-rs)

这是本轮对当前需求最匹配的节奏识别实现：

- Rust 封装完整的 Beat This 管线，输入音频后完成重采样、mel 特征、ONNX 推理和 beat/downbeat 后处理。
- 默认使用 `rten` 纯 Rust 推理后端，不依赖系统动态库；同时提供可选 `ort` 后端，便于与 Luna 当前的 ONNX Runtime 统一。
- README 的 CI 覆盖 Linux、Windows 和 macOS；模型为 ONNX，仓库自带约 10 MB 的 small 模型，完整 FP32 模型约 83 MB。
- 可输出 JSON、`.beats`、click track 和混音结果；JSON 示例包含 beat、downbeat 和 BPM。
- 内部对 30 秒音频窗口做重叠推理，并进行峰值去重、downbeat 对齐；长音频策略与本报告前面的分片设计一致。
- `Cargo.toml` 要求 Rust 1.89+，当前本地 Rust 为 1.96，版本条件满足。
- 仓库的 README、Cargo manifest 和 LICENSE 声明 MIT；GitHub API 的许可证字段显示为 Other，因此正式纳入 Luna 前仍需把 LICENSE 原文和上游 Beat This 许可一起放入第三方声明。

结论：优先复用其**算法实现和 ONNX 模型结构**，再决定使用 `rten` 还是当前 `ort`。如果目标是最少平台运行时问题，`rten` 更简单；如果目标是统一当前模型的硬件加速和加载方式，使用 `ort` 后端更一致。

### 2. Beat This：Python 原始实现

仓库：[CPJKU/beat_this](https://github.com/CPJKU/beat_this)

- 官方实现的神经网络节拍器，直接输出 beat 和 downbeat 时间戳。
- 官方模型会自动下载，也提供 `final0` 等完整模型和 `small0` 等小模型。README 标注完整模型约 78 MB，小模型约 8.1 MB。
- 代码和发布模型使用 MIT；训练数据、标注和第三方依赖仍需按发布范围核对。
- 输出时间戳可以直接转换为剪辑卡点：beat 用于普通切点，downbeat 用于段落或镜头组切换。
- 该项目本身主要输出 beat/downbeat，不应把模型推断出的 BPM 当作绝对真值；BPM 可以由节拍间隔统计得到，并同时返回稳定性或置信度信息。

结论：作为 beat-this-rs 的官方 Python 结果对照和回归基准。正式 Worker 优先使用 beat-this-rs，第一版可使用其 small 模型，在资源允许时切换完整 FP32 模型。

### 3. BeatNet：需要 tempo/meter 的备选

仓库：[mjhydri/BeatNet](https://github.com/mjhydri/BeatNet)

- 联合输出 beat、downbeat、tempo 和 meter。
- 支持 stream、realtime、online 和 offline 模式，适合以后做实时监听或拍号分析。
- 仓库许可证标注 CC BY 4.0。
- 依赖链中包含较老版本的 `madmom` 和音频输入依赖；README 已提示 Python/NumPy 兼容性问题，集成维护成本高于 Beat This。

结论：当产品确实需要 meter 或实时模式时再做对比，不作为第一版默认实现。

### 4. librosa：轻量兜底

仓库：[librosa/librosa](https://github.com/librosa/librosa)

- ISC 许可证，安装简单，提供传统信号处理的 `beat_track`，可以返回 tempo 和 beat 索引。
- 不依赖预训练模型，适合模型不可用、音频很短或需要快速预分析的兜底路径。
- 对变速、现场录音、鼓点不明显或复杂编曲，稳定性通常不如 Beat This。

结论：保留为 Worker 的 fallback，不单独作为主要卡点算法。

### 5. aubio：轻量原生工具，但许可证不适合直接集成

仓库：[aubio/aubio](https://github.com/aubio/aubio)

- C 库，支持 macOS、Windows、iOS，包含 `aubiotrack` 节拍时间戳和 `aubiocut` 按节拍切分。
- GPL-3.0 许可证会给桌面应用的链接、发布和再分发带来额外合规要求。

结论：可以作为外部命令行工具的技术参考，不建议第一阶段直接链接到 Luna 应用。

### 6. madmom、Essentia 和 beat_this_cpp

- [CPJKU/madmom](https://github.com/CPJKU/madmom)：源码许可证与模型/数据许可证不同，部分资源为 CC BY-NC-SA 4.0；依赖较老，暂不优先。
- [MTG/essentia](https://github.com/MTG/essentia)：C++ 能力完整，支持大量音乐信息检索，但 AGPL-3.0 会增加应用集成风险。
- [mosynthkey/beat_this_cpp](https://github.com/mosynthkey/beat_this_cpp)：MIT 的非官方 Beat This C++ 移植，适合后续研究原生 Worker；在确认准确率、模型权重来源和平台稳定性前，不能替代官方 Python 实现。

### 节奏识别候选对比

| 候选 | 输出 | 本地集成 | 许可证/风险 | 建议 |
| --- | --- | --- | --- | --- |
| beat-this-rs | beat、downbeat、BPM 时间戳 | Rust + ONNX，默认纯 Rust，可选 ORT | README/LICENSE 为 MIT；需保留上游声明 | 第一阶段接入 |
| Beat This Python | beat、downbeat 时间戳 | Python/PyTorch，CPU 可回退 | MIT；需审计权重和数据 | 结果对照 |
| BeatNet | beat、downbeat、tempo、meter，多种模式 | Python，依赖较老 | CC BY 4.0；维护成本较高 | 需要 meter 时再评估 |
| librosa | tempo、beat 索引 | 轻量 Python | ISC，无模型 | fallback |
| aubio | beat/onset 时间戳、切分 | C/命令行，跨平台 | GPL-3.0 | 不直接集成 |
| madmom | beat/downbeat 等 | Python，老依赖 | 模型/数据含 NC-SA 风险 | 暂不接入 |
| Essentia | 丰富 MIR 特征 | C++/Python | AGPL-3.0 | 暂不接入 |
| beat_this_cpp | 目标是 Beat This 的原生移植 | C++ + ONNX Runtime | MIT，但非官方 | 仅作对照 |

## 三、建议提供给 Agent 的两个工具

工具名称可以保持面向任务的语义，Agent 不需要知道底层是哪个 Python 包。

### `generate_music`

用途：根据用户描述生成本地背景音乐素材，供时间线或预览使用。默认按纯音乐、低前景密度、可延长方向处理。

建议输入：

```json
{
  "purpose": "background_music",
  "prompt": "轻快、明亮、适合旅行短片的纯音乐",
  "negativePrompt": "人声、演唱、歌词、旁白、说话、突然结束",
  "durationSec": 30,
  "targetDurationSec": 60,
  "instrumentalOnly": true,
  "loopRequested": true,
  "energy": "steady",
  "bpm": 120,
  "timeSignature": "4/4",
  "referenceAudioPath": null,
  "seed": null,
  "variants": 1,
  "modelId": "auto",
  "offlineOnly": true
}
```

建议返回：

```json
{
  "taskId": "music-task-id",
  "audioPath": "/local/path/generated.wav",
  "durationSec": 30,
  "targetDurationSec": 60,
  "sampleRate": 44100,
  "channels": 2,
  "requestedBpm": 120,
  "measuredBpm": 119.8,
  "loopScore": 0.82,
  "assembly": "beat_aligned_extend",
  "model": "musicgen-small-quant",
  "runtime": "ort",
  "offline": true,
  "status": "completed"
}
```

实现要求：

- 支持任务进度、取消和失败原因，不能让 MCP 调用无限阻塞。
- 生成完成后由应用复制或登记到项目的本地资源目录，不能只返回模型临时目录路径。
- `durationSec` 表示模型本次实际生成的片段长度，`targetDurationSec` 表示最终希望覆盖的时间线长度；两者不能混用。
- `purpose=background_music` 时自动加入禁止人声、歌词、旁白和突然结束的约束，并优先使用稳定、中低密度的音乐结构。
- `loopRequested=true` 只是请求应用寻找可循环边界；只有经过首尾波形、节拍和能量检查后，才返回较高的 `loopScore`，不能把模型提示词当成无缝保证。
- `assembly` 记录最终是单片段、beat 对齐循环、重叠交叉淡化还是多片段拼接，便于 Agent 知道成片不是一次生成的完整歌曲。
- `requestedBpm` 和 `measuredBpm` 分开返回；生成模型可能不能完全遵守 BPM。
- `modelId` 只允许选择应用已安装且 manifest 校验通过的模型；`auto` 由应用按平台和可用内存选择。
- `offlineOnly=true` 时，如果模型或运行时未安装，直接返回未安装状态，禁止静默访问网络。
- 默认优先纯音乐，用户明确要求人声或歌词时再启用相应模式。
- 首次安装、模型下载、运行时准备由应用统一管理，Agent 只调用工具，不自行下载依赖。

### `analyze_audio_rhythm`

用途：分析用户提供的音乐，返回剪辑可直接使用的 beat/downbeat 时间轴。

输入只接受项目内已登记的 `mediaId` 或应用解析后的本地文件路径，不接受 HTTP/HTTPS 音频地址。Worker 使用 Rust 音频解码或应用已打包的 FFmpeg，不能在任务过程中下载音频或模型。

建议输入：

```json
{
  "audioPath": "/local/path/music.mp3",
  "startSec": 0,
  "endSec": null,
  "chunkDurationSec": 90,
  "overlapSec": 4,
  "includeDownbeats": true
}
```

建议返回：

```json
{
  "status": "completed",
  "durationSec": 182.4,
  "bpm": 122.1,
  "beats": [0.49, 0.98, 1.47],
  "downbeats": [0.49, 2.45, 4.41],
  "confidence": 0.91,
  "model": "beat-this-small",
  "runtime": "rten",
  "offline": true,
  "chunks": [
    { "startSec": 0, "endSec": 90, "overlapSec": 4, "status": "completed" },
    { "startSec": 86, "endSec": 182.4, "overlapSec": 4, "status": "completed" }
  ],
  "warnings": []
}
```

## 四、长音频分片策略

不能因为视频或音乐很长，就把完整文件一次性读入内存。建议由 Worker 统一做音频解码和分片：

1. 先读取音频元数据；短于阈值的文件直接一次分析。
2. 长文件按 60 到 120 秒切片。默认可从 90 秒开始，后续用真实素材调整。
3. 每个分片前后保留 2 到 4 秒上下文；上下文用于稳定模型的首尾节拍判断，不直接重复输出。
4. 分片结果统一转换成原始音频的绝对时间。
5. 合并相邻分片时，丢弃 overlap 区间中重复的 beat，并依据相邻节拍间隔做去重和相位对齐。
6. 如果相邻分片的 BPM 或节拍相位差异过大，返回 warning 和分片边界，不能静默拼成一条看似准确的时间轴。
7. Agent 进行卡点剪辑时，优先使用 downbeat 做段落切换，使用 beat 做镜头内部切点；镜头起止点还应保留可配置的前后补偿，避免画面或声音突然断开。

这里的“前后补偿”应区分两种情况：

- **识别补偿**：分片输入多读几秒，保证边界处能识别完整节拍；输出时去掉重叠区重复结果。
- **剪辑补偿**：最终使用某个 beat 作为切点时，视频片段可以向前或向后扩展指定毫秒，再通过转场、音频淡入淡出或 J-cut/L-cut 消除断层。

## 五、跨平台 Rust/ONNX 运行时复审

### 1. 当前仓库可以复用的基础

- 当前本机 Rust/Cargo 为 1.96，能够满足 `beat-this-rs` 的 Rust 1.89+ 要求。
- `luna-render-core/Cargo.toml` 已使用 `ort = 2.0.0-rc.12`、Rust Worker 和 ONNX 模型；现有字幕、分割、追色等 Worker 已证明“Rust 进程 + JSON 行协议 + ONNX 文件”的组织方式可复用。
- `scripts/setup-rust.mjs` 已覆盖当前平台和 `x86_64-pc-windows-msvc` target；`scripts/build-native.mjs` 已有 Windows DLL、macOS dylib 和 Worker 的复制/打包逻辑。
- 现有模型下载服务已经做文件大小、SHA256、断点下载和缓存校验，音乐/节奏模型应接入同一套受控流程。
- 当前 `ModelDefinition` 主要描述单个 `model.onnx` 文件；MusicGen 需要多个 ONNX 文件、tokenizer、config 以及可能的 `.onnx_data` 外部数据，不能直接套用单文件模型定义，应增加“模型包 manifest”概念。

### 2. 执行提供程序建议

| 平台 | 必须可用的保底路径 | 可选加速路径 | 备注 |
| --- | --- | --- | --- |
| macOS Apple Silicon | Rust `rten` 或 ONNX Runtime CPU | ONNX Runtime CoreML | ONNX Runtime 没有通用的 MPS 路径；CoreML 是否接管完整图需要逐模型验证 |
| Windows x64 | Rust `rten` 或 ONNX Runtime CPU | DirectML；NVIDIA 机器可选 CUDA | 不能把 CUDA 当作 Windows 的最低要求；DirectML/CPU 才能覆盖更广硬件 |
| Windows ARM64 | 暂不承诺 | 暂不承诺 | 当前项目的发布和构建目标是 Windows x64，后续单独验证 |

当前 Luna 的 `ort` 依赖已启用 `download-binaries` 和 `copy-dylibs`，但没有显式启用 CoreML 或 DirectML feature。后续如选择 ORT 加速，必须按平台构建对应运行时并做能力探测：

```text
macOS: CoreML -> CPU
Windows: DirectML -> CUDA（如果对应运行时和驱动可用） -> CPU
```

如果某个 Execution Provider 注册失败，必须自动回退到 CPU，并把实际 backend 返回给 MCP 任务状态；不能因为 GPU 不可用就让本地工具不可用。`rten` 方案可以消除运行时 DLL/动态库问题，但失去 ORT 的 CoreML、DirectML 和 CUDA 加速，应该通过统一的 `Runtime` 抽象保留切换能力。

### 3. 两类模型的落地判断

#### 节奏识别

`beat-this-rs` 与当前 Rust/ONNX 环境的契合度最高：

```text
音频解码（Rust）
  -> 重采样/mono（Rust）
  -> mel_spectrogram.onnx
  -> beat_this*.onnx
  -> beat/downbeat/BPM 后处理（Rust）
```

优先顺序建议是：

1. 先以 `rten` 后端验证 Windows/macOS 的纯 Rust 结果和性能。
2. 再把同一组 ONNX 模型接入当前 `ort` 运行时，验证 CPU、CoreML 和 DirectML 的输出一致性。
3. 只有两个后端在时间戳误差范围内一致，才允许按设备自动选择 backend。

#### 音乐生成

MusicGen ONNX 并不是一个“一次调用即可得到 WAV”的单图模型，至少需要：

```text
文本 tokenizer
  -> text_encoder.onnx
  -> autoregressive decoder ONNX（逐 token、KV cache、采样）
  -> delay pattern / codebook 处理
  -> encodec_decode.onnx
  -> WAV/MP3 输出
```

`MusicGPT` 已经实现了这条 Rust 管线，可以作为移植参考；但它使用的 `ort` 版本是 `2.0.0-rc.9`，当前 Luna 是 `2.0.0-rc.12`，不能直接复制依赖和模型调用代码。后续应统一到当前版本，并逐项做 ONNX 输入输出和生成结果回归。

ACE-Step 1.5 则需要保留独立的 Python/MLX Worker，或者另行维护 ONNX 导出工程。由于它包含扩散采样、VAE 和可选 LM，转换后还要验证长音频、参考音频、BPM 和生成质量，不能把“能导出 ONNX”作为近期落地路径。

### 4. 离线模型包要求

“本地模型”应理解为**推理时不联网**，而不是 Agent 每次调用时临时下载：

- 首次安装或用户在设置中安装模型时，由 Luna 统一下载到本地并校验。
- 下载完成后，Worker 只接受本地 manifest 和文件路径；模型库的自动下载、在线回退和远程 URL 必须关闭。
- 模型包记录 `modelId`、版本、文件清单、每个文件的大小和 SHA256、代码/权重/数据许可证及来源。
- 任务结果写入项目资源目录或应用管理的音频缓存，不能依赖 Python、Rust Worker 或模型库的临时目录。
- 断网启动时，已有模型可以正常运行；缺模型时返回“未安装”状态，而不是尝试访问网络。

## 六、建议的本地运行架构

不要把 PyTorch、MLX 或音频模型直接加载到 Electron 主进程。建议拆成应用管理的本地 Worker：

```text
MCP Agent
   |
   | generate_music / analyze_audio_rhythm
   v
Luna Electron 主进程
   |
   | 启动、复用、取消、监控
   v
本地 AI Audio Worker
   |- MusicGen ONNX / MusicGPT（严格 Rust/ONNX 音乐生成）
   |- Stable Audio Open（背景音乐质量对照，可选 Python/PyTorch Worker）
   |- Magenta RealTime 2（Mac 专用连续 BGM，可选 MLX/C++ Worker）
   |- ACE-Step 1.5（长音频/歌曲质量路线，可选 Python/MLX Worker）
   |- beat-this-rs（Rust + ONNX 节奏识别）
   |- librosa（兜底）
   |- ffmpeg/本地音频解码
   v
项目资源目录 / 模型缓存目录
```

建议 Worker 契约：

- `health`：运行时和模型是否可用
- `generateMusic`：异步生成、进度、结果路径
- `analyzeRhythm`：异步分片分析、进度、节拍结果
- `cancelTask`：取消排队或正在执行的任务
- `getTask`：恢复和查询任务状态
- `getModelStatus`：已安装版本、文件完整性和 SHA256

下载和发布方面需要遵守项目现有规则：模型二进制不提交到代码仓库、不打进安装包；应用发布的模型必须有固定版本、来源、许可证和 SHA256。ACE-Step 可优先评估 ModelScope 版本；Beat This Rust 模型当前来自 `beat-this-rs` 仓库内的小模型或其 Release 中的完整模型，若要做应用内托管或镜像，需要先确认再分发许可、文件哈希和国内下载源方案。

## 七、推荐落地顺序

1. 先固定 `beat-this-rs` small/FP32 两个 ONNX 模型，验证 Windows x64 和 macOS arm64 的时间戳一致性、长音频分片和 CPU 性能。
2. 将节奏识别接入当前 Rust Worker 和模型包 manifest；先使用 `rten`，再验证当前 `ort` 的 CPU/CoreML/DirectML 回退链路。
3. 以 MusicGPT 的 MusicGen ONNX 管线为原型，统一 `ort` 到当前 `2.0.0-rc.12`，只允许从本地 manifest 加载，验证 10/30 秒纯音乐片段、取消、断网运行和音频输出。
4. 用同一组 BGM 提示词比较 MusicGen ONNX 与 Stable Audio Open；在 macOS 上额外记录 Magenta RealTime 2 的连续生成表现，分别比较前景密度、循环质量、节拍稳定性和人声泄漏。
5. 实现背景音乐的应用层编排：生成短片段、分析节奏、按 beat/downbeat 拼接、交叉淡化、控制最终响度，并将片段长度和目标时间线长度分开记录。
6. 实现统一 MCP Worker 契约，Agent 不直接接触 Python 命令、模型下载或临时目录；若未来接入 ACE-Step，只作为可替换质量后端。
7. 加入音乐生成的本地资源落盘、节奏识别的长音频 overlap 去重，以及任务进度、取消和断点状态恢复。
8. 将节奏结果转换为 OpenReel 可使用的卡点标记，再评估视频片段前后补偿和音频转场。

## 八、许可证和发布前检查清单

- 代码许可证、模型权重许可证、训练数据许可证分别记录。
- 锁定仓库 commit、模型版本、文件大小和 SHA256。
- 检查模型是否允许当前的开源非商业用途，以及是否包含额外的署名、限制或使用条款。
- 不把 GitHub/Hugging Face 的临时下载地址直接写入客户端；使用项目规定的 ModelScope 或 Luna GitCode 资源流程。
- 记录模型输出的版权和风格相似性风险提示，尤其是用户提供参考音频或要求模仿具体艺人时。
- 完成真实素材基准测试后再决定默认模型、分片长度和超时值。
