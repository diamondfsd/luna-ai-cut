# Luna AI Cut 项目剪辑规则与工程源码工作区

本目录是当前项目的工程源码工作区，也是 AI 助手进行剪辑编辑时的基础目录。
Harness 会把本文件作为项目级规则加载；常规剪辑必须通过结构化工具完成，源码文件只用于必要的诊断。

## 上下文边界

Luna AI Cut 的剪辑上下文分为三层：

1. 当前对话中的用户明确要求，只对当前任务有效，优先级最高，不自动保存。
2. 本文件是当前项目的规则，描述这个项目应该如何剪辑；它不记录用户跨项目的个人偏好。
3. 用户长期偏好由宿主提供的 `memory.read`、`memory.search`、`memory.update` 和 `memory.remove` 管理，保存在项目目录之外，对所有项目生效。

发生冲突时按以下顺序处理：当前用户明确要求 > 当前项目临时要求 > 本文件中的项目规则 > 用户长期偏好 > Agent 默认规则。

不要把一次性的时长、画幅、素材选择或当前任务安排写入用户记忆。项目专属的剪辑原则属于本文件；可跨项目复用的个人偏好才属于用户记忆。记忆工具只接受结构化字段，是否形成长期偏好由 Agent 根据完整对话判断，宿主不会根据文案猜测用户意图。

## 剪辑工具

开始规划前先读取：

- `memory.search`：读取有限的用户长期偏好，只作为默认倾向，不能覆盖当前用户明确要求或本文件规则。
- `media.list`：素材 ID、时长、画面尺寸、帧率和音频信息。
- `project.inspect`：当前画布、轨道、片段、时间范围、素材 ID 和转场。

按需使用：

- `media.read`、`media.analyze`、`media.search_transcript`：读取画面理解、口播字幕和时间点证据。
- `project.set_canvas`：修改输出画布比例或精确分辨率。
- `timeline.add_media`：把素材加入时间轴，可直接传源文件范围。
- `timeline.trim`、`timeline.split`、`timeline.move`、`timeline.remove`：编辑片段和位置。
- `timeline.set_properties`、`timeline.set_transform`、`timeline.add_keyframe`：编辑文字、音频、画面和动画。
- `timeline.add_text`：添加字幕或文字图层。
- `timeline.list_transitions`、`timeline.add_transition`：查询并添加已注册的转场。

完成一组剪辑后再次调用 `project.inspect` 或 `timeline.inspect_context` 确认整体结果；编辑工具保存前会执行内部时间轴结构校验。

不要直接编辑工程源码 JSON，也不要把源码内容当作时间轴修改接口。`source.tree`、`source.read`、`source.search`、`source.check` 和 `source.diff` 仅用于诊断、校验和查看修改；它们不能替代 `timeline.*` 工具。

## 时间和单位

- 时间轴位置、片段持续时间、素材源范围、裁剪和转场时长统一使用秒。
- `timeline.add_media` 的 `startSeconds` 是成片时间轴的绝对位置；`sourceStartSeconds` 和 `sourceEndSeconds` 直接指定素材源范围，不要先添加整段再裁剪。
- `timeline.trim` 的边界是成片时间轴上的绝对秒数。
- `timeline.add_keyframe.atSeconds` 是相对片段起点的秒数，不是成片绝对时间。
- `project.set_canvas` 的 `width` 和 `height` 是输出分辨率像素，是画面尺寸规则的唯一像素例外。

## 画面、文字和关键帧单位

- `timeline.set_transform` 的 `x`、`y` 是画布内中心点的 0 到 1 归一化坐标，0.5 表示居中；`width`、`height` 是占画布的 0 到 1 比例；`cornerRadius` 是相对画布短边的 0 到 1 比例。
- `timeline.add_keyframe` 中的空间、尺寸、文字、描边、裁剪和 taper 比例属性使用 0 到 1，不要传入像素。`x`、`y` 与文字阴影偏移的 0.5 分别表示中心和无偏移。
- 旋转和 `trimPathOffset` 使用角度，其中 `trimPathOffset` 为 -360 到 360；透明度使用 0 到 1；行高和文字样式缩放使用倍数；音量使用 dB。

## 常用操作规则

- `timeline.add_media` 的 `mediaId` 必须来自 `media.list`。不传 `trackId` 时由工具选择最近的可用轨道；只有确实需要指定已有轨道时才传入。
- `timeline.add_text` 不需要 `trackId`：工具优先选择按轨道顺序最近的空闲字幕轨道，全部冲突或不存在时才创建。未指定样式时文字水平居中、位于画面底部，并带半透明黑色背景。
- 添加转场前先调用 `timeline.list_transitions`；`timeline.add_transition.presentation` 必须是返回的已注册预设，方向按预设支持情况传入，时长使用秒。
- 删除中间一段时先用 `timeline.split`，再用 `timeline.remove` 删除不需要的片段。删除片段优先使用工具，让编辑器同步清理关联的音视频、转场和关键帧。
- 每次工具返回后读取其中的结构化结果，确认修改落在目标片段和时间范围；不要凭猜测的 ID 重试。

## 源码树说明

源码树用于宿主保存、检查和审查工具产生的时间轴结果，结构如下：

`manifest.json`
`sequences/main/`
  `sequence.json`          主时间轴状态和源码引用
  `transitions.json`       主时间轴转场
  `animations.json`        主时间轴关键帧
  `tracks/<track-id>/`
    `track.json`            轨道信息
    `segments/*.json`       按时间窗口拆分的片段
`components/`
  `index.json`              合成组件索引
  `<component-id>/`
    `component.json`        合成组件状态
    `transitions.json`      组件转场
    `animations.json`       组件关键帧
    `tracks/<track-id>/`
      `track.json`
      `segments/*.json`

不要修改本文件、`project.json`、`.git/`、缩略图、媒体文件、媒体库索引、应用数据库或其他运行时状态。项目规则由项目维护者管理；用户长期偏好必须通过 `memory.*` 工具管理，不能在工程源码目录创建 `user-preferences.md` 或其他替代文件。工程源码的合法性和引用完整性由工具与校验流程负责。
