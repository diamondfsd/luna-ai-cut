# AI 视频包装调研与 30 秒旅行短片方案

> 调研日期：2026-09-14
>
> 范围：基于本次外部 Agent 复盘，以及当前 `vendor/openreel` 的 MCP registry、core 类型、渲染器和 Luna 嵌入宿主代码，研究如何把已有的剪辑与动效能力组合成更完整的旅行短片包装。本文件记录调研结论、已落地的 skill/prompt/MCP 改进和后续实现建议。

## 结论摘要

本次成片的问题不是 OpenReel 缺少特效原语，而是当前剪辑 skill 没有把这些原语组合成一个默认包装流程。复盘中的成片是 29 秒、9 个镜头、2 条轨道、1 条简单标题，只有两处 `crossfade`；没有冷开钩子、标题层级、标题背景/压暗、镜头运动、统一调色、速度设计或声音层次。结果自然是“素材拼起来了”，但不像一个经过包装的短片。

建议把旅行短片的默认包装定义为以下五层：

1. **叙事层**：前 0.7 秒先放最有吸引力的动作或景别，之后再解释日期/主题。
2. **图形层**：一个主标题加一个可选副标题，配半透明压暗或色块和一条强调线，形成完整标题组件。
3. **运动层**：只给少数关键镜头做轻微 push-in、pull-out 或照片 Ken Burns，避免每段都摇晃。
4. **统一层**：先用轻量曝光、对比度、饱和度或温度调整统一素材，再对夜景等问题镜头局部修正。
5. **节奏层**：硬切承担大多数镜头变化，转场只标记场景变化；现场声、音乐、淡入淡出共同完成进入和收束。

最优先的工程补强不是 3D，而是：**可执行的标题组合 recipe、关键帧和调色指引、写后状态校验，以及 Luna 嵌入宿主的普通时间线预览/导出闭环**。如果不能可靠看到片头和成片，Agent 即使会调用更多工具，也无法判断包装是否真的变好。

## 1. 复盘问题诊断

复盘来源：`/Users/zhouchao/WorkBuddy/2026-09-14-09-39-08/luna_对话导出_复盘_20260914_095827.md`。

| 表现 | 复盘证据 | 根因 | 包装修复方向 |
| --- | --- | --- | --- |
| 开头略微简单 | 29 秒成片从普通镜头开始；没有专门的 hook、冷开、片头节奏或画面运动 | 现有 skill 只说“开头用最有吸引力的画面”，没有定义前 0.7 秒、标题延迟进入和主镜头层级 | 先冷开动作/高潮，再以标题组件解释“何时/什么主题”；首镜头加极轻 push-in |
| 标题没有包装 | 只调用了 `create_text_clip`，标题为 `8.29 出游记`，没有复杂 style/animation | Agent 知道“可以加文字”，但不知道要组合样式、入场动画、遮罩、强调线和副标题 | 主标题 + 可选副标题 + scrim/色条 + `slide-up`/`fade`；标题出现时不挡主体 |
| 全片效果弱 | 没有照片、音乐设计、镜头运动、标题层级、调色策略或声音包装 | 只完成了素材拼接和两处 `crossfade`，没有在剪辑完成后进行包装 pass | 剪辑 pass 后单独执行 visual/audio packaging pass，并限制每类效果的数量 |
| 节奏像等长拼接 | 多数镜头约 3 秒 | 按素材或批量调用推进，缺少“定场、动作、细节、高潮、收束”的时长分配 | 30 秒拆成 hook、定场、活动组、场景变化、高潮、收束；镜头长度由信息量和动作决定 |
| 效果可能没有被真正验证 | 导出返回 `Job 'exportVideo' is not wired in the live host yet` | 时间线可以自动保存不等于生成了可观看的视频；当前普通时间线没有可用的 MCP 任意时间预览 | 在宿主接线前明确报告“未导出”；补齐普通时间线 preview/export 后才允许视觉验收 |
| 修改链存在状态风险 | `add_clip` 默认加入完整源素材；首次批量 trim 出现异常 | 片段位置、源素材入出点和 duration 未在每次写入后严格核对 | trim、标题、效果、转场等写入后立即 `list_clips`/`get_clip` 校验，异常时停止继续写 |

本次应把“包装”视为剪辑完成后的一个明确阶段，而不是在创建第一个 `add_clip` 时顺手加一条文字：

```text
素材证据 -> 叙事剪辑 -> 时间线校验 -> 包装设计 -> 视觉/音频校验 -> 导出/报告
```

## 2. 已具备但 skill 未指导如何组合的能力

以下能力在当前仓库已经存在。缺口主要是组合规则、默认参数、适用时机和失败降级，而不是工具数量。

### 2.1 Text style / animation：从一条文字变成标题组件

**现有能力**

