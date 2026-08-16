# Luna AI Cut 当前 AI 剪辑工具体系

> 这是一份面向教程、演示和 Harness 开发的说明。文档描述当前 `luna-freecut-project-source` 工具体系，不是未来的批量编译协议草案。

## 1. 这套工具解决什么问题

Luna AI Cut 让模型通过结构化工具读取素材和时间轴，再执行可校验的剪辑操作。模型负责理解用户目标、制定步骤和选择工具；Harness 负责注册工具、校验参数、执行调用、回传结构化结果、处理取消和资源边界。

基本原则：

- 模型不能凭空猜素材内容、素材 ID、片段 ID 或轨道 ID。
- 常规剪辑必须使用 `timeline.*`，不能直接修改工程 JSON。
- 工具返回后，模型必须读取 `data`，根据真实结果决定下一步。
- 编辑工具保存前会自动执行时间轴结构校验；完成一组编辑后使用 `project.inspect` 或 `timeline.inspect_context` 复核结果。
- 工具调用结果必须回到模型，由模型决定继续、修正还是向用户说明；Harness 不根据自然语言替模型判断意图或完成状态。

## 2. 三层上下文

```text
当前用户明确要求
        │ 最高优先级，只对当前任务有效
        ▼
当前项目临时要求
        │ 当前对话中针对本项目的一次性安排
        ▼
项目级 AGENTS.md
        │ 这个项目长期遵循的剪辑规则
        ▼
用户长期记忆
        │ 跨项目复用的个人偏好
        ▼
Agent 默认规则
```

例如：用户记忆默认 `9:16`，项目 `AGENTS.md` 规定 `16:9`，本轮用户说“这一条做 `1:1`”，最终使用 `1:1`。

### 当前用户要求

当前对话中的明确要求只属于当前任务，不自动保存。例如本次做成 30 秒、使用某一段素材、临时改成 1:1，都不应该写入用户记忆。

### 项目级 `AGENTS.md`

它描述“这个项目应该如何工作”，例如家庭成长视频需要保留原声、避免夸张转场、保留完整动作。它属于项目目录，由项目维护者管理，不负责记录用户跨项目的个人偏好。

### 用户级 Memory

用户记忆位于 Electron 用户数据目录下的宿主存储中，项目之间共享，不创建在项目源码目录内。当前提供：

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `memory.read` | 按 ID、范围或视频类型读取已保存偏好 | `memoryIds`、`scope`、`videoType`、`limit` |
| `memory.search` | 按主题检索偏好；省略查询时可读取有限的全部偏好 | `query`、`scope`、`videoType`、`limit` |
| `memory.update` | 新增或更新跨项目长期偏好 | `scope`、`topic`、`preference`、`memoryId`、`videoType`、`evidence` |
| `memory.remove` | 按已确认的记忆 ID 删除偏好 | `memoryIds` |

记忆使用规则：

1. 规划开始时可以调用 `memory.search`，但结果只是默认倾向，不能覆盖本轮要求或项目规则。
2. 只有用户明确表达“以后所有项目都这样”或明确确认某项纠正可长期复用时，才调用 `memory.update`。
3. 更新前先搜索已有记录；更新已有记录时必须传原来的 `memoryId`，避免重复记录。
4. 一次性的时长、画幅、素材选择和项目专属规则不要写入记忆。
5. 删除记忆前先通过 `memory.read` 或 `memory.search` 获取准确 ID，不根据相似文案猜测删除目标。

## 3. Harness 与工具分层

```text
用户消息原文
      │
      ▼
Harness 会话与模型循环
      │ 读取项目提示词、注册工具、执行模型返回的调用
      ├── memory.* ──────► Electron 宿主用户记忆服务
      │
      └── source/media/project/timeline.*
                         │
                         ▼
              FreeCut 渲染层工具实现
                         │
                         ▼
                项目 Store / 媒体服务 / 工程源码
```

当前实现中的职责：

