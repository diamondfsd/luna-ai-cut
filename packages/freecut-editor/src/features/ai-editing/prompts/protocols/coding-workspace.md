# 剪辑源码工作协议

## 最短工作流

1. 用 `media.list` 查找项目素材，用 `media.read` 读取画面证据；用 `workspace.list` 查看工程目录，用 `workspace.search` 按文本定位源码。
2. 常用视频、音频和文字剪辑直接使用下方格式经验；只有需要未列出的类型或扩展属性时才用 `docs.search` 和 `docs.read`。
3. 用 `source.read` 读取要修改文件的当前原文。
4. 用 `source.replace` 精确替换唯一原文。失败时重新读取该文件后再修改。
5. 单个新文件用 `source.create`。需要同时修改多个相关文件时使用 `source.apply_changes`；新文件使用 `revision: null`，已有文件使用最近读取的 `revision`。每批最多 4 个文件且每次响应只调用一次写入工具。
6. 用 `timeline.check` 确认完整工程可编译，用 `git.diff` 检查实际变化。
7. 所有目标完成后调用 `git.commit`。提交成功就是本轮编辑完成，不需要额外发布。

只读取与任务有关的文件。互不依赖的查询可以同一轮执行；写操作有依赖时按顺序执行。工具返回失败时根据最新原文和错误信息修正，不重复发送相同参数。

## 仓库布局

```text
manifest.json
sequences/main/
  sequence.json
  transitions.json
  animations.json
  tracks/id-<track-id>/
    track.json
    segments/w<window>-p<page>.json
components/
  index.json
  id-<component-id>/...
media/       # 只读
evidence/    # 只读
docs/        # 只读，当前 TypeScript 类型与格式说明
```

轨道属性和片段正文分开保存。系统自动扫描 `tracks/*/track.json` 发现轨道，自动扫描每条轨道的 `segments/*.json` 发现片段；不要在其他文件维护轨道或片段路径索引。片段按 30 秒窗口分组，每页最多 32 个。详细顶层结构查询 `docs/types/project-source-schema.ts`，片段字段查询 `docs/types/project.ts` 及它引用的类型文件。

新项目默认已有 `id-video`、`id-audio`、`id-subtitle` 三条基础轨道，文件分别位于 `sequences/main/tracks/id-video/track.json`、`sequences/main/tracks/id-audio/track.json`、`sequences/main/tracks/id-subtitle/track.json`。编辑前查看现有目录并直接复用，不能每轮重复创建；确实需要额外层级或独立用途时再新增轨道。

## 常用剪辑格式经验

以下是稳定的基础格式，可以直接使用，不需要先查询 `docs/`。所有源码文件均为 JSON，当前 `version` 为 `4`。

`sequence.json` 不保存轨道清单；保留文件中已有的 `state`、`transitions` 和 `animations`：

```json
{
  "version": 4,
  "kind": "sequence",
  "id": "main",
  "state": {},
  "transitions": "sequences/main/transitions.json",
  "animations": "sequences/main/animations.json"
}
```

每条轨道由 `track.json` 和同目录下自动发现的 segment 组成。`track.items` 固定为空；真实片段只写在 segment 的 `clips` 中。`kind` 常用值为 `video`、`audio`、`subtitle`，`order` 越小层级越靠上：

```json
{
  "version": 4,
  "kind": "track",
  "track": {
    "id": "id-video",
    "name": "视频",
    "kind": "video",
    "height": 80,
    "locked": false,
    "visible": true,
    "muted": false,
    "solo": false,
    "order": 1,
    "items": []
  }
}
```

segment 的 `trackId` 必须与所属轨道一致：

```json
{
  "version": 4,
  "kind": "clip-segment",
  "trackId": "id-video",
  "window": 0,
  "clips": []
}
```

所有片段都需要唯一的 `id`、所属 `trackId`、时间轴起点 `from`、时长 `durationInFrames` 和 `label`。这些时间值都是帧，不是秒，但分属两套时间基准：`from`、`durationInFrames` 使用项目帧率（来自 `manifest.json` 的 `project.metadata.fps`）；`sourceStart`、`sourceEnd`、`sourceDuration` 使用素材自身的 `sourceFps`。常用片段最小骨架如下：

```json
{
  "id": "clip-video-1",
  "type": "video",
  "trackId": "id-video",
  "from": 0,
  "durationInFrames": 150,
  "label": "画面",
  "mediaId": "素材原始 id",
  "src": "media:素材原始 id",
  "sourceStart": 0,
  "sourceEnd": 150,
  "sourceDuration": 900,
  "sourceFps": 30,
  "embeddedAudioMuted": true
}
```

```json
{
  "id": "clip-audio-1",
  "type": "audio",
  "trackId": "id-audio",
  "from": 0,
  "durationInFrames": 150,
  "label": "原声",
  "mediaId": "素材原始 id",
  "src": "media:素材原始 id",
  "sourceStart": 0,
  "sourceEnd": 150,
  "sourceDuration": 900,
  "sourceFps": 30,
  "volume": 0
}
```

