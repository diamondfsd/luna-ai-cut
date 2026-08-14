# `project-source` 工程源码协议与维护指南

本文档是 `packages/freecut-editor/src/features/project-source` 的交接文档，也是该目录下后续开发任务的维护约束。内容以当前代码为准，重点说明：

- `project-source` 为什么要拆分，以及它与 `project.json`、Zustand、`project-bundle` 的关系；
- 时间轴、轨道、片段、转场、关键帧和合成组件分别保存在哪里；
- 人工编辑和 AI 编辑应该遵守的同一套文件协议；
- 当前已经实现的行为、当前尚未实现的能力，以及修改协议时必须同步的代码和测试。

如果本文档与实现不一致，应先以 `project-source-codec.ts`、`project-source-schema.ts` 和持久化测试的实际行为为准，然后更新本文档。不要为了让文档看起来正确而假设不存在的兼容逻辑。

## 1. 先记住这三个结论

当前编辑数据有三个层次：

```text
Zustand Store
    │ 运行时内存状态，供编辑器 UI 和渲染器使用
    │
    ├── saveTimeline()
    │
    ▼
project-source
    │ 人和 AI 的主编辑格式，拆分成多个 JSON 文件
    │
    ├── projectFromSourceFiles()
    │
    ▼
project.json
    │ 编译后的完整项目快照、列表和无源码桥接时的兜底存储
    │
    ▼
Zustand Store
```

具体含义如下：

1. Zustand 只表示当前应用进程中的内存状态。它不是本协议，也不是可靠的磁盘文件。
2. 当宿主提供 `editingSourceGit` bridge 时，`project-source` 是时间轴的主编辑格式。人工操作触发保存后，先生成源码树，再从源码树回读出完整项目，最后把回读结果写入 `project.json`。
3. `project.json` 仍然存在，但在有源码 bridge 的项目中，它对时间轴而言是源码树的编译快照，不应该成为人工和 AI 各自维护的第二套编辑协议。
4. 没有 `editingSourceGit` bridge 时，编辑器继续直接保存 `project.json`。这是当前的兼容兜底路径。
5. `project-bundle` 是导入导出容器格式，当前根文件仍然是一个 `project.json`。它不是 `project-source` 的目录协议，也不能代替源码树作为 AI 的细粒度编辑入口。

### 1.1 为什么要拆分

拆分不是为了改变时间轴的数据模型，而是为了改变数据的编辑边界。完整时间轴在运行时仍然是一个 `ProjectTimeline`，但源码阶段把这个大对象按职责和定位路径分开：

| 单文件 `project.json` 的问题 | `project-source` 的对应处理 |
| --- | --- |
| 一个项目的所有轨道、片段、关键帧和组件都挤在同一个大文件里 | 轨道、片段、关键帧、转场和组件分别放到可定位的文件中 |
| AI 为修改一个片段而读取整个项目，消耗上下文并增加误改范围 | 先用 ID 和路径定位目标 segment，只读取需要的局部文件 |
| 两个编辑者修改同一大文件时容易产生整文件冲突 | 不同轨道或不同时间窗口通常落在不同文件，冲突范围更小 |
| Git diff 难以看出到底改了哪个轨道或哪一段时间 | 文件路径本身表达了序列、轨道、时间窗口和页码 |
| 删除片段后很难人工确认相关动画和转场是否要清理 | `animations.json`、`transitions.json` 作为显式的关系文件，可以按 ID 做一致性检查 |
| 文字像素坐标依赖画布尺寸，跨分辨率编辑不稳定 | 文字源码使用 `0..1` 的 `textBox`，由 codec 负责像素转换 |

拆分也带来一个必须接受的事实：源码树不是“把原来的 JSON 任意切几刀”，而是一个有引用关系的协议。编辑器通过 codec 按下面的规则重新组装它：

```text
manifest
  -> main sequence
      -> track files
          -> clip segment files
      -> transitions file
      -> animations file
  -> component index
      -> component files
          -> component track and segment files
          -> component transitions and animations
```

因此拆分的价值是局部可读、局部可改、局部可审查；完整性则由 `version`、`kind`、ID、路径引用和 codec 回读共同保证。只修改一个文件而不检查它与其他关系文件的引用，仍然可能得到无法渲染的工程。

## 2. 当前协议状态

| 项目 | 当前值或行为 |
| --- | --- |
| 源码版本 | `PROJECT_SOURCE_VERSION = 4` |
| 文件格式 | UTF-8 JSON，写出时使用两空格缩进并在末尾追加换行 |
| 源码根入口 | `manifest.json` |
| 主时间轴 | `sequences/main/` |
| 主时间轴引用 | `manifest.json.main` 指向 `sequences/main/sequence.json` |
| 合成组件索引 | `manifest.json.components` 指向 `components/index.json` |
| 片段时间窗口 | 每个窗口约 30 秒，实际帧数为 `round(fps * 30)` |
| 单个片段文件上限 | 同一轨道、同一时间窗口内每个文件最多 32 个片段 |
| 关键帧拆分粒度 | 当前整个序列共用一个 `animations.json`，还没有按片段或属性拆分 |
| 转场拆分粒度 | 当前整个序列共用一个 `transitions.json` |
| 运行时快照 | `project.json` 中的 `Project` 对象 |
| 外部版本迁移 | 当前没有 project-source 旧版本迁移，版本不一致直接报错 |
| 运行时 Schema 校验 | 只有 codec 中的结构性检查，没有完整的 JSON Schema 文件 |
| hash/revision 校验 | 当前没有统一的 `sourceRevision` 或源码树 hash |

协议版本只由 `project-source-schema.ts` 中的常量定义。任何文件的 `version` 和 `kind` 都必须与当前版本匹配。