- `create_text_clip`（`vendor/openreel/packages/agent/src/registry.ts:15634`）接收 `{ clip: { text, startTime, duration, style?, trackId?, animation? } }`，必要时自动创建文字轨道。
- `update_text_clip`（同文件约 `:15688`）可以更新 `text`、`style`、`animation`、`transform`，并可通过 `animationInSec` / `animationOutSec` 明确入出场时长。
- `TextStyle`（`vendor/openreel/packages/core/src/text/types.ts:61`）已有字体、字号、字重、颜色、描边、阴影、对齐、行高、字距和背景等字段。
- `TextAnimationPreset`（同文件约 `:116`）已有 `fade`、`slide-up/down/left/right`、`scale`、`blur`、`pop`、`typewriter`、`word-by-word`、`rise`、`drop`、`elastic`、`zoom-blur`、`cascade` 等预设。

**当前 skill 的组合缺口**

现有 skill 只说“使用 `create_text_clip` 的可用入场动画和安全区样式”，没有告诉 Agent：标题应该在 hook 之后进入、主副标题如何错开、什么样式对应旅行片、何时用 `update_text_clip` 补齐动画时长，也没有区分“普通时间线轻包装”和“Motion Creator 标题场景”。因此 Agent 选择了最小合法调用，得到一条没有设计层级的文字。

**推荐组合**

```text
create_text_clip
  -> 主标题：白色/高对比、较粗、左下或安全区
  -> animation: slide-up 或 fade
update_text_clip
  -> 明确 animation.inDuration=0.35、outDuration=0.25
  -> 可选副标题：延迟 0.12-0.20 秒，字号约主标题的 0.35-0.5
create_shape_clip + update_shape_clip
  -> 标题下方半透明 scrim 或强调条
```

主时间线默认只使用一种入场动画和一种字面层级。`bounce`、`glitch`、`rainbow`、`shake` 等应由内容或用户风格明确触发，不能因为“丰富”而默认使用。

### 2.2 Shape overlay：标题可读性和场景转折的图形层

**现有能力**

- `create_shape_clip`（`vendor/openreel/packages/agent/src/registry.ts:15722`）接收 `{ clip: { shapeType?, startTime, duration, color?, opacity?, fullFrame?, trackId? } }`，形状会渲染在视频和图片轨道之上。
- `update_shape_clip` 支持 `color`、`opacity`、`style`、`transform`、`fullFrame`，适合创建后再精确设定形状样式。
- capability manifest 的 `shapeTypes`、`motion.maskShapes` 和 `motion` 图层能力可以通过 `get_capabilities` 查询，不能凭记忆假定某个 shape id 一定可用。

**可组合的三个用途**

1. **标题 scrim**：黑色或主题色矩形，透明度约 0.15-0.30，覆盖标题后方但不把画面压成黑场。
2. **强调条**：窄色条与标题同起点或延迟 0.1 秒出现，用来建立视觉锚点；不要每个字幕都加。
3. **短场景遮罩**：白天到夜景可用短 `dipToBlack`，必要时配 0.15-0.25 秒的全帧 shape；不能把 shape 当成常驻滤镜。

如果主时间线 shape 的定位字段在当前 host 中不够精确，标题组件可升级为 Motion composition：Motion 的 shape layer 支持更细的填充、描边、圆角和关键帧。

### 2.3 `set_clip_transform` + keyframes：让静态镜头有可控呼吸

**现有能力**

- `set_clip_transform`（`vendor/openreel/packages/agent/src/registry.ts:15537`）支持 position、scale、rotation、opacity、crop、fitMode 等 transform 字段。
- `add_keyframe`、`set_clip_keyframes`（同文件约 `:15618-15620`）可为片段属性写入关键帧。
- `Transform` 类型（`vendor/openreel/packages/core/src/types/timeline.ts:172`）还定义了 anchor、rotate3d、perspective 等更丰富字段。
- 普通视频渲染器实际明确使用的关键帧属性包括 `opacity`、`position.x`、`position.y`、`scale.x`、`scale.y`、`rotation`，见 `vendor/openreel/packages/core/src/video/video-engine.ts:2728`；Canvas 预览使用同一组核心属性，见 `vendor/openreel/apps/web/src/components/editor/preview/canvas-renderers.ts:461`。

**推荐组合**

- 运动镜头：`scale.x/y` 从 1.00 到 1.04-1.06，持续 2-4 秒；动作主体已经快速移动时不要再加明显位移。
- 定场远景：中心轻微 `scale` 1.00 -> 1.03，作为开头 hook 的视觉呼吸。
- 照片：`position.x/y` 与 `scale.x/y` 同时变化，做 2.5-4 秒 Ken Burns；每张照片只用一个方向，避免画面漂移。
- 片尾：用 `opacity` 关键帧 1 -> 0 做 0.25-0.45 秒收束；这是视频画面的 fade，不能误用音频 fade 工具。

关键帧时间必须使用 clip-local time。写入前先用 `get_clip` 或 `list_clips` 读取片段 duration、inPoint、outPoint；片段被 `set_clip_speed` 改速后要重新计算 duration，再写关键帧。对普通视频只使用已被 `video-engine.ts` 和 Canvas renderer 验证的属性，`rotate3d` / `perspective` 不能仅凭类型存在就视为普通时间线已可靠渲染。

### 2.4 Video effects / color grading：统一画面，不是每段套滤镜