- `scripts/deepseek-harness-freecut-plugin.mjs`：注册 28 个工具、提供稳定的工具描述和剪辑系统指导，并把调用转发给宿主或渲染层。
- `packages/freecut-editor/src/features/project-source/project-source-agents-template.md`：项目级提示词模板，规定上下文优先级、工具调用顺序、单位和安全边界。
- `project-source-tools.ts`：工程源码诊断工具和工具执行入口。
- `project-source-media-tools.ts`：素材清单、分析证据和字幕搜索。
- `project-source-ai-tools.ts`：项目、画布、时间轴、文字、音频、关键帧和转场操作。
- `electron/deepseekHarnessService.ts`：宿主侧请求路由、项目隔离和工具调用转发。
- `electron/userMemoryService.ts`：用户记忆的存储、校验、大小限制和原子写入。

项目模板只负责告诉模型“什么时候使用哪项能力、哪些事情禁止做”；真正的数据安全和参数边界仍由工具 Schema、Zod 校验和 Store 写入边界负责。

## 4. 当前工具清单

当前工具共 28 个：4 个记忆工具、5 个源码诊断工具、4 个素材工具、15 个项目/时间轴工具。

### 4.1 记忆工具：`memory.*`

这些工具管理跨项目用户偏好，不读取项目源码。

| 工具 | 说明 |
|---|---|
| `memory.read` | 读取指定记忆或按范围筛选。适合已有 ID 或需要查看完整条目时使用。 |
| `memory.search` | 按“字幕”“转场”“BGM”“画幅”等主题查找偏好。查询结果必须当作默认倾向理解。 |
| `memory.update` | 保存一条可跨项目复用的偏好。新建时不传 `memoryId`，更新时必须传 `memoryId`。 |
| `memory.remove` | 删除一个或多个已确认的记忆条目。 |

`scope` 有 `global` 和 `video-type` 两种。使用 `video-type` 时应同时提供清晰的视频类型，例如“旅行 Vlog”或“家庭成长记录”。`topic`、`preference` 和 `evidence` 要用用户可理解的描述，不保存原始对话全文。

### 4.2 工程源码诊断：`source.*`

这组工具是只读诊断能力，不是时间轴编辑 API。

| 工具 | 关键参数 | 用途 |
|---|---|---|
| `source.tree` | 可选 `prefix` | 查看工程文件树，定位序列、轨道和片段源码。 |
| `source.read` | `path`，可选 `startLine`、`endLine` | 读取 JSON 源码或根目录 `AGENTS.md` 的有限行范围，带行号。 |
| `source.search` | `query`，可选 `prefix`、`limit` | 在工程源码和 `AGENTS.md` 中查找文本。 |
| `source.check` | 无参数 | 解析并校验工程源码的时间轴结构和引用关系。 |
| `source.diff` | 无参数 | 查看当前工程源码工作树的文件级修改。 |

正常剪辑不需要先读取完整 JSON。只有遇到工程诊断、引用问题、校验异常或需要审查修改时才使用 `source.*`。

源码树大致如下：

```text
manifest.json
sequences/main/
├── sequence.json
├── transitions.json
├── animations.json
└── tracks/<track-id>/
    ├── track.json
    └── segments/*.json
components/
├── index.json
└── <component-id>/...
```

### 4.3 素材工具：`media.*`

素材 ID 必须来自 `media.list`。工具不会把本地路径、文件句柄或原始素材内容暴露给模型。

| 工具 | 关键参数 | 用途 |
|---|---|---|
| `media.list` | 可选 `limit`，最大 500 | 获取素材 ID、文件名、类型、时长、尺寸、帧率、编码和音频情况。 |
| `media.read` | `mediaIds`，最多 12 个 | 读取已经生成的画面理解和带时间点的字幕证据。 |
| `media.analyze` | `mediaIds`、`kind`、可选 `intensity` | 生成分析结果；`kind` 为 `transcript` 或 `visual`。`visual` 未指定 `intensity` 时默认使用较快的 `light`，也可传 `normal` 或 `strong` 获取更密集的画面证据。结果会保存，之后用 `media.read` 读取。 |
| `media.search_transcript` | `query`，可选 `mediaIds` | 在已生成的字幕中搜索词语或短语，返回素材 ID、时间范围和原文。 |

推荐的素材证据流程：

```text
media.list
    ↓
media.read
    ├── 已有足够证据 ──► 规划剪辑
    └── 证据不足
            ↓
        media.analyze
            ↓
        media.read
```

没有分析证据时，模型应明确说明未知，不能根据文件名或猜测假装看过素材。

### 4.4 项目与时间轴工具：`project.*` / `timeline.*`

#### 项目工具