## 3. 文件树

一个包含主时间轴和两个合成组件的源码树大致如下：

```text
manifest.json
sequences/
└── main/
    ├── sequence.json
    ├── transitions.json
    ├── animations.json
    └── tracks/
        ├── id-video/
        │   ├── track.json
        │   └── segments/
        │       ├── w000000-p01.json
        │       └── w000001-p01.json
        └── id-audio/
            ├── track.json
            └── segments/
                └── w000000-p01.json
components/
├── index.json
├── id-title-card/
│   ├── component.json
│   ├── transitions.json
│   ├── animations.json
│   └── tracks/
│       └── id-text/
│           ├── track.json
│           └── segments/
│               └── w000000-p01.json
└── id-lower-third/
    ├── component.json
    ├── transitions.json
    ├── animations.json
    └── tracks/
        └── id-text/
            ├── track.json
            └── segments/
                └── w000000-p01.json
```

### 3.1 路径命名

轨道和组件目录名不是直接拼接原始 ID，而是由 `sourceKey(id)` 生成：

```text
encoded = encodeURIComponent(id)
目录名 = encoded 已经以 "id-" 开头时使用 encoded，否则使用 "id-" + encoded
```

例如：

```text
video       -> id-video
id-video    -> id-video       不会生成 id-id-video
title/main  -> id-title%2Fmain
```

路径名只是可定位的文件系统 key，真正的轨道或组件 ID 仍然以 JSON 内容中的 `track.id`、`component.id` 和片段的 `trackId` 为准。不要从目录名反推 ID，也不要手工修改目录名而不修改引用关系。

时间片段文件名格式为：

```text
w<window 六位数字>-p<page 两位数字>.json
```

例如 `w000012-p03.json` 表示窗口编号 12 的第 3 页。文件名中的窗口和页码用于查找和稳定排序，读取时仍以文件内容为准。

## 4. 文件协议

下面的 JSON 是最小化示意，不是可以直接复制成完整项目的模板。`state`、`track`、`clips`、`transitions` 和 `keyframes` 中的字段由对应的 FreeCut 类型定义决定。

### 4.1 `manifest.json`

`manifest.json` 是源码树的根入口：

```json
{
  "version": 4,
  "kind": "freecut-project",
  "project": {
    "id": "project-1",
    "name": "示例项目",
    "description": "",
    "createdAt": 1710000000000,
    "updatedAt": 1710000000000,
    "duration": 900,
    "schemaVersion": 1,
    "metadata": {
      "width": 1920,
      "height": 1080,
      "fps": 30,
      "backgroundColor": "#000000"
    }
  },
  "main": "sequences/main/sequence.json",
  "components": "components/index.json"
}
```

当前 writer 明确写入 `project` 的字段是：

- `id`、`name`、`description`；
- `createdAt`、`updatedAt`、`duration`、`schemaVersion`；
- `metadata`，至少包括主画布 `width`、`height`、`fps`。

`thumbnail`、`thumbnailId`、`rootFolderHandle`、`rootFolderName` 等字段不会由当前 `projectToSourceFiles()` 写入 manifest。它们属于项目存储或运行时辅助数据，不应被 AI 当作时间轴协议的一部分。

`metadata.fps` 同时决定主序列的时间窗口大小和文字布局还原所使用的画布信息。修改画布分辨率后，文字片段的 `textBox` 仍然保持归一化坐标，但回读的内部像素 transform 会随新画布尺寸计算。

### 4.2 `sequence.json`

主序列文件位于 `sequences/main/sequence.json`。它保存序列本身的状态，并通过路径引用轨道附属文件、转场文件和关键帧文件：

```json
{
  "version": 4,
  "kind": "sequence",
  "id": "main",
  "state": {
    "masterBusDb": 0,
    "busAudioEq": {},
    "currentFrame": 0,
    "zoomLevel": 1,
    "scrollPosition": 0,
    "inPoint": null,
    "outPoint": null,
    "markers": []
  },
  "transitions": "sequences/main/transitions.json",
  "animations": "sequences/main/animations.json"
}
```

当前 `state` 是 `ProjectTimeline` 去掉以下字段后的剩余字段：

```text
tracks
items
transitions
keyframes
compositions
topLevelSequenceIds
```

因此，播放头、缩放、滚动位置、入点出点、标记、总线音量和总线 EQ 等序列级信息目前仍在 `sequence.json.state` 中。不要在 `sequence.json` 顶层重新添加 `tracks` 或 `items`，也不要把转场和关键帧数组直接放回 `state`。

### 4.3 `track.json`

每个轨道一个目录，每个轨道目录下有一个 `track.json`：

```json
{
  "version": 4,
  "kind": "track",
  "track": {
    "id": "video",
    "name": "V1",
    "kind": "video",
    "height": 60,
    "locked": false,
    "syncLock": false,
    "visible": true,
    "muted": false,
    "solo": false,
    "volume": 0,
    "order": 0,
    "parentTrackId": null,
    "isGroup": false,
    "isCollapsed": false
  }
}
```

轨道对象保存轨道属性，不保存片段数组。片段必须位于该轨道目录的 `segments/` 下。轨道对象中的 `order` 是用户看到的轨道顺序语义，读取时编辑器会按 `order` 恢复显示顺序，不能依赖文件系统返回顺序或目录名排序。

必须保持的关系：

- 轨道 `track.id` 在源码树中唯一；
- 该轨道目录下每个片段的 `trackId` 必须等于 `track.id`；
- 片段移动到其他轨道时，必须同时更新片段的 `trackId` 和文件所在轨道目录；
- 删除轨道时必须删除其所有片段文件，并清理引用该轨道的转场。