**现有能力**

- `add_video_effect`（`vendor/openreel/packages/agent/src/registry.ts:15543`）支持 `brightness`、`contrast`、`saturation`、`blur`、`sharpen`、`vignette`、`grain`、`temperature`、`tint`、`shadow`、`glow`、`motion-blur`、`radial-blur`、`chromatic-aberration` 等标准效果。
- 同一工具还支持 `effectType: "shader"`，但要求通过 `list_motion_shaders` 找到合法的 effect shader id，且 WebGL2 不可用时会优雅 no-op。
- `update_video_effect`、`toggle_video_effect`、`remove_video_effect`、`set_effect_order` 可维护效果栈。
- `set_color_grading`（同文件约 `:15599`）支持 wheels、curves、lut、hsl、temperature、tint；结构定义见 `vendor/openreel/packages/core/src/video/color-grading-engine.ts:37`。
- `get_capabilities` 返回 `videoFilterTypes`、`effects`、`colorGrading`，应作为本次设备/版本能力的事实来源。

**推荐组合**

1. 先做跨素材统一：轻微亮度/对比度/饱和度/温度修正，优先 `set_color_grading`。
2. 再处理个别问题：过暗素材才加阴影/亮度，轻微失焦素材才加少量 sharpen；不要同时叠多个风格化效果。
3. 最后才考虑气氛：只在整片主题明确时对少量镜头使用 vignette、grain 或 shader；`glitch`、chromatic aberration、强 glow 不作为旅行片默认。

`set_color_grading` 的目标是让相邻镜头属于同一支短片，不是让每个场景拥有完全不同的 LUT。调色写入后要检查效果是否仍启用、效果顺序是否符合预期，并记录无法预览时的限制。

### 2.5 Speed / fade：用在动作和声音的进入/退出

**现有能力**

- `set_clip_speed`（`vendor/openreel/packages/agent/src/registry.ts:15529`）设置播放速度并重新计算 duration；实现见 `vendor/openreel/packages/core/src/actions/handlers/clip-fx.ts:13`。
- `set_speed_ramp`（约 `:15532`）支持 speed keyframes、freeze frames 和 pitch correction。
- `set_clip_volume` 与 `set_clip_fade`（约 `:15602-15604`）作用于音频；`set_clip_fade` 的参数是 `{ clipId, fadeIn, fadeOut }`。
- `add_audio_automation`、`add_audio_effect`、`update_audio_effect` 等可用于音量曲线和基础声音处理。

**边界和推荐组合**

- 旅行片默认速度为 1.0。奔跑、旋转、游乐设施等动作镜头可轻微设为 1.1-1.25；超过这个范围应有明确节奏或风格理由，并开启/检查 pitch correction。
- 只有一个动作高潮需要强调时才用 `set_speed_ramp`；不要为每段生成 speed curve。
- 现场声剪辑：被保留的原声片段用 0.08-0.20 秒 audio fade，整片开头保留 0.3-0.8 秒真实环境声，结尾做 0.25-0.5 秒淡出。
- 视频画面淡出使用 `set_clip_transform` + `opacity` keyframes，或使用适当转场；不要把 `set_clip_fade` 描述成视频淡出。
- 当前仓库已有音频编辑能力，但 `generate_music`、`analyze_audio_rhythm` 等属于 `docs/ai-audio-tools-research.md` 所讨论的后续能力，不应在当前 skill 中声称已经可以直接生成音乐或可靠识别节拍。

### 2.6 Transitions：用少数转场说明“场景变了”

**现有能力**

- `add_transition`（`vendor/openreel/packages/agent/src/registry.ts:15622`）参数为 `{ clipAId, clipBId, transitionType, duration }`；另有 `update_transition` 和 `remove_transition`。
- `TRANSITION_TYPES`（`vendor/openreel/packages/core/src/types/effects.ts:612`）包括 `crossfade`、`dipToBlack`、`dipToWhite`、`wipe`、`slide`、`zoom`、`push`、`circleReveal`、`blur`、`whipPan`、`radialWipe`、`pixelate`、`glitch`、`flash`、`filmBurn`、`mosaic`、`ripple`、`pageTurn`、`colorSplit` 等。

**推荐组合**

| 场景关系 | 默认转场 | 建议时长 | 约束 |
| --- | --- | --- | --- |
| 同一地点连续动作 | 硬切 | 0 | 让动作和构图承担节奏 |
| 同一地点但需要柔和连接 | `crossfade` | 0.25-0.40 秒 | 全片不超过 2 处为默认值 |
| 白天到夜景/情绪收束 | `dipToBlack` | 0.35-0.55 秒 | 只放在明确场景边界 |
| 横向运动匹配 | `wipe`、`slide` 或 `whipPan` | 0.25-0.45 秒 | 前后镜头运动方向要一致 |
| 强风格用户明确要求 | `zoom`、`flash`、`filmBurn` 等 | 0.20-0.35 秒 | 先确认效果可渲染，最多 1 处 |

30 秒旅行片默认总共使用 2-4 处转场；`glitch`、`spin`、`flash` 不是“丰富度”的默认答案。加转场会影响切点和时长，写入后必须重新读取相邻片段、转场和总时长。

