---
name: luna-wong-kar-wai
description: 王家卫式都市孤独与碎片时间的原创风格剪辑技能，负责把贴身构图、错过关系、短镜头、声音桥和克制的霓虹画面转成当前项目可执行的时间线方案。
---

# 王家卫式都市孤独风格

这是一个可组合的风格镜头，不是一个根据用户文案切换宿主工作流的规则。模型应结合完整会话判断用户是否要使用这套风格，并同时加载 `luna-editing-standard`、`luna-rhythm-pacing` 和 `luna-audio-editing`。这套技能只改变取舍、节奏、声音和画面效果的默认偏好，不能绕过证据读取、异步等待或时间线复核。

## 表达边界

- 只迁移可泛化的创作方法：都市疏离、错过、碎片化记忆、贴身摄影机、前景遮挡、跳接、怀旧声音和不完整的情绪收束。
- 不复制具体电影的镜头、台词、角色、剧情、人物关系、片名元素或可识别的场面调度。成片必须建立在用户自己的素材和原创叙事上。
- 不把“霓虹”“慢动作”当成单独滤镜。它们必须服务于人物距离、犹豫、重复动作或未说出口的信息。
- 如果用户没有提供旁白内容、日期或数字，不要编造人物经历、时间标记或事实；可以省略旁白，或先向模型返回待确认的创作方案。

## 风格配方

以下参数是模型的剪辑决策参考，不是宿主硬编码阈值。素材、平台、目标时长和用户明确要求优先于这些默认值。

```yaml
style_id: urban-memory-melancholy
story:
  preferred_subjects: [missed_connection, restrained_desire, urban_loneliness, unreliable_memory]
  structure: [concrete_detail, repeated_gesture, near_encounter, omission, unresolved_departure]
  ending: leave_on_missed_connection_or_unsaid_information
camera_language:
  preferred_shot_roles: [obstructed_medium, medium_close_up, hands_and_objects, reflection, distant_compression]
  foreground_obstruction: preferred_when_supported_by_visual_evidence
  framing: off_center_or_partially_cropped
  motion: small_reframing_and_minor_handheld_variation
  avoid: [clean_symmetric_wide, constant_gimbal_glide, decorative_zoom_on_every_clip]
editing:
  average_shot_length_seconds: [1.5, 4]
  anchor_shot_seconds: [6, 12]
  short_shot_ratio: "use a few short cuts to make the anchor hold feel longer"
  transition_bias: [hard_cut, motivated_jump_cut, rare_crossfade]
  slow_segment_count: 1
  slow_segment_scope: "one motion or hesitation beat, never the whole timeline"
  slow_speed_range: [0.5, 0.7]
  slow_speed_default: 0.6
  slow_segment_source_seconds: [2, 5]
  slow_segment_output_factor: "output duration = source duration / speed"
sound:
  music: original_or_user_licensed_nostalgic_instrumental
  voice_over: first_person_only_when_text_is_provided_or_approved
  bridges: [j_cut, l_cut, city_ambience]
  ambience: [rain, traffic, telephone, radio, restaurant, room_tone]
color:
  palette: [neon_green, deep_red, tungsten_amber, magenta_accent]
  contrast: high_but_keep_neon_reflections
  saturation: moderately_high
```

## 先读证据，再写风格方案

第一次编辑前必须调用 `luna.project.inspect()` 和 `luna.timeline.inspectContext()`。之后按当前项目状态补充证据：

1. 用 `luna.media.list()` 读取素材清单；用 `luna.media.read({ mediaIds })` 读取已有画面、时长和分析结果。
2. 需要旁白、对白或声音桥时，先提交 `kind: 'transcript'` 的分析任务并按页读取完整转录；先根据对白和声音内容选出候选源区间。
3. 画面证据不足时，只对这些候选区间调用 `luna.media.analyze({ mediaIds: [mediaId], kind: 'visual', timeRanges })`，轮询 `luna.media.getAnalysisTask({ taskId })` 到 `completed` 或 `failed`，再重新读取素材；不要对长片做整片视觉扫描。
4. 先形成镜头表，再写时间线脚本。镜头表至少记录真实 `mediaId`、源区间、目标时长、叙事作用、画面证据、是否重复动作、声音进入/离开点和是否使用慢速或效果。

没有画面证据时，不要假设某个素材有门框、玻璃、雨、霓虹、人物关系或合适的反应镜头。风格要求不能替代素材事实。

## 剪辑决策

### 结构和镜头