### 4.4 `segments/*.json`

每个片段页的结构如下：

```json
{
  "version": 4,
  "kind": "clip-segment",
  "trackId": "video",
  "window": 0,
  "clips": [
    {
      "id": "clip-1",
      "trackId": "video",
      "type": "video",
      "label": "素材 1",
      "from": 0,
      "durationInFrames": 150,
      "mediaId": "media-raw-id",
      "sourceStart": 0,
      "sourceEnd": 150,
      "sourceDuration": 900,
      "sourceFps": 30,
      "speed": 1,
      "transform": {
        "x": 0,
        "y": 0,
        "width": 1920,
        "height": 1080,
        "opacity": 1
      }
    }
  ]
}
```

必需的片段字段由读取器当前直接检查：

| 字段 | 语义 | 约束 |
| --- | --- | --- |
| `id` | 片段稳定 ID | 字符串，序列内应唯一 |
| `trackId` | 所属轨道 ID | 必须等于外层 `trackId`，也必须能找到对应轨道 |
| `type` | 片段类型 | 当前至少是字符串，实际应使用支持的时间轴片段类型 |
| `label` | 编辑器展示名称 | 当前类型允许字符串 |
| `from` | 在所属序列中的起始帧 | 有限数字，使用时间轴帧，不是秒 |
| `durationInFrames` | 持续帧数 | 有限数字且大于 0 |

同一窗口的计算方式：

```text
windowFrames = max(1, round(sequenceFps * 30))
window = max(0, floor(clip.from / windowFrames))
```

例如主序列是 30 fps 时：

```text
0   <= from < 900  -> window 0
900 <= from < 1800 -> window 1
```

注意：窗口依据片段的 `from` 计算，而不是依据片段结束位置计算。一个持续很长、跨越多个窗口的片段只存放在起始窗口的文件中。读取器会扫描所有片段文件并合并，不会把一个跨窗口片段复制到多个文件。

同一个窗口内，writer 先按 `from` 升序、再按 `id` 字典序排序，然后每 32 个片段分页。空窗口不会生成文件。

### 4.5 片段参数分类

`ProjectSourceClip` 目前直接复用大部分 `TimelineItem` 字段。因此，AI 编辑片段参数时应先根据 `type` 判断字段是否适用，不要把所有字段都无条件写入。常见字段可以按下面的类别理解：

| 类别 | 典型字段 | 说明 |
| --- | --- | --- |
| 身份和归属 | `id`、`trackId`、`label`、`originId`、`linkedGroupId` | 用于稳定引用、轨道归属和成对音视频关系 |
| 时间范围 | `from`、`durationInFrames` | 使用序列时间线帧 |
| 媒体引用 | `mediaId`、`src`、`sourceWidth`、`sourceHeight` | `mediaId` 是原始媒体 ID，不要写成 `media:<id>` |
| 源素材范围 | `sourceStart`、`sourceEnd`、`sourceDuration`、`sourceFps`、`speed`、`isReversed` | 用于裁剪、变速和反向播放 |
| 画面变换 | `transform`、`transformParent`、`crop`、`cornerPin`、`blendMode` | 位置、尺寸、旋转、透明度、裁切和图层合成 |
| 画面效果 | `effects`、`motionModifiers`、`motionLayers`、`fadeIn`、`fadeOut` | GPU 效果和运行时运动层 |
| 音频 | `volume`、`audioFadeIn`、`audioFadeOut`、`audioPitchSemitones`、`audioEq*`、`audioDucking` | 视频、音频片段以及轨道级声音控制 |
| 文字 | `text`、`textSpans`、`textStylePresetId`、`textMotion`、`captionSource` | 文字内容、样式、逐字动效和字幕来源 |
| 形状和遮罩 | `shapeType`、`points`、`pathVertices`、`pathClosed`、`isMask`、`mask*` | 形状、路径、遮罩和路径动画基础数据 |
| 合成引用 | `compositionId`、`compositionWidth`、`compositionHeight`、`compositionControlOverrides` | 片段引用 `components/index.json` 中的合成组件 |
| HTML | `html`、`css`、`viewport`、`renderMode`、`assets`、`sourceRevision` | HTML 片段的源内容和渲染设置 |

一些字段属于运行时辅助信息，不能仅凭字段名判断是否适合跨会话保存。当前保存前会明确清理：

- `thumbnailUrl`；
- 对带 `mediaId` 的片段，如果 `src` 或 `audioSrc` 是 `blob:` URL，则清空该 URL；媒体会在加载时通过 `mediaId` 重新解析。

不要把本次会话产生的 `blob:` URL、对象 URL 或临时缩略图地址当作稳定源码引用。反向 conform 相关字段是否可用取决于对应媒体准备流程，不要在 AI 工具中自行生成这些缓存路径。

### 4.6 文字片段的特殊表示

普通视频、音频、图片和形状片段的 `transform` 仍使用内部像素坐标。文字片段是当前协议的一个例外：源码中使用画布归一化的 `textBox`，避免 AI 在不同画布分辨率下直接编辑像素位置。

文字源码片段示例：

```json
{
  "id": "text-1",
  "trackId": "subtitle",
  "type": "text",
  "label": "标题",
  "from": 0,
  "durationInFrames": 90,
  "text": "归一化文字",
  "textBox": {
    "left": 0.1,
    "top": 0.78,
    "width": 0.8,
    "height": 0.12
  },
  "textAnchor": {
    "x": 0.5,
    "y": 0.5
  },
  "transform": {
    "rotation": 4,
    "opacity": 0.9
  }
}
```

约束：