### 2.7 Motion templates / 动效设计 / 3D：高级选项，不是默认堆料

**现有能力**

- `apply_motion_template`（`vendor/openreel/packages/agent/src/registry.ts:22758`）可由 `templateId` 创建内置 Motion Creator composition。
- 内置模板定义在 `vendor/openreel/packages/core/src/motion/motion-presets.ts`，包括 `motion-social-hook`、`motion-kinetic-title`、`motion-lower-third`、`motion-logo-reveal`、`motion-end-screen`、`motion-product-shot` 等。
- 自建 Motion 场景可使用 `create_motion_composition`（约 `:15895`）、`add_motion_layer(s)`、`set_motion_text_style`、`set_motion_text_content`、`set_motion_shape_style` 和 `animate_motion_layers`。
- `set_motion_text_style` 支持 fillGradient、shadow、stroke、backgroundColor、backgroundPadding、backgroundRadius；`animate_motion_layers` 支持 `fade-in`、`slide-up-in`、`slide-left-in`、`scale-pop`、`pulse`、`float-loop`、`stroke-draw-on`、`gradient-sweep`、`corner-bloom` 等预设。
- `insert_motion_into_editor`（约 `:23694`）才是把 Motion composition 放入普通视频编辑器时间线的步骤；`apply_motion_template` 只创建 composition，不能把两者混为一个动作。
- Motion 可用 `render_motion_frame`（约 `:23744`）检查 composition 的 still frame，输入 `compositionId`、`timeSeconds`、`scale` 或 `quality`。
- 真正的 3D 能力由 `add_motion_3d_object`（约 `:29728`）等提供，底层是 WebGL/Three.js，支持 `text3d`、模型、旋转、灯光、材质、深度和相机推进。创建语义场景还可使用 `add_motion_3d_scene`、`create_creation_3d_scene`、`create_product_cinematic_scene` 等。

**适用分层**

- 普通旅行片：主时间线 `create_text_clip` + `create_shape_clip` + 轻关键帧即可。
- 用户说“高级感/电影感/品牌片头”：可用 `motion-kinetic-title`，或创建一个 2-3 秒透明 Motion composition，再 `insert_motion_into_editor`。
- 品牌 logo、产品模型、建筑/物体展示：才考虑 3D；旅行生活片没有叙事理由时不自动加入 3D。

Motion 是更强的包装画布，但它有独立 composition、layer id、渲染和插入流程，失败面更大。默认路线应先保证主时间线可保存和可导出，再升级到 Motion；不要为了弥补普通标题设计不足而直接把整片变成 3D 场景。

## 3. 30 秒旅行短片可执行包装 recipe

以下 recipe 适用于“8 月 29 日出游，剪成约 30 秒短片”这类用户没有指定品牌风格的任务。标题内容只能使用用户提供或素材明确证明的事实；本例可用 `8.29 出游记`，地点未知时不添加地点。

### 3.1 先决步骤

1. `get_capabilities`：读取本机可用的 `textAnimationPresets`、`transitionTypes`、`videoFilterTypes`、`effects`、`colorGrading` 和 Motion 能力。
2. `list_local_media` 按日期取候选，再用 `inspect_local_media` overview 做低成本概览；候选视频逐个用 detail 查看首、中、尾帧。
3. 创建或打开项目，`import_local_media` 后 `list_media`，只使用返回的实际 `mediaId`。
4. 用远景定场、中景活动、近景细节和一个高潮镜头建立主时间线。`add_clip` 后逐条 `trim_clip`，每次都核对 `inPoint`、`outPoint`、`duration`、`startTime`。
5. 先完成叙事剪辑，再进入包装 pass；不要在镜头尚未确定时批量生成标题和转场。

### 3.2 时间轴 recipe