- 先找一个具体的可见细节作为入口：手、电话、门、车窗、餐桌、走廊、反光或人物停顿；不要用抽象的“氛围镜头”开场。
- 把关系写成可观察的距离或错位：两人错过几秒、站在空间的两侧、共享一个物件但不共享同一时间。没有证据就不要补写关系。
- 同一小动作可以重复两到三次，但每次要增加信息或改变情绪。重复构图应通过真实片段的不同区间完成，不要复制同一个时间线片段制造无意义循环。
- 同框人物优先使用侧脸、背影、反射、遮挡或错开的视线。需要清楚交代地理关系的动作段落仍应保留建立镜头，不能为了风格牺牲可理解性。
- 结尾优先停在离开、等待、错过或未说出口的位置，不自动补一个和解镜头。

### 节奏和速度

- 先完成内容粗剪，再做风格化节奏。短镜头集中在信息转折或微动作附近，连续快切之后保留一个稳定的呼吸镜头。
- 1.5-4 秒是起始参考，不是每个镜头的固定长度。保留一处 6-12 秒的情绪锚点，其他镜头围绕它形成长短对比。
- 跳接必须有理由：重复动作、记忆缺口、关系退步或时间断裂。普通连续动作使用动作衔接，不能把所有切点都做成跳接。
- 整段最多选择一个慢速片段，而且慢放只作用于一个有明确动作或犹豫的 2-5 秒源区间，不能把整条时间线统一降速。
- 用户没有给出速度时，以 `speed: 0.6` 作为起点；可在 `0.5-0.7` 范围内根据动作清晰度和目标时长调整。`0.5` 已经是明显慢放，未经预览不要低于这个值。
- 先用 `luna.timeline.split()` 得到真实片段，再用 `luna.timeline.setProperties({ itemId, speed: 0.6 })` 调整速度。速度是播放倍率，慢放后输出时长约为源区间时长除以速度；例如 3 秒源区间在 0.6 倍下约为 5 秒。
- 如果目标输出时长必须固定为 `D` 秒，先选取约 `D * speed` 秒的源区间，再设置速度；写入后必须通过 `inspectContext()` 检查出点、相邻片段、总时长和关联原声，必要时重新 trim 或 move。
- 慢放和慢门拖影是两个独立层次：慢放改变动作时间，`gpu-motion-blur` 才负责运动曝光拖影。不要用提高拖影强度来代替慢放，也不要因为已慢放就自动叠加拖影。
- 当前 SDK 的速度调整不是逐帧重复打印，也不等于真正的步进印片。不要声称已经实现步进印片；需要该效果时，在结果中标记为待新增渲染能力或待人工确认。

### 转场

- 默认使用硬切；硬切可以表达迟到、断裂和记忆跳跃。
- 只有当声音或画面确实需要延续时才使用 `luna.timeline.addTransition({ type: 'crossfade' })`。先从 `inspectContext()` 检查同轨相邻关系和两侧源素材余量；失败后重新读取，不要假设转场成功。
- 不使用连续的装饰性转场，不把 `fade` 填入 `type`。当前可用的视觉淡化表达是 `type: 'crossfade'` 搭配 `presentation: 'fade'`，且必须满足共享契约。

## 当前 SDK 可执行的画面表达

FreeCut 核心已经支持 GPU 效果，脚本层通过 `luna.timeline.effects` 调用。效果应在粗剪复核后按素材状态谨慎加入；同一片段已存在相同效果时更新它或跳过，不要重复叠加。

推荐的低强度起点如下，实际值应根据预览帧调整。用户明确要求更暗、更强烈的王家卫式段落时，使用下面的“单段慢放 + 暗部 + 慢门”组合，而不是把低强度值套到全片：

```js
await luna.timeline.setProperties({ itemId: slowClipId, speed: 0.6 })
await luna.timeline.effects.add({
  clipId: slowClipId,
  type: 'gpu-brightness',
  params: { amount: -0.12 },
})
await luna.timeline.effects.add({
  clipId: slowClipId,
  type: 'gpu-contrast',
  params: { amount: 1.45 },
})
await luna.timeline.effects.add({
  clipId: slowClipId,
  type: 'gpu-saturation',
  params: { amount: 1.22 },
})
await luna.timeline.effects.add({
  clipId: slowClipId,
  type: 'gpu-vignette',
  params: { amount: 0.55, size: 0.55, softness: 0.42, roundness: 1 },
})
await luna.timeline.effects.add({
  clipId: slowClipId,
  type: 'gpu-motion-blur',
  params: { amount: 0.3, angle: 0.2, shutterAngle: 360, samples: 28 },
})
```

这里的 `gpu-motion-blur.amount` 有效范围是 `0-0.3`，`samples` 有效范围是 `4-32`；`0.3 + shutterAngle: 360 + samples: 28` 已是当前 SDK 的强拖影起点。它只应挂在一个短动作片段上，并在关键帧或预览中确认主体没有糊成不可辨认的形状。