- `textBox.left`、`textBox.top`、`textBox.width`、`textBox.height` 都是有限数字；
- `left`、`top`、`width`、`height` 都在 `0..1`；
- `width` 和 `height` 必须大于 0；
- `left + width <= 1.000001`，`top + height <= 1.000001`；
- `textAnchor.x` 和 `textAnchor.y` 都在 `0..1`，坐标原点是文字框左上角；
- `transform` 可以继续保存 `rotation`、`opacity` 等非布局表现字段；
- `transform.x`、`transform.y`、`transform.width`、`transform.height`、`transform.anchorX`、`transform.anchorY` 禁止出现在文字源码中。

转换关系由 `normalized-text-layout.ts` 定义。回读时，codec 使用 manifest 或组件的画布尺寸把 `textBox` 转换为内部像素 `transform`；再次写出时再转换回归一化坐标。不要在 AI 侧重复进行像素换算。
转换关系由 `normalized-text-layout.ts` 定义。回读时，codec 使用 manifest 或组件的画布尺寸把 `textBox` 转换为内部像素 `transform`；再次写出时再转换回归一化坐标。不要在 AI 侧重复进行像素换算。

### 4.7 `transitions.json`

每个序列或合成组件有一个转场文件：

```json
{
  "version": 4,
  "kind": "transitions",
  "transitions": [
    {
      "id": "transition-1",
      "type": "crossfade",
      "presentation": "crossfade",
      "timing": "ease-in-out",
      "leftClipId": "clip-1",
      "rightClipId": "clip-2",
      "trackId": "video",
      "durationInFrames": 30,
      "alignment": 0.5,
      "properties": {}
    }
  ]
}
```

`Transition` 的核心关系是：

- `leftClipId` 和 `rightClipId` 必须分别指向转场前后的两个片段；
- 两个片段必须在同一 `trackId` 上，并且与转场的 `trackId` 一致；
- 片段必须在时间线上相邻或有足够的隐藏 handle，具体可用范围由转场校验逻辑决定；
- `durationInFrames` 使用帧，不是秒；
- `timing = "cubic-bezier"` 时应提供 `bezierPoints`；
- `properties` 是转场渲染器的扩展参数，颜色参数当前约定使用归一化 RGB 数组；
- 片段被删除、跨轨道移动或裁剪后，相关转场可能失效，编辑工具必须一起检查或删除失效关系。

当前读取器只检查 `transitions` 是数组，不会对每个转场的全部字段执行完整运行时 Schema 校验。AI 工具必须在写入前完成关系校验，不能把“codec 接受了数组”理解成“转场一定可渲染”。

### 4.8 `animations.json` 和关键帧

每个序列或组件有一个关键帧文件：

```json
{
  "version": 4,
  "kind": "animations",
  "keyframes": [
    {
      "itemId": "clip-1",
      "animationVersion": 2,
      "properties": [
        {
          "property": "opacity",
          "keyframes": [
            {
              "id": "kf-1",
              "frame": 0,
              "value": 0,
              "easing": "ease-out"
            },
            {
              "id": "kf-2",
              "frame": 30,
              "value": 1,
              "easing": "linear"
            }
          ]
        }
      ],
      "vectorProperties": [
        {
          "property": "position",
          "keyframes": [
            {
              "id": "vkf-1",
              "frame": 0,
              "value": { "x": 0, "y": 0 },
              "easing": "cubic-bezier",
              "easingConfig": {
                "type": "cubic-bezier",
                "bezier": { "x1": 0.25, "y1": 0.1, "x2": 0.25, "y2": 1 }
              },
              "temporalEase": {
                "out": { "speed": 120, "influence": 50 }
              },
              "spatial": {
                "inTangent": { "x": 0, "y": 0 },
                "outTangent": { "x": 20, "y": 0 },
                "continuous": true
              }
            }
          ]
        }
      ]
    }
  ]
}
```

#### 关键帧的时间基准

关键帧的 `frame` 是相对于所属片段起点的帧，不是序列绝对帧：

```text
序列中的片段 from = 300
关键帧 frame = 12
关键帧在序列中的绝对位置 = 312
```

如果 AI 把片段从 `from = 300` 移动到 `from = 600`，而不希望动画内容相对片段发生变化，则关键帧的 `frame` 不变。如果 AI 想把动画锚定在序列绝对时间，则需要明确换算每个关键帧的相对 frame。

#### 标量关键帧

`properties` 是标量属性分组。当前内置属性包括位置、尺寸、锚点、旋转、透明度、圆角、裁切、音量、文字样式和形状路径等；还支持：

- `effect:<effectId>:<property>:<channel>` 形式的效果属性；
- `pathVertex:<index>:<component>` 形式的路径顶点属性。

每个 `PropertyKeyframes` 的 `keyframes` 应按 `frame` 升序保存，同一属性同一帧不应存在两个不同 keyframe。每个标量 `Keyframe` 至少包含：

```text
id: 稳定的关键帧 ID
frame: 相对片段起点的帧
value: 数值
easing: linear | ease-in | ease-out | ease-in-out | hold | cubic-bezier | spring
```

`cubic-bezier` 需要 `easingConfig.bezier`，`spring` 需要 `easingConfig.spring`。`source` 可保存预设应用来源，用于按一次预设产生的关键帧进行定向移除。

#### 向量关键帧

`vectorProperties` 保存 Animation Core v2 的耦合二维通道：

| `property` | 对应的标量通道 |
| --- | --- |
| `position` | `x`、`y` |
| `scale` | `width`、`height` |
| `anchor` | `anchorX`、`anchorY` |