| 时间 | 画面与节奏 | 包装操作 | 目的与验收 |
| --- | --- | --- | --- |
| 0.00-0.70 | 最有动作或情绪的最佳画面冷开，不先放普通定场 | 原声保留 0.3-0.7 秒；对首镜头做 `scale` 1.00 -> 1.03 的轻 push-in | 0.70 秒内能看出人物/动作/地点氛围；标题不遮挡第一拍 |
| 0.70-2.60 | 继续同一画面或切到清楚定场镜头 | `create_text_clip` 主标题“8.29 出游记”；`slide-up` 或 `fade`；`create_shape_clip` 黑色 scrim opacity 约 0.18-0.26；加一条窄强调条 | 主标题 0.35 秒内完成进入；文字在安全区，scrim 只服务可读性 |
| 2.60-7.00 | 环境远景 + 人物活动中景 | 硬切；若是照片，用 `set_clip_transform` + 2 个关键帧做 1.02 -> 1.05 轻微 Ken Burns；统一基础调色 | 建立地点和人物关系；镜头时长按信息量，不强制 3 秒 |
| 7.00-15.50 | 白天活动组：走路、唱歌、游玩、细节，远/中/近交替 | 以硬切为主；动作方向明确匹配时只用 1 处 `slide` 或 `wipe`，0.25-0.40 秒；高潮前一个镜头可 1.1-1.2x | 至少有一次景别变化；连续两镜不重复同一构图/动作 |
| 15.50-22.00 | 黄昏、摩天轮、江边等场景转折 | 用 1 处 `crossfade` 0.30-0.40 秒；若进入夜景改用 `dipToBlack` 0.40-0.50 秒；必要时只给夜景 clip 调温度/阴影 | 观众感到场景或情绪变化，而不是“每剪一刀就转场” |
| 22.00-27.00 | 夜景或全片最强的 3-4 个瞬间，节奏收紧 | 普通镜头 0.9-1.6 秒；最多一个动作 clip 使用 `set_clip_speed` 1.1-1.25；现场声做短 fade，避免速度变化造成突兀 | 高潮段更紧，但主体动作连贯；速度改变后重新检查总时长 |
| 27.00-30.00 | 一个完整的收束镜头或一张信息量高的照片 | `opacity` 关键帧 1 -> 0 做 0.25-0.45 秒画面淡出；音频 `set_clip_fade` 做 0.25-0.50 秒淡出；可选极简片尾文字，不强加 CTA | 有明确结束感；不在最后一秒塞新信息；总时长约 30 秒 |

### 3.3 标题组件的具体组合

推荐把 0.70-2.60 秒的片头标题拆成以下元素，而不是只调用一次文字工具：

```text
主视频轨：0.00-0.70 的冷开 + 0.70-2.60 的画面
标题轨：create_text_clip
  clip.text = "8.29 出游记"
  clip.startTime = 0.70
  clip.duration = 1.90
  clip.animation = "slide-up" 或 "fade"
  clip.style = 高对比、粗字重、符合安全区的样式
标题更新：update_text_clip
  updates.animation = { type: "slide-up", inDuration: 0.35, outDuration: 0.25 }
  （registry 会把 animation.type 转成预设，并把 inDuration/outDuration 传给文字桥接）
图形轨：create_shape_clip
  clip.startTime = 0.70
  clip.duration = 1.90
  clip.color = "#000000"
  clip.opacity = 0.18-0.26
  clip.fullFrame = false 或按当前 host 的 shape 定位能力调整
图形更新：update_shape_clip
  updates.transform/style = 标题后方的 scrim 或窄强调条
```

如果有可靠的日期或地点信息，可加入一行延迟 0.12-0.20 秒进入的副标题；没有事实依据时省略副标题。主标题和副标题不能都用同样字号、同样动画，否则仍然没有层级。

### 3.4 写操作顺序和状态校验

包装 pass 建议按照以下顺序执行，每一步等结果并检查结构化返回：

1. `list_clips` / `get_editor_state`：确认视频轨、标题轨、图形轨、音频轨和当前总时长。
2. `create_text_clip`，随后 `list_clips`：记录生成的 `clipId` 和 track id。
3. `update_text_clip`：补齐 style、animation 和入出场时长，随后 `get_clip`。
4. `create_shape_clip` / `update_shape_clip`：确认 shape 的时间范围、透明度和层级。
5. 对选中的视频 clip 执行 `set_clip_transform`、`add_keyframe` 或 `set_clip_keyframes`；关键帧用片段本地时间，随后 `get_clip`。
6. `set_color_grading` / `add_video_effect`：确认 effect id、enabled 状态和顺序。
7. `set_clip_speed` / `set_speed_ramp` 与 `set_clip_fade`：速度改变后重新读取 duration；音频 fade 与视频 opacity 分开校验。
8. `add_transition`：确认两端 clip id 和 duration；然后重新 `list_clips` 检查总时长和是否产生意外重叠。
9. 结构自检通过后才进入普通时间线预览或 `export_video`；不要把工具返回“创建成功”当作画面验收。

## 4. 克制的默认策略

默认包装的目标是“看起来完成”，不是“每种能力都调用一次”。建议把下列约束写进后续 skill 指引：

| 类别 | 默认上限/规则 | 只有何时升级 |
| --- | --- | --- |
| 片头文字 | 1 个主标题；副标题最多 1 行 | 用户有地点、日期、主题或明确要求信息层级 |
| 标题动画 | `fade` 或 `slide-up` 二选一，入场约 0.3-0.4 秒 | 品牌/广告/音乐风格才考虑 kinetic、glitch、逐字动画 |
| Shape | 1 个 scrim 或强调条，不常驻全片 | 需要复杂可编辑图形时使用 Motion composition |
| 镜头关键帧 | 30 秒成片约 2-4 个镜头 | 照片组、明确的镜头运动或产品展示 |
| 视频效果 | 先统一调色，再处理少数问题镜头；每个普通 clip 不超过 1-2 个效果 | 用户指定复古、胶片、故障或明确视觉风格 |
| 转场 | 2-4 处；硬切为主 | 场景边界、运动匹配或品牌风格有明确理由 |
| 速度 | 默认 1.0；最多 1-2 个高潮镜头轻微变速 | 用户要卡点、慢动作或明确节奏风格 |
| Motion | 只做 2-3 秒片头/片尾或 lower third | 需要可复用标题、品牌动效或复杂图形层级 |
| 3D | 默认不使用 | logo、产品、建筑、物体展示确实需要深度/旋转 |
| 声音 | 保留少量现场声，做统一音量和淡化 | 已有音乐素材，或后续音频工具已落地并能返回真实文件 |