| 工具 | 关键参数 | 用途 |
|---|---|---|
| `project.inspect` | 可选 `limit`，最大 200 | 获取项目画布、FPS、轨道、片段 ID、时间范围、素材 ID、音量、变换和转场。规划前优先调用。 |
| `project.set_canvas` | `aspectRatio`，或同时提供 `width` 与 `height` | 修改输出画布。比例和精确像素尺寸二选一，不能同时传。 |

支持的画布比例包括 `16:9`、`4:3`、`2.35:1`、`2:1`、`1.85:1`、`9:16`、`3:4`、`1:1` 和 `1:2`。

#### 时间轴读取工具

| 工具 | 关键参数 | 用途 |
|---|---|---|
| `timeline.inspect_context` | `fromSeconds`、`toSeconds`，可选 `trackId`、`limit` | 读取指定时间范围内的片段和转场，在局部编辑前确认最新 ID。 |

`project.inspect` 适合看整体结构，`timeline.inspect_context` 适合在局部操作前缩小范围。工具结果中的 `data.items`、`data.transitions` 和 `data.fps` 才是后续规划依据。

#### 素材与片段操作

| 工具 | 关键参数 | 用途 |
|---|---|---|
| `timeline.add_media` | `mediaId`、`startSeconds`，可选 `sourceStartSeconds`、`sourceEndSeconds`、`durationSeconds`、`trackId`、`linkAudio` | 把素材放入时间轴。`startSeconds` 是成片绝对位置；指定源范围时不要同时传 `durationSeconds`。 |
| `timeline.trim` | `itemId`，至少一个 `startSeconds` 或 `endSeconds` | 按成片时间轴的绝对边界裁剪片段首尾。 |
| `timeline.split` | `itemId`、`atSeconds` | 在片段内部的绝对时间点切分，返回新的左右片段 ID。不能切在已有转场区域。 |
| `timeline.move` | `itemId`、`toSeconds`，可选 `trackId` | 移动片段到新的绝对时间位置或已有轨道。 |
| `timeline.remove` | `itemIds`，最多 50 个 | 删除片段，并由编辑器清理关联的音视频、转场和关键帧。 |

删除中间一段时，先 `timeline.split`，再根据返回的 `leftItemId` / `rightItemId` 调用 `timeline.remove`。不要把一个完整片段直接当成中间区域删除。

#### 片段属性与画面

| 工具 | 关键参数 | 用途 |
|---|---|---|
| `timeline.set_properties` | `itemId`，可选 `label`、`text`、`volume`、`speed`、`fadeIn`、`fadeOut` | 修改名称、文字、音量、速度和淡入淡出。不能用它改时间位置或轨道。 |
| `timeline.set_transform` | `itemId`，可选 `x`、`y`、`width`、`height`、`fontSizeRatio`、`rotation`、`opacity`、翻转和 `cornerRadius` | 修改画面位置、尺寸、旋转、透明度、翻转和圆角。位置和尺寸使用归一化值，不是像素。文字片段的文字框宽高不会自动改变字号；需要同步调整时传 `fontSizeRatio`，它表示字号占画布短边的比例。 |
| `timeline.set_audio` | `itemId`，可选 `volume`、`fadeIn`、`fadeOut`、`pitchSemitones` | 修改视频或音频的音量、淡入淡出和变调。 |
| `timeline.add_text` | `text`、`startSeconds`、`durationSeconds`，可选 `label`、`stylePresetId` | 添加文字图层。默认居中、位于画面底部且背景透明；工具会自动选择空闲字幕轨道。 |
| `timeline.add_media_batch` | `items` | 一次添加多段素材，返回所有新片段 ID，适合一轮已经确定的多个素材。 |
| `timeline.add_text_batch` | `items` | 一次添加多条字幕或文字图层，未指定样式时背景透明。 |
| `timeline.add_transition_batch` | `items` | 一次添加多条已经确认相邻片段之间的转场。 |
| `timeline.add_keyframe` | `itemId`、`property`、`atSeconds`、`value`，可选 `easing` | 为画面、文字、音频或路径属性增加一个标量关键帧。时间相对片段起点。 |

#### 转场

| 工具 | 关键参数 | 用途 |
|---|---|---|
| `timeline.list_transitions` | 无参数 | 查询当前已注册且可渲染的转场预设、类别、方向和时长范围。 |
| `timeline.add_transition` | `leftItemId`、`rightItemId`，可选 `durationSeconds`、`presentation`、`direction`、`alignment` | 在同一轨道上相邻的两个片段之间添加转场。`presentation` 必须来自 `timeline.list_transitions`。 |