向量关键帧的 `value` 是 `{x, y}`。`temporalEase` 是 AE 风格的速度和影响量句柄；`spatial` 是位置路径的空间贝塞尔切线，对 `scale` 和 `anchor` 会被忽略。`separatedVectorProperties` 用来记录用户明确选择把某个向量通道拆成独立标量通道的情况。

#### 属性链接和表达式

`propertyLinks` 保存确定性的直接属性链接，例如一个图层的位置跟随另一个图层的位置。每条链接包含：

```text
type: "link"
targetProperty
sourceItemId
sourceProperty
enabled
timeOffsetFrames
```

`expressions` 保存沙箱 DSL 表达式，或者旧数据中暂时存在的 `type = "link"` 记录。直接链接和表达式的来源片段 ID 必须在同一个序列或组件内部，删除来源片段时必须同步清理引用。

#### 当前关键帧拆分限制

当前实现只将整个 `ProjectTimeline.keyframes` 数组写入一个 `animations.json`。这意味着：

- 修改一个片段的动画时，理论上可以只改一个数组元素，但当前 `applyProjectFiles` 的标准 writer 仍可能重写整个 `animations.json`；
- `animations.json` 还可能很大，按 `itemId` 或属性继续拆分是后续优化方向；
- 不要在没有修改 codec、读取器和测试的情况下自行创建 `animations/<itemId>.json` 等新结构，当前读取器不会发现它们。

### 4.9 `components/index.json`

合成组件索引保存组件列表和顶层序列标签顺序：

```json
{
  "version": 4,
  "kind": "component-index",
  "topLevelSequenceIds": ["component-sequence-1"],
  "components": [
    {
      "id": "title-card",
      "path": "components/id-title-card/component.json"
    }
  ]
}
```

`topLevelSequenceIds` 是被提升为独立时间轴标签的组件 ID 顺序。它不是所有组件的排序列表，也不是轨道顺序。空数组可以保留；读取时只有能解析到实际组件的 ID 才会被 hydrate 逻辑继续使用。

### 4.10 `component.json`

每个组件目录的 `component.json` 类似 `sequence.json`，但它保存组件状态：

```json
{
  "version": 4,
  "kind": "component",
  "id": "title-card",
  "state": {
    "name": "标题卡",
    "editorKind": "composite-2d",
    "fps": 30,
    "width": 1000,
    "height": 1000,
    "durationInFrames": 120,
    "backgroundColor": "#000000"
  },
  "transitions": "components/id-title-card/transitions.json",
  "animations": "components/id-title-card/animations.json"
}
```

组件的 `state` 去掉 `tracks`、`items`、`transitions`、`keyframes`，这些内容分别来自组件目录下的轨道、片段、转场和关键帧文件。组件片段在主时间轴中通过 `compositionId` 引用组件 ID。

## 5. 编解码和持久化流程

### 5.1 写出流程

`projectToSourceFiles(project)` 是纯函数，返回：

```ts
Record<string, string>
```

它不会直接写磁盘，主要步骤是：

1. 取 `project.timeline`，没有时间轴时使用空的 `tracks` 和 `items`。
2. 用 `splitSequence('sequences/main', 'main', timeline, project.metadata)` 生成主序列文件。
3. 遍历 `timeline.compositions`，为每个组件生成轨道、片段、转场、关键帧文件。
4. 把组件的临时 `sequence.json` 改名为 `component.json` 的等价结构，并从组件目录删除临时 `sequence.json`。
5. 生成 `components/index.json`。
6. 最后生成 `manifest.json`。

`writeProjectSource(project)` 的行为是：

1. 如果没有 `editingSourceGit` bridge，返回 `false`，不写源码树。
2. 调用 `ensureProjectSource()`。新项目会用当前对象创建源码树；已有项目必须是当前版本 v4，否则抛错。
3. 列出现有源码文件，只管理 `manifest.json`、`sequences/` 和 `components/` 下的文件。
4. 对比当前文件和目标文件内容，只提交发生变化的文件。
5. 目标中已经不存在、但当前仍存在的受管理文件会被删除。
6. 通过 bridge 的 `applyChanges()` 一次提交，带上 `expectedContent` 做乐观并发保护。

源码 writer 会规范化 JSON 缩进和换行。手工调整 JSON 的空格、字段顺序等格式不会成为语义变更，并可能在下一次标准保存时被重新格式化。

### 5.2 回读流程

`projectFromSourceFiles(reader)` 的主要步骤是：

1. 读取并验证根 `manifest.json` 的 `version`、`kind`、`project`、`main` 和 `components`。
2. 读取 `manifest.main` 指向的序列文件。
3. 从序列目录发现 `tracks/` 下的所有轨道目录，读取各自的 `track.json`。
4. 发现每个轨道的 `segments/` 下所有 JSON 文件并合并片段。
5. 读取序列引用的 `transitions.json` 和 `animations.json`。
6. 读取 `components/index.json`，再按组件引用读取每个 `component.json` 和组件自己的轨道、片段、转场、关键帧。
7. 对文字片段把归一化 `textBox` 和 `textAnchor` 转回运行时像素 transform。
8. 组装完整 `Project`，由调用方 hydrate 到 Zustand Store。

读取器按照目录和 JSON 文件路径排序发现内容。业务排序应使用轨道的 `order`、数组中定义的组件关系和时间字段，不要依赖底层文件系统返回顺序。

### 5.3 打开项目流程

当前 `loadTimelineOnce()` 的关键顺序是：

```text
getProject(projectId)
  -> 读取本地 project.json
  -> 执行 Project schema migration 和必要的运行时修复
  -> ensureProjectSource(storedProject)
  -> 有 editingSourceGit 时 readProjectSource(projectId)
  -> hydrateTimelineStoresFromProject(project)
  -> 校验媒体引用
```