以下情况不应自动使用：全片 `glitch`、每镜头一个转场、每镜头一个 LUT、强烈 zoom/flash、无内容依据的地点文案、无理由的 3D 物体、未验证的透明导出格式。

## 5. 当前 MCP / 渲染能力约束

### 5.1 普通时间线导出状态

- `vendor/openreel/apps/web/src/services/agent/live-host.ts:200` 的 `runJob()` 在没有 job runner 时直接返回 `Job '${kind}' is not wired in the live host yet`。
- `vendor/openreel/apps/web/src/services/agent/export-job-runner.ts:183` 已有 `createExportJobRunner()`，包含 `exportVideo`、`exportAudio` 和 `exportFrame` 的实现。
- `vendor/openreel/apps/web/src/desktop/DesktopApp.tsx:70-77` 和 `vendor/openreel/apps/web/src/App.tsx:80-87` 都会调用 `getLiveEditorHost().setJobRunner(createExportJobRunner())`，Luna iframe 入口已经补上与 desktop 入口一致的本地导出 runner。
- `export_video` 的工具描述要求返回本地视频结果 metadata/path。仍需以实际返回的 `path`、`bytes` 和 `format` 为准；runner 初始化失败、编码失败、空结果或本地文件桥不可用时，Agent 必须报告导出失败，不能把自动保存的项目路径冒充视频文件。

### 5.2 当前没有普通时间线的 MCP 任意帧预览

- registry 的 `preview_frame`（`vendor/openreel/packages/agent/src/registry.ts:32035`）属于 multicam 域，必须传 `groupId` 和 `timeMs`，不能用来检查普通主时间线。
- `render_motion_frame`（约 `:23744`）只渲染 Motion Creator composition，不能代替普通视频编辑器时间线的预览帧。
- 因此当前普通旅行片无法通过既有 MCP 工具可靠抽查 `0.7s` 标题、主要切点和 `29-30s` 片尾。可做的结构校验是 `list_clips`、`get_clip`、`get_editor_state`；这不能证明文字没有挡主体或转场画面好看。

### 5.3 图片映射与批量写入风险

- 复盘发现批量 `inspect_local_media` 的图片响应顺序与 `items` 文本顺序不能稳定作为对应关系。优先按返回的显式 `mediaId`、`frameIndex`、`frameId`、`timeSec` 映射；客户端无法保持对应关系时，退化为一次检查一个 mediaId。
- `add_clip` 默认按完整素材加入，必须配合 `trim_clip`；`inPoint` / `outPoint` 是源素材时间，`duration` 应等于差值，`startTime` 是时间线位置。
- 批量 trim、效果、转场和标题写入不应依赖一次调用的自然语言 summary。必须逐条读回状态；发现不一致时停止继续写，先修复当前状态。

### 5.4 Motion 输出也有边界

Motion composition 可以通过 `render_motion_frame` 检查单帧，`export_motion_video`（`vendor/openreel/packages/agent/src/registry.ts:31569`）可导出 Motion 场景，但这不是普通主时间线的 `export_video` 替代品。其工具描述还指出 Web 构建对透明 WebM/ProRes 存在降级到不透明 H.264 的限制，需要明确传入 `acknowledgeH264Fallback`；使用结果中的 `normalizedToH264` / `encodedFormat` 判断实际编码格式。

### 5.5 当前限制下的降级路径

1. **不能普通时间线预览**：仍可完成结构化包装，但在报告中明确“未完成视觉验收”，不声称标题、调色和转场已经看起来正确。
2. **导出 runner 或编码环境失败**：保存项目后调用 `report_edit_progress`/`report_edit_result` 报告失败或未导出，保留可恢复的时间线，不重复盲目调用。
3. **主时间线 shape 定位不稳定**：先减少到全帧低透明度 scrim，或把片头迁移到 Motion composition 后用 `render_motion_frame` 检查。
4. **WebGL2 不可用**：不依赖 shader；`add_video_effect` 的 shader 会 no-op，使用标准 brightness/contrast/saturation 和普通 Motion 动画作为保底。
5. **Motion 插入或导出失败**：退回主时间线文字 + shape + opacity/scale keyframes，不让高级包装阻塞基础成片。

## 6. 对后续 skill / tool 指引的具体建议

本次已将核心包装规则写入 `vendor/openreel/apps/web/src/services/agent/luna-editing-skill.ts` 和 `src/pages/aiEditorAgentPrompt.ts`；以下内容是仍可继续落地的工具契约和产品化建议。

### 6.1 增加“包装 pass”而不是只增加单个工具说明

建议在普通短片流程中加入明确阶段：