## 5. 单位和参数约定

这是教程演示中最容易出错的部分。

| 对象 | 单位或范围 |
|---|---|
| 时间轴位置、片段持续时间、源素材范围、裁剪边界、转场时长 | 秒；`timeline.*` 的时间轴边界通常是成片绝对时间。 |
| `timeline.add_keyframe.atSeconds` | 相对当前片段起点的秒数，不是成片绝对时间。 |
| 画布 `width` / `height` | 输出分辨率像素，仅 `project.set_canvas` 使用像素。 |
| 变换 `x` / `y` | 画布内中心点的 0 到 1 归一化坐标；`0.5` 表示居中。 |
| 变换 `width` / `height` | 占画布宽高的 0 到 1 比例。 |
| `cornerRadius` | 相对画布短边的 0 到 1 比例。 |
| 关键帧空间、尺寸、裁剪、文字和描边属性 | 按工具描述使用 0 到 1；不要传像素。 |
| `trimPathOffset` | -360 到 360 度。 |
| 旋转 | 度。 |
| 透明度 | 0 到 1。 |
| 音量 | dB，通常范围 -60 到 12。 |
| 变调 | 半音，-12 到 12。 |
| 速度 | 0.1 到 10 倍。 |
| 关键帧缓动 | `linear`、`ease-in`、`ease-out`、`ease-in-out`。 |

关键帧中，`x` / `y` 的 `0.5` 表示中心；文字阴影偏移的 `0.5` 表示无偏移。`lineHeight` 和 `textStyleScale` 是倍数，不能当成像素使用。

## 6. 标准工作流

### 6.1 从用户需求到可执行计划

```text
读取 memory.search
        ↓
读取项目级 AGENTS.md（由 Harness 提供）
        ↓
media.list + project.inspect
        ↓
必要时 media.read / media.analyze / media.search_transcript
        ↓
timeline.inspect_context（局部操作前重新确认 ID）
        ↓
调用 timeline.* 执行最小修改
        ↓
阅读工具结果中的 data
        ↓
project.inspect 或 timeline.inspect_context 复核
```

开始时不一定要调用所有工具：如果用户只要求修改已有片段音量，可以先 `project.inspect`，再针对目标片段调用 `timeline.set_audio`。如果需要根据画面内容选素材，必须先取得素材证据。

### 6.2 示例：把一段素材放入 9:16 时间轴

```json
// 1. 读取素材和当前项目
media.list {}
project.inspect {}

// 2. 选择 media.list 返回的真实 mediaId
project.set_canvas { "aspectRatio": "9:16" }

// 3. 直接使用源素材的 12 秒到 20 秒
timeline.add_media {
  "mediaId": "media-from-list",
  "startSeconds": 0,
  "sourceStartSeconds": 12,
  "sourceEndSeconds": 20,
  "linkAudio": true
}

// 4. 检查结果
project.inspect {}
```

`sourceStartSeconds` / `sourceEndSeconds` 已经决定时间轴片段长度，不要再同时传 `durationSeconds`。

### 6.3 示例：删除片段中间的 3 秒

```text
1. project.inspect 或 timeline.inspect_context，找到最新 itemId 和时间范围。
2. timeline.split，在要删除区间的开始和结束位置分别切分。
3. 读取两次 split 返回的左右片段 ID。
4. timeline.remove，只删除代表目标区间的片段。
5. 用 timeline.inspect_context 检查时间范围。
```

### 6.4 示例：按口播内容找素材并加字幕

```text
1. media.list 获取素材 ID。
2. media.read 检查是否已有字幕证据。
3. 没有证据时，对视频或音频调用 media.analyze(kind="transcript")。
4. 再次 media.read，或调用 media.search_transcript 搜索台词。
5. 用返回的素材 ID 和时间点规划时间轴。
6. timeline.add_text 添加文字图层。
7. 用 project.inspect 或 timeline.inspect_context 检查工程结果。
```

### 6.5 示例：添加转场