因此在配置了源码 bridge 的项目中：

- `project.json` 先用于找到项目和得到创建源码所需的兜底对象；
- 源码树存在且版本正确时，时间轴最终以源码树回读结果为准；
- 源码树缺失时，当前实现会根据 `project.json` 创建一份源码树；
- 源码版本不是 v4 时不会自动迁移，必须删除旧工程后按当前规范重新创建，这是开发阶段兼容策略。

### 5.4 人工保存流程

`saveTimeline(projectId)` 会从各个 Store 捕获不可变快照，再执行：

```text
Zustand 快照
  -> buildTimelineFromPersistenceSnapshot()
  -> 清理临时字段
  -> writeProjectSource(sourceProject)
  -> readProjectSource(projectId)
  -> updateProject(projectId, { timeline: compiledTimeline, ... })
```

源码 bridge 存在时，必须注意最后两步：

- 不是直接把 Store 快照写入 `project.json`；
- 必须从源码树回读后再写 `project.json`，这样文字归一化等源码表示与运行时表示不会产生细微分叉；
- 如果源码写入成功但回读没有得到时间轴，会直接让保存失败，避免源码树和 `project.json` 不一致。

没有源码 bridge 时，`projectJsonTimeline` 就是清理后的 Store 快照，直接写入 `project.json`。

### 5.5 AI 源码写入所有权

`project-source-write-ownership.ts` 提供一个进程内计数器：

- `acquireAiEditingSourceWriteOwnership()` 获取 AI 源码写入所有权，并返回释放函数；
- `isAiEditingSourceWriteOwned()` 判断当前是否有 AI 源码写入者。

当前 `saveTimeline()` 在 AI 源码写入所有权存在时会跳过 `writeProjectSource()`，随后仍会把 Store 快照写入 `project.json`。这是一条为 AI 编辑流程保留的并发保护分支，意思是 AI 正在直接维护源码时，人工自动保存不能把 Store 的旧快照再次编译回源码。

这条分支不代表 AI 可以绕过协议随意写 JSON。AI 编辑器仍应：

1. 读取当前源码文件；
2. 按本文档和 codec 约束修改源码；
3. 使用 bridge 的并发保护能力提交；
4. 让模型工具链或宿主在提交后重新读取、编译并刷新编辑器状态；
5. 在 AI 写入结束后释放所有权。

如果改变这条所有权逻辑，必须同时测试“AI 工具结果返回模型并继续会话”和“人工自动保存不会覆盖 AI 正在写的源码”这两个客观协议行为。不要根据用户文案或模型回复文本猜测是否应该获取所有权。

## 6. 人和 AI 共用协议时的编辑规则

### 6.1 一次编辑的推荐步骤

```text
读取 manifest.json
  -> 解析 main / components 引用
  -> 根据目标 itemId、trackId、sequenceId 定位最小文件集合
  -> 校验旧内容和引用关系
  -> 修改 JSON
  -> 写入 version/kind 不变的文件
  -> 回读源码树并验证可编译
  -> 再生成或更新 project.json 快照
```

AI 不应为了移动一个片段而读取或重写整个项目的 `project.json`。通常只需要：

- 片段原来所在的 segment 文件；
- 目标轨道的 `track.json` 和目标 segment 文件；
- 与片段有关的 `animations.json`；
- 与相邻片段有关的 `transitions.json`；
- 如果是合成片段，还要读取对应的 `component.json` 和组件索引。

### 6.2 移动、裁剪和删除片段

- 只改变片段时间位置：更新 `from`，关键帧的相对 `frame` 默认不变。
- 修改片段持续时间：更新 `durationInFrames`，检查所有关键帧是否仍在合理范围内。
- 移动到另一个轨道：更新 `trackId`、从旧 segment 删除、按目标 `trackId` 和新 `from` 重新放入目标 segment。
- 跨越 30 秒窗口：根据目标序列 fps 重新计算窗口和页码。
- 删除片段：从 segment 删除，并从 `animations.json` 删除 `itemId` 对应的动画；从 `transitions.json` 删除引用它的转场；清理其他片段的属性链接和表达式引用。
- 成对音视频有 `linkedGroupId` 时，删除或拆分其中一方前要检查另一方和相关 `originId`。
- 不能只修改目录名而不修改 JSON 内的 ID，也不能只修改 `trackId` 而不移动文件。

### 6.3 修改关键帧

- 先确认 `itemId` 在同一个序列中存在。
- 明确输入时间是绝对帧还是片段相对帧。源码协议中的 `Keyframe.frame` 一律是片段相对帧。
- 标量属性写入 `properties`；耦合位置、缩放、锚点优先使用 `vectorProperties` 的向量通道。
- 同一 item、同一属性、同一 frame 只能有一个关键帧。
- 修改关键帧 ID 会破坏选择、复制和来源追踪，除非确实是在新建关键帧，否则保留原 ID。
- 使用 `cubic-bezier` 或 `spring` 时，必须同时写完整的对应 `easingConfig`。
- 删除 item 时必须级联删除 `properties`、`vectorProperties`、`propertyLinks` 和 `expressions` 中的引用。

### 6.4 修改文字布局

AI 只修改 `textBox` 和 `textAnchor` 的归一化值，不要自己计算画布像素坐标。示例：

```text
把文字框向右移动 10%:
left = old.left + 0.10
```

修改后必须保证文字框仍完全位于 `0..1` 画布范围，否则 codec 回读会拒绝该文件。文字超出画布的效果如果未来确实需要支持，应先修改明确的源码规范和验证逻辑，不能由调用方偷偷放宽范围。

### 6.5 并发和最小修改