```json
{
  "id": "clip-text-1",
  "type": "text",
  "trackId": "id-subtitle",
  "from": 0,
  "durationInFrames": 90,
  "label": "字幕",
  "text": "字幕内容",
  "color": "#ffffff",
  "fontSize": 48,
  "textAlign": "center",
  "textBox": { "left": 0.1, "top": 0.78, "width": 0.8, "height": 0.12 }
}
```

素材的 `mediaId` 使用 `media.list` 或 `media/index.json` 中原样的 `id`，不要使用 `ref`。`src` 使用 `media:<id>`；`sourceStart`、`sourceEnd`、`sourceDuration` 和 `sourceFps` 是可选字段，只有值可从已有同素材片段继承或从素材证据可靠确定时才写，不能凭空猜测。未变速时，源区间换算为秒后的长度应与时间轴时长一致；变速、倒放等情况先读取现有片段并按其字段处理。

带原声的视频通常建立一对 video/audio 片段：二者 `mediaId`、`from`、`durationInFrames`、`sourceStart`、`sourceEnd`、`sourceDuration`、`sourceFps` 和 `linkedGroupId` 相同；video 写 `embeddedAudioMuted: true`，声音由独立 audio 片段承载。无独立 audio 片段且需要视频原声时，不要设置 `embeddedAudioMuted: true`。

创建、删除或移动片段时只修改对应的 segment 文件；新增轨道时在 `tracks/id-<track-id>/track.json` 创建轨道文件。目录扫描会自动更新渲染内容，不要修改 `sequence.json` 或 `track.json` 来登记路径。使用 `source.apply_changes` 分批写入时每批最多 4 个文件。使用 image、HTML、Lottie、shape、composition、效果、转场、动画关键帧、复杂文字样式或未在上述骨架出现的字段时，再查询相应 `docs/` 定义。

## 时间轴硬性约束

- 音频和视频必须放在独立轨道。`media/index.json` 中 `hasAudio: true` 的视频只要没有明确要求静音，就必须同时创建 video 与 audio 片段；两者使用相同的 `mediaId`、`from`、`durationInFrames`、源区间和 `linkedGroupId`。`volume: 0` 表示 0 dB 的正常音量，不是静音；确实不要原声时在 video 上设置 `embeddedAudioMuted: true`。
- 文字片段的位置和尺寸只能写 `textBox: { left, top, width, height }`，四个字段都是相对画布的 `0..1` 归一化值，且整个框必须位于画布内。例如底部字幕可用 `{ "left": 0.1, "top": 0.78, "width": 0.8, "height": 0.12 }`。旋转锚点如有需要使用 `textAnchor: { x, y }`，同样是文字框内的 `0..1` 归一化坐标。文字的 `transform` 只用于旋转、透明度等非布局属性，禁止写 `x/y/width/height/anchorX/anchorY`，也不要使用不存在的 `scale`。
- 当前不要直接修改文字的空间关键帧（`animations.json` 中的 `x/y/width/height/anchorX/anchorY`）；静态文字布局统一使用 `textBox`，需要文字动画时优先使用非空间属性或现有动画能力。
- 轨道 `order` 越小，渲染层级越靠上。字幕文字必须放在 `kind: "subtitle"` 的可见轨道，并确保该轨道的 `order` 小于与它时间重叠的视频轨道，否则文字会被视频遮住。
- `git.commit` 会提交当前剪辑源码的完整变更，以保证提交本身可独立还原。提交前必须检查 `git diff`，保留并理解本轮开始前已经存在的相关修改。

## 协同编辑

- 人工编辑和 Agent 编辑同一套文件。
- `source.replace` 的 `oldText` 必须来自最近一次 `source.read`，并且在文件中唯一匹配。
- `source.remove` 的 `revision` 必须来自最近一次 `source.read`，不要回传完整文件原文。
- `source.apply_changes` 中已有文件使用最近读取的 `revision`，新文件使用 `revision: null`；任一版本不匹配时整批不会生效。
- 大型修改拆成多个 `source.apply_changes` 批次，每批最多 4 个文件。一个模型响应只调用一次写入工具，拿到结果后再生成下一批。轨道和片段会从目录自动发现，不要创建或更新路径索引。
- `SOURCE_CHANGED` 或找不到原文表示人工或其他操作已修改文件；重新读取并合并意图。
- `SOURCE_AMBIGUOUS` 表示原文出现多次；扩大 `oldText` 上下文，不要盲目使用全局替换。
- 不要回退、覆盖或删除不属于当前任务的变更。

## 完成条件

纯文本任务直接输出最终正文。编辑任务必须具备可编译的工程、符合目标的 `git diff` 查询结果和一次成功的 `git.commit`。不要制造阶段发布、时间轴 revision 或第二次最终提交。