```text
1. project.inspect 或 timeline.inspect_context，确认两个相邻片段和所在轨道。
2. timeline.list_transitions，读取真实的 presentation 和支持的 direction。
3. timeline.add_transition，传入两个真实 itemId。
4. 用 project.inspect 或 timeline.inspect_context 复核转场。
```

`timeline.list_transitions` 的时长信息以帧返回，而 `timeline.add_transition.durationSeconds` 使用秒；需要自定义时长时结合返回的 `fps` 换算，不要把帧数直接当秒传入。

## 7. 错误处理与结果阅读

所有工具结果都遵循以下基本形状：

```json
{
  "ok": true,
  "message": "给人看的简短结果",
  "data": {}
}
```

`message` 只是摘要，模型必须读取结构化的 `data`。常见处理方式：

- `ok: false`：读取 `data` 中的 `missingIds`、`issues`、`skippedIds` 等字段；先重新读取最新上下文，再决定修正或向用户说明。
- 工具报 ID 不存在：不要凭记忆重试，重新调用 `media.list`、`project.inspect` 或 `timeline.inspect_context`。
- 工具报项目已切换：当前调用上下文失效，应重新打开 AI 会话并重新建立上下文。
- 编辑工具保存前的内部时间轴校验失败时，工具会返回错误并恢复修改前状态；先根据错误重新读取最新时间轴上下文。
- 分析结果状态为 `not-requested`：说明证据还没生成，不代表素材没有内容。

每一个编辑工具都应被视为一次真实工程修改。工具本身负责保存和必要的回滚；模型仍要通过结果确认修改落在目标片段和目标时间上。

## 8. 明确禁止的做法

- 不要直接编辑 `project.json`、`sequence.json`、轨道 JSON 或其他工程源码来完成正常剪辑。
- 不要在项目目录创建 `user-preferences.md` 代替宿主记忆服务。
- 不要用 `source.*` 代替 `timeline.*` 修改时间轴。
- 不要把文件名、用户描述或上一次旧结果当成素材/片段 ID 的可靠来源。
- 不要根据自然语言关键词在宿主代码中推断“这是咨询、确认、执行还是结束”。这些判断由模型结合完整会话完成。
- 不要修改、包装或追加用户原文来表达 Harness 的猜测；结构化资源上下文应通过协议提供。
- 不要因为工具执行成功就由 Harness 自行向用户宣告完成；成功结果必须回到模型。
- 不要在没有字幕或画面证据时声称“看到了”某个镜头或听到了某句台词。
- 不要向 `timeline.set_transform` 或归一化关键帧属性传像素位置和尺寸。
- 不要在添加转场前猜 `presentation`；先调用 `timeline.list_transitions`。

## 9. 教程视频建议讲法

可以把一条完整演示拆成四段：

1. **先讲上下文**：用户要求、项目 `AGENTS.md`、用户记忆三层如何冲突和排序。
2. **再讲证据**：`media.list` 获取 ID，`media.read` / `media.analyze` 获取内容证据，`project.inspect` 获取时间轴结构。
3. **再讲编辑**：用 `timeline.add_media`、`trim`、`split`、`remove`、`set_transform`、`add_text` 等工具执行最小改动。
4. **最后讲闭环**：读取工具返回的 `data`，复核时间轴结果，最后由模型向用户汇报；结构校验由编辑工具保存流程自动完成。

教程中建议始终把工具调用、结构化结果和下一步决策放在同一个画面里展示。这样观众能看到模型不是“直接改文件”，而是在“读取证据 → 调用能力 → 验证结果”的闭环中工作。

## 10. 相关源码

- [项目级提示词模板](packages/freecut-editor/src/features/project-source/project-source-agents-template.md)
- [Harness 工具注册与剪辑指导](scripts/deepseek-harness-freecut-plugin.mjs)
- [源码诊断工具](packages/freecut-editor/src/features/project-source/project-source-tools.ts)
- [素材工具](packages/freecut-editor/src/features/project-source/project-source-media-tools.ts)
- [项目与时间轴工具](packages/freecut-editor/src/features/project-source/project-source-ai-tools.ts)
- [Electron Harness 服务](electron/deepseekHarnessService.ts)
- [用户记忆服务](electron/userMemoryService.ts)
- [AI Harness 架构背景](packages/freecut-editor/docs/ai-editing-harness-architecture.md)

本文档是教程入口；当工具 Schema、提示词边界或记忆协议变化时，应同步更新本文档和对应测试。