`project-source-worktree.ts` 当前使用 `expectedContent` 进行内容级乐观并发保护。新工具应优先调用 bridge 的 `applyChanges()`，并携带读取时的旧内容；不要无条件覆盖别人刚刚修改的文件。

当前还没有统一源码树 hash、文件 revision 或 `sourceRevision` 协议。因此：

- 不能把单个文件的修改成功当作整个项目仍然一致；
- 提交后应重新读取相关引用文件；
- 发现 manifest、组件索引、轨道、片段和动画之间不一致时，应让操作失败并保留可诊断错误；
- 新增 revision/hash 机制时必须先扩展 Schema、bridge 契约和测试，再让 AI 工具依赖它。

## 7. 当前验证边界和常见误区

### 7.1 不是完整 JSON Schema

当前 `project-source-schema.ts` 是 TypeScript 接口和常量定义，不是独立的 JSON Schema 标准文件。writer 的 `satisfies` 主要在 TypeScript 编译期间检查输出代码，不能验证 AI 直接产生的 JSON。

当前 reader 做了以下结构检查：

- JSON 必须可解析为对象；
- 每个文件的 `version` 和 `kind` 必须正确；
- manifest、序列和组件引用必须是字符串；
- 轨道文件必须包含带字符串 ID 的 `track`；
- segment 必须包含正确的 `trackId` 和数组形式的 `clips`；
- 片段必须至少满足 ID、轨道、类型、起始帧和正持续帧数检查；
- 文字片段必须满足归一化文字框规则；
- 转场和关键帧文件目前只检查对应字段是数组。

它不会自动完整验证所有媒体、效果、转场、表达式、属性链接和合成引用的业务语义。需要新增校验时，应在写入边界或 codec 中增加确定性验证，并补充明确的回归测试。

### 7.2 没有外部行业标准格式

当前 `project-source` 是 FreeCut 自定义的、版本化的 JSON 协议。它不是 Zustand 标准，也不是 OpenTimelineIO、EDL、FCPXML、AAF 或其他行业格式的直接实现。

行业格式可以作为导入导出参考，但不能在不做映射设计的情况下直接替代本协议，因为本协议还包含：

- FreeCut 自己的轨道和组件模型；
- 相对片段起点的关键帧；
- Animation Core v2 向量动画、属性链接和表达式；
- HTML、形状、遮罩、字幕来源和媒体 ID 关系；
- FreeCut 的转场 registry 参数。

如果未来需要对外公开协议，应从当前 TypeScript 类型和 codec 提取独立 JSON Schema，并为每个版本定义明确的迁移或拒绝策略。当前开发阶段按照仓库规则，不为旧测试项目添加隐式迁移或自动修复分支。

### 7.3 不要混淆这些数据

| 数据 | 位置 | 是否是当前 project-source 编辑协议 |
| --- | --- | --- |
| Zustand Store | 进程内内存 | 否 |
| `project.json` | workspace 的 `projects/<id>/project.json` | 有源码 bridge 时是编译快照；无 bridge 时是兜底编辑文件 |
| `manifest.json` 等源码文件 | `editingSourceGit` 管理的源码工作树 | 是 |
| `project-bundle` 中的 `project.json` | ZIP/Bundle 导入导出容器 | 否，属于 bundle 格式 |
| 缩略图文件 | workspace 项目存储 | 否 |
| 媒体文件和媒体库索引 | workspace/媒体库 | 否，源码只保存引用 |
| AI 会话、运行记录 | workspace 的 AI 文件 | 否，除非某个明确的 AI 编辑协议另行引用 |

### 7.4 普通项目字段同步的当前限制

时间轴自动保存会用保存时的项目快照生成 manifest，因此时间轴保存场景可以同步一部分项目元信息。但直接调用 `updateProject()` 修改名称、描述或其他普通项目字段时，当前基础存储层只保证更新 `project.json`，不保证立刻重写 `manifest.json`。

后续如果要实现“所有人工和 AI 项目编辑都统一落到源码树”，应单独补充项目元数据写入服务，并明确：

- 哪些字段属于 manifest；
- 哪些字段属于序列 state；
- 哪些字段只属于 workspace 运行时；
- 普通字段更新后如何重新生成 `project.json`；
- 人工保存、AI 保存和并发写入如何使用同一套协议。

不要通过在 `updateProject()` 内部根据自然语言或调用来源猜测是否写源码来解决这个问题。应使用明确的结构化写入 API。

## 8. 修改协议时必须同步的代码

### 8.1 必须阅读的文件

| 文件 | 职责 |
| --- | --- |
| `project-source-schema.ts` | 版本、文件 kind、源码结构类型和拆分常量 |
| `project-source-codec.ts` | `Project` 与源码文件树之间的双向转换 |
| `project-source-worktree.ts` | 与 `editingSourceGit` bridge 的读写、差异应用和版本检查 |
| `normalized-text-layout.ts` | 文字框归一化和像素 transform 转换 |
| `timeline-persistence.ts` | Store 快照、源码保存、源码回读和 `project.json` 更新 |
| `types/project.ts` | Project、ProjectTimeline、合成组件类型 |
| `types/timeline.ts` | 轨道片段及其字段类型 |
| `types/keyframe.ts` | 关键帧、向量动画、属性链接和表达式类型 |
| `types/transition.ts` | 转场字段和业务关系 |
| `project-source-codec.test.ts` | 源码树生成、发现、文字归一化和拒绝规则 |
| `project-source-write-ownership.ts` | AI 源码写入所有权 |

### 8.2 添加或修改字段

如果新增字段会影响源码协议，至少按以下顺序处理：