低强度整体基调仍可使用下面的参数：

```js
await luna.timeline.effects.add({
  clipId: clipId,
  type: 'gpu-contrast',
  params: { amount: 1.12 },
})
await luna.timeline.effects.add({
  clipId: clipId,
  type: 'gpu-saturation',
  params: { amount: 1.1 },
})
await luna.timeline.effects.add({
  clipId: clipId,
  type: 'gpu-temperature',
  params: { temperature: 0.08, tint: -0.12 },
})
await luna.timeline.effects.add({
  clipId: clipId,
  type: 'gpu-grain',
  params: { amount: 0.05, size: 1.5, speed: 1 },
})
await luna.timeline.effects.add({
  clipId: clipId,
  type: 'gpu-vignette',
  params: { amount: 0.18, size: 0.7, softness: 0.65, roundness: 1 },
})
```

效果选择规则：

- `gpu-contrast`、`gpu-saturation`、`gpu-temperature` 和 `gpu-vignette` 用于建立高对比、偏霓虹的整体基调；先校色再风格化，不要覆盖素材原有问题。
- `gpu-grain` 只做轻微质感，不把噪点当成胶片真实性的证明。
- 只有在动作确实需要拖影时，才在一个短片段上使用 `gpu-motion-blur`；它是方向性运动模糊，不是步进印片。
- `gpu-rgb-split` 只能作为极轻微的边缘色散，并且需要预览确认没有破坏主体和字幕。
- 不凭空创建 LUT 数据。只有当前项目已有合法可用的 LUT 数据或用户明确提供 LUT 时才使用 `gpu-lut`。
- 每次效果写入后重新调用 `luna.timeline.inspectContext()`；能调用预览/渲染能力时，至少检查开头、效果段中部和结尾。

当前 SDK 不能从一条素材凭空生成门框、玻璃、烟雾、雨或霓虹，也不能把普通素材变成真实的手持摄影。只能从素材分析证据中选择已有画面，再用剪辑、速度、变换和效果表达风格。不要把提示词里的拍摄要求当成已执行的画面生成操作。

## 声音执行

- 对白和原声先于音乐。需要情绪连续时，用独立音频轨道、`setAudio` 的淡入淡出或保留片段原声做 J-cut/L-cut；不要为了形式覆盖对白。
- 需要原创配乐时才调用 `luna.audio.startMusic({ model: 'small-music', prompt, durationSeconds })`。提示词描述情绪、配器、速度和城市环境，不引用具体歌手、歌曲或电影配乐；任务必须轮询到 `completed` 并拿到有效 `mediaId` 后才能加入时间线。
- 如果使用音乐，先让它进入，再让画面在一段情绪锚点内少剪或停留；不要全片都强行卡拍。
- 需要旁白时，使用用户提供或已经确认的文字，再调用 `luna.audio.startSpeech()`；旁白可以提前或延后于画面，但不能编造事实来模拟风格。
- 保留雨、交通、电话、收音机、餐馆和房间底噪等真实空间声。没有这些声音证据时，可以使用已有原声或不加，不要报告为已经生成。

## 推荐执行顺序

```text
读取项目和时间线
  -> 读取或生成素材证据
  -> 生成镜头表和声音方案
  -> split / trim / move / addMedia 完成粗剪
  -> inspectContext 复核片段、关联原声和总时长
  -> 对少量片段设置速度和 GPU 效果
  -> 生成或加入原创声音资源并等待任务完成
  -> 再次 inspectContext，必要时 capture/render 关键帧
  -> 向模型返回已执行项、未验证项和仍需确认的风格效果
```

脚本必须导出 `default async function main(luna)`，所有操作使用当前项目返回的真实 ID。可以把同类效果按顺序执行，但每组写入都要读取结构化结果；工具结果必须回传模型，由模型决定是否继续、调整或结束。

## 完成检查

- 镜头顺序、片段区间和总时长与镜头表一致。
- 短镜头和情绪锚点形成对比，没有把全部素材切成同一长度。
- 速度、效果、转场和声音都挂在真实片段或轨道上，重复效果和孤立片段已排除。
- 原声关联、静音、音量和淡入淡出符合共享 SDK 契约。
- 异步声音或分析任务已经明确完成，失败任务没有被使用。
- 未提供的步进印片、真实手持、前景遮挡、烟雾和霓虹等效果明确标记为未执行或待预览确认。
- 未经关键帧/预览/渲染检查的视觉结论，不向用户报告为已验证。