```text
叙事剪辑完成
  -> 检查总时长/镜头顺序/空隙/重叠
  -> 选择 hook、场景边界、高潮、收束
  -> 应用包装 preset（标题、scrim、关键帧、轻调色、少数转场、音频 fade）
  -> 逐类写后校验
  -> 预览可用则抽查，不可用则明确记录限制
  -> export_video 只在返回真实结果时报告成功
```

### 6.2 用“意图 -> 工具组合”指导 Agent

| 意图 | 推荐工具组合 | 不应做的事 |
| --- | --- | --- |
| 有吸引力的片头 | 选择最佳 hook clip -> `set_clip_transform` + 2 个 scale keyframes -> `create_text_clip` -> `update_text_clip` -> `create_shape_clip` | 只创建一条裸文字，或把标题从 0 秒压在主体上 |
| 标题可读 | `create_shape_clip` scrim -> `update_shape_clip` transform/style -> `create_text_clip` style/animation | 用不透明全帧黑色遮住素材 |
| 静态素材有呼吸 | `set_clip_transform` -> `add_keyframe`/`set_clip_keyframes` | 每个 clip 都做同方向同幅度 zoom |
| 素材颜色统一 | `get_capabilities` -> `set_color_grading` -> 少量 `add_video_effect` | 每镜头随机 LUT、grain、vignette 叠加 |
| 场景有变化 | `add_transition` 2-4 处 | 每个切点使用不同转场 |
| 动作高潮 | `set_clip_speed` 或一次 `set_speed_ramp` -> 重新读 duration -> `set_clip_fade` | 把 audio fade 当 video fade，或无校验地改总时长 |
| 高级标题 | `apply_motion_template`/`create_motion_composition` -> `set_motion_text_style`/`animate_motion_layers` -> `render_motion_frame` -> `insert_motion_into_editor` | 创建 composition 后忘记插入主时间线 |
| 3D 片头 | `get_capabilities` -> `add_motion_3d_object`/scene -> `render_creation_preview` 或 Motion preview | 没有产品/品牌叙事理由时默认上 3D |

### 6.3 工具描述和状态契约应补充的字段

后续如果扩展 MCP，优先补齐这些可以减少 Agent 猜测的契约：

- 普通时间线 `preview_frame`：至少传 `projectId`/当前项目、`timeSec`、可选 `scale`，返回明确的 PNG/JPEG image content 和对应时间。
- `export_video`：区分 `jobQueued`、`jobFailed`、`notWired`、`completed`，返回本地路径、文件大小、format、duration、宽高；不要只返回自然语言 summary。
- `create_text_clip`：在 schema 中显式描述 `style` 和 `animation` 的字段及动画时长，避免 Agent 只看到一个无结构的 object。
- `create_shape_clip`：显式区分全帧 scrim 与可定位的矩形/强调线，并说明创建后是否需要 `update_shape_clip`。
- 关键帧工具：明确普通视频支持的 property、时间是 clip-local 还是 timeline-global，以及速度改变后 duration 是否重算。
- `add_transition`：返回 transition id、实际 duration、相邻 clip 的最终时间范围，便于校验总时长。
- `get_capabilities`：让 Agent 把 manifest 作为每次任务的能力快照，特别是 shader、3D、Motion 和导出格式。

## 7. 实现优先级

### P0：直接解决本次成片问题

1. **包装 preset 规范（已落地）**：将“hook + 标题 + scrim + 少量运动 + 统一调色 + 场景转场 + 声音收束”写成 skill 可执行步骤和默认范围。
2. **标题组合模板（已落地）**：主时间线已有主标题/副标题/shape/入场动画的组合约定，覆盖 `8.29 出游记` 这类旅行短片。
3. **普通时间线 preview frame**：让 Agent 能抽查片头、一个主要切点和片尾，解决“写入成功但视觉未知”。
4. **写后校验模板（已落地）**：工具调用返回后自动/明确要求 `list_clips`/`get_clip`，尤其是 trim、speed、keyframe、transition。
5. **导出结果增强**：在已有 runner 基础上补齐 job 阶段、duration、分辨率和失败分类，形成真实文件 metadata 闭环。

### P1：提高稳定的成片观感

1. 维护轻量的旅行片调色 recipe，例如统一曝光/对比/饱和度/温度的安全范围，并按镜头问题局部应用。
2. 提供“镜头运动层”策略：只选择 hook、照片、定场和高潮镜头生成关键帧，支持 clip-local time 校验。
3. 为 `crossfade`、`dipToBlack`、运动匹配转场建立场景判定规则和默认时长。
4. 建立音频基础层：原声 fade、音量平衡和可选音乐轨；音乐/节拍分析能力等后续工具完成后再接入卡点。

### P2：高级包装和可复用资产

1. 将 `motion-kinetic-title`、`motion-social-hook`、`motion-lower-third` 包装成可配置的片头/信息条模板，并规定创建、预览、插入三步闭环。
2. 为 Motion composition 增加透明背景、字体、图形和 layer id 的稳定校验。
3. 在用户明确需要品牌感、产品感或物体展示时，再接入 3D 场景和相机推进。
4. 调研 shader、粒子和 beat-sync 的可选风格包，但默认关闭，且必须能降级到标准渲染。