1. 先修改领域类型，而不是在 codec 中使用无类型的临时字段。
2. 判断字段属于 manifest、sequence state、track、clip、transition、animation 还是 component state。
3. 更新 writer 和 reader 的双向映射。
4. 明确该字段是否允许缺失、默认值是什么、单位是什么、时间基准是什么。
5. 对 AI 直接编辑所需的运行时校验增加确定性检查。
6. 增加最小的 codec round-trip 测试，以及损坏输入的拒绝测试。
7. 更新本文档的协议版本和字段表；如果破坏旧文件，按当前开发策略明确拒绝旧版本，不要静默兼容。

### 8.3 什么时候必须升版本

以下修改应视为协议破坏或语义变化，通常需要提升 `PROJECT_SOURCE_VERSION`：

- 文件路径或文件 `kind` 改变；
- 字段单位、时间基准或坐标系改变；
- 同一个字段从对象变成数组，或从绝对帧变成相对帧；
- reader 无法同时理解旧结构和新结构；
- 删除或改变已有字段的含义；
- 组件、轨道、片段之间的引用规则改变。

只增加向后可选字段、且 reader 能安全忽略或提供确定默认值时，可以不升源码版本，但仍要增加测试和文档说明。

## 9. 测试和验证

源码协议变更优先运行非 UI 测试：

```bash
cd packages/freecut-editor
pnpm exec vp test run src/features/project-source/project-source-codec.test.ts
pnpm exec vp test run src/features/project-source/project-source-write-ownership.test.ts
pnpm exec vp check --no-fmt src/features/project-source
```

涉及 `saveTimeline()` 或 Store 到源码树的链路时，还要运行相邻的时间轴持久化和 facade 测试，例如：

```bash
pnpm exec vp test run src/features/timeline/stores/timeline-persistence.test.ts
pnpm exec vp test run src/features/timeline/stores/timeline-store-facade.test.ts
```

必要的回归断言应覆盖：

- Store 状态能生成源码文件树；
- 源码文件树能够回读成等价 `Project`；
- 保存时 `project.json` 使用源码回读结果，而不是源码写入前的像素表示；
- 文字 `textBox` 能在归一化格式和运行时像素 transform 之间往返；
- 片段跨轨道、跨窗口、分页后仍能被发现；
- 删除片段不会留下无效关键帧和转场引用；
- 错误的版本、kind、trackId、文字框和片段基础字段会被拒绝；
- AI 源码写入所有权存在时，人工自动保存不会覆盖源码树。

如果修改涉及应用构建，按仓库约定运行：

```bash
pnpm run build:app
```

不要仅用浏览器打开 Vite 地址来验证 Electron 功能。需要验证 Electron 生命周期时，应使用仓库的 Playwright Electron fixture；纯 codec、文件和持久化变化优先使用 node 环境测试。

## 10. 后续演进建议

以下方向尚未在当前实现中完成，不能在代码或工具描述中当作已经存在的协议：

1. 将 `animations.json` 按 `itemId` 或属性进一步拆分。
2. 为片段、动画和转场增加索引文件，减少 AI 定位目标时的全量扫描。
3. 增加 `sourceRevision`、文件 revision 或整个源码树 hash，并定义提交后的冲突检测。
4. 从 TypeScript 类型提取严格 JSON Schema，并明确数字、单位、可选字段和枚举。
5. 将 AI 的读取、修改、校验、提交和源码回读统一封装成结构化编辑服务。
6. 把项目名称、描述等普通项目字段也纳入 manifest 的统一写入链路。
7. 为源码树到 `project.json` 的编译建立独立命令或可诊断服务，而不是让调用方各自拼接数据。

这些演进必须保持一个原则：人工编辑和 AI 编辑最终都操作同一棵 `project-source` 源码树、同一套版本化协议，并通过同一个确定性的 codec 生成运行时快照。不能维护两套“人类格式”和“AI 格式”，也不能用自然语言关键词替代结构化协议判断。

## 11. 相关源码索引

从本目录开始排查问题时，推荐顺序是：

```text
project-source-schema.ts
    -> project-source-codec.ts
    -> project-source-worktree.ts
    -> timeline-persistence.ts
    -> types/project.ts / types/timeline.ts / types/keyframe.ts / types/transition.ts
```

最常见的问题定位方式：

| 现象 | 优先检查 |
| --- | --- |
| 源码文件没有生成 | `getEmbeddedHostBridge().editingSourceGit` 是否存在，`ensureProjectSource()` 是否成功 |
| 保存后 `project.json` 与源码不同 | `saveTimeline()` 是否执行了 `readProjectSource()` 回读，是否有 AI write ownership |
| 片段读不回来 | segment 路径、`version`、`kind`、外层 `trackId`、片段 `trackId` 和基础时间字段 |
| 轨道顺序异常 | `track.order`，不要只看目录或文件排序 |
| 文字位置异常 | `metadata` 或组件画布尺寸、`textBox` 的归一化边界、`textAnchor` |
| 动画没有效果 | `animations.json` 的 `itemId`、相对 `frame`、属性名、easing 配置和动画所属序列 |
| 转场失效 | 两个 clip ID、trackId、相邻关系、duration 和 source handle |
| 已删除文件又出现 | `projectToSourceFiles()` 的目标文件集合和 `applyProjectFiles()` 的受管理路径范围 |
| 老项目无法打开 | manifest 的 `version` 是否为 4。当前不做 project-source 旧版本自动迁移 |

本目录不负责媒体文件本身、Zustand Store 的业务 action、渲染器实现或 bundle ZIP 结构。遇到这些问题时，应沿着上面的源码索引跳转到对应 feature，而不是把不相关的数据继续塞进 `project-source`。