### P3：质量评估和自动验收

1. 导出后自动读取视频 metadata，确认 duration、resolution、codec、file size 非空。
2. 导出后抽取 0.7 秒、1.5 秒、场景切换点、高潮和片尾帧，做文字越界、黑帧、空帧和明显遮挡检查。
3. 将“包装层数量、转场数量、关键帧数量、滤镜堆叠数量”作为结构化诊断字段，帮助 Agent 解释为什么成片过度或过淡。

## 8. 验收清单

### 时间线与事实

- [ ] 总时长在用户目标附近；30 秒 recipe 的成片没有因为 speed/transition 变成意外长度。
- [ ] 所有镜头均来自完成代表帧检查的素材，标题中的日期/地点/主题有事实依据。
- [ ] 无意外空隙、重叠、黑帧、重复镜头；所有 trim 的 `inPoint`、`outPoint`、`duration` 已读回确认。

### 片头与标题

- [ ] 前 0.7 秒先看到有信息量的画面或动作，不是空白、无关定场或裸标题。
- [ ] 主标题不是默认裸文本：有可读样式、合理安全区、入场动画和必要的 scrim/强调线。
- [ ] 标题不挡人物脸、关键动作、地标或主体；副标题没有在没有依据时被编造。
- [ ] 标题在 0.35-0.40 秒内完成进入，停留足够阅读，退出不抢下一个镜头。

### 全片观感

- [ ] 至少存在一次有意的景别节奏（远/中/近）和一次明确的场景/情绪转折。
- [ ] 关键镜头有少量、方向合理的 push/pull 或照片平移缩放；没有每段相同 zoom。
- [ ] 相邻素材基本统一曝光、对比度和色温；滤镜不是随机堆叠。
- [ ] 硬切承担大部分节奏，转场数量在 2-4 处；每处转场都能说明场景或运动关系。
- [ ] 速度变化只服务高潮，动作连贯，音频没有突变；开头和结尾有自然的声音淡化。
- [ ] 片尾是收束而不是临时添加的新信息；无必要的 CTA、glitch、3D 或强闪光。

### 渲染与报告

- [ ] `get_editor_state` / `list_clips` / `get_clip` 已完成结构校验。
- [ ] 若普通时间线 preview 可用，至少检查片头标题、一个主要转场和片尾；若不可用，报告未做视觉验收。
- [ ] 只有 `export_video` 返回真实完成 metadata/path 才报告导出成功。
- [ ] 若返回 `Job 'exportVideo' is not wired in the live host yet`，明确报告“时间线已保存、视频未导出”，不重复盲调用。
- [ ] Motion composition 若使用，已用 `render_motion_frame` 检查，并确认已经 `insert_motion_into_editor`；透明导出检查实际 `encodedFormat`。

## 9. 仓库引用

- 复盘记录：`/Users/zhouchao/WorkBuddy/2026-09-14-09-39-08/luna_对话导出_复盘_20260914_095827.md`
- 当前编辑 skill：`vendor/openreel/apps/web/src/services/agent/luna-editing-skill.ts`
- MCP 工具 registry：`vendor/openreel/packages/agent/src/registry.ts`
  - 普通 clip、speed、transform、效果、调色、音频 fade、关键帧、转场：约 `:15529-15623`
  - 文字与 shape overlay：约 `:15634-15800`
  - `create_motion_composition`：约 `:15895`
  - `insert_motion_into_editor` / `render_motion_frame`：约 `:23694-23764`
  - `apply_motion_template`：约 `:22758`
  - `sync_motion_to_audio` / `set_motion_beat_markers` / `apply_motion_preset_to_beats`：约 `:23423-23624`
  - 3D object：约 `:29728`
  - 普通 `preview_frame`：约 `:32035`，实际为 multicam
  - `export_motion_video`：约 `:31569`
- 文字类型与动画：`vendor/openreel/packages/core/src/text/types.ts`
- 普通时间线 transform：`vendor/openreel/packages/core/src/types/timeline.ts:172`
- 普通视频效果与转场枚举：`vendor/openreel/packages/core/src/types/effects.ts:581-638`
- 能力清单：`vendor/openreel/packages/core/src/capabilities/manifest.ts:98-114, 335-359`
- Motion 模板：`vendor/openreel/packages/core/src/motion/motion-presets.ts`
- Motion 动画预设：`vendor/openreel/packages/core/src/motion/motion-animation-presets.ts`
- 普通视频关键帧渲染：`vendor/openreel/packages/core/src/video/video-engine.ts:2728`
- Canvas 预览关键帧属性：`vendor/openreel/apps/web/src/components/editor/preview/canvas-renderers.ts:461`
- Luna live host job 限制：`vendor/openreel/apps/web/src/services/agent/live-host.ts:200`
- 导出 runner：`vendor/openreel/apps/web/src/services/agent/export-job-runner.ts:183`
- Desktop runner wiring：`vendor/openreel/apps/web/src/desktop/DesktopApp.tsx:70-77`
- 音频工具后续调研：`docs/ai-audio-tools-research.md`
