# 剪辑源码仓库协议

## 工作流

1. 用 `workspace.list` 查看目录，用 `workspace.search` 定位素材、台词或已有片段，用 `workspace.read` 按行分页读取需要的文件。
2. 用 `workspace.patch` 原子修改可写源码。大型作品按开场、主体、结果、结尾等真实叙事职责拆分 segment，不按每个镜头提交。
3. 运行 `timeline.check`。根据 diagnostic 的 `code`、`path` 和 `message` 修改源码，直到没有 error。
4. 运行 `timeline.build`、`timeline.test` 和 `timeline.diff`，确认验收规则通过，且完整构建的操作数、类型和时间范围符合用户目标。
5. 调用 `git.commit` 保存整个源码树。源码提交不会修改真实时间轴。
6. 包含两个及以上叙事模块的大型任务，在首个可独立播放的模块稳定后，使用 `git.commit` 返回的 `commitId` 调用 `timeline.publish_stage`。它会把当前完整构建发布到真实时间轴，但不会结束当前处理。不要等整个成片全部写完后才第一次发布；小范围、单模块修改可以跳过阶段发布。
7. 阶段发布后可以继续修改其他模块；每次后续修改都必须重新执行检查、构建、验收、差异确认和 Git 提交。
8. 所有目标完成后，使用最新 `git.commit` 返回的 `commitId` 调用 `timeline.commit`。它会最终发布当前完整构建并结束编辑任务。

不要在源码中填写时间轴 revision；宿主会维护当前生产基线。不要绕过源码编译器直接写真实时间轴。阶段边界按可独立检查的叙事模块划分，不要按每个镜头制造提交和发布。

## 仓库布局

```text
manifest.json                         # 可写，源码入口和剪辑目标
sequences/main.sequence.json          # 可写，按顺序导入 segment
segments/*.segment.json               # 可写，模块化编辑操作
components/*.component.json           # 可写，可复用文字默认值
tests/*.json                          # 可写，保留给工程验收约束
media/index.json                      # 只读，素材摘要和详情路径
media/*.json                          # 只读，单个素材元数据
evidence/visual/*.json                # 只读，画面证据
evidence/transcripts/*.json           # 只读，口播证据
evidence/timeline/sequence.json        # 只读，当前时间轴索引与统计
evidence/timeline/current-*.json       # 只读，有界当前片段窗口
```

`workspace.patch` 只能修改 `manifest.json`、`sequences/`、`segments/`、`components/` 和 `tests/`。不要复制或改写只读投影。

## 源码格式

入口：

```json
{ "version": 1, "main": "sequences/main.sequence.json", "intent": "本次完整剪辑目标" }
```

Sequence：

```json
{
  "version": 1,
  "imports": [
    "segments/opening.segment.json",
    "segments/body.segment.json",
    "segments/ending.segment.json"
  ]
}
```

Segment 可以导入其他 segment，并包含多个操作：

```json
{ "version": 1, "imports": ["segments/shared.segment.json"], "operations": [] }
```

文字 component：

```json
{
  "version": 1,
  "type": "text",
  "role": "caption",
  "style": { "fontSize": 48, "fontWeight": "semibold", "color": "#ffffff" },
  "box": { "left": 0.1, "top": 0.78, "width": 0.8, "height": 0.14 }
}
```

Acceptance test：

```json
{
  "version": 1,
  "name": "主序列验收",
  "assertions": [
    { "id": "duration", "kind": "outputDuration", "minSeconds": 35, "maxSeconds": 45 },
    { "id": "visuals", "kind": "operationType", "operation": "insertClip", "min": 6 },
    { "id": "title", "kind": "requiredText", "text": "Luna" }
  ]
}
```

验收支持 `operationCount`、`operationType`、`outputDuration`、`changedDuration` 和 `requiredText`。只写能由构建产物确定验证的约束，不把主观视觉或听感写成自动验收。

## 编辑操作

所有时间使用秒。现有引用从只读 evidence 文件读取；新片段的局部 `ref` 在完整构建内必须唯一，并作为跨会话稳定源码身份。修改已有源码片段时保留它的 `ref`；从源码删除该定义会删除它拥有的时间轴片段。

```ts
type EditOperation =
  | {
      type: 'replaceRange'
      range: { start: number; end: number }
      trackRefs?: string[]
      clips: ClipDraft[]
      transitions?: TransitionDraft[]
    }
  | { type: 'insertClip'; clip: ClipDraft }
  | {
      type: 'insertText'
      text: {
        ref: string
        text: string
        start: number
        duration: number
        label?: string
        trackRef?: string
        role?: 'title' | 'caption'
        componentRef?: string
        style?: TextStyle
        spans?: Array<{ text: string; color?: string; underline?: boolean }>
        box?: { left: number; top: number; width: number; height: number }
      }
    }
  | {
      type: 'insertHtml'
      html: {
        ref: string
        html: string
        css: string
        start: number
        duration: number
        label?: string
        trackRef?: string
        viewport?: { width: number; height: number; deviceScaleFactor: number }
        renderMode?: 'static' | 'animated'
      }
    }
  | {
      type: 'updateClip'
      clipRef: string
      changes: {
        start?: number
        duration?: number
        trackRef?: string
        label?: string
        text?: string
        textStyle?: TextStyle
        textSpans?: Array<{ text: string; color?: string; underline?: boolean }> | null
        textBox?: { left: number; top: number; width: number; height: number }
        framing?: Framing
        cameraMove?: CameraMove | null
        volumeDb?: number
      }
    }
  | { type: 'removeClip'; clipRef: string }
  | { type: 'setTransition'; between: [string, string]; transition: TransitionSpec | null }

interface ClipDraft {
  ref: string
  mediaRef: string
  trackRef: string
  start: number
  duration: number
  label?: string
  source?: { in: number; out: number }
  framing?: Framing
  cameraMove?: CameraMove
}

interface Framing {
  mode: 'cover' | 'contain'
  pose: { center: [number, number]; zoom: number; rotation?: number }
}

interface CameraMove {
  type: 'move'
  from: Framing['pose']
  to: Framing['pose']
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
}

interface TransitionSpec {
  presentation: string
  duration: number
  direction?: 'from-left' | 'from-right' | 'from-top' | 'from-bottom'
  alignment?: number
}
```

`insertHtml` 和现有 `updateHtml` 必须遵守工具所描述的 HTML 安全边界。视频和图片放在 video 轨道；普通文字与字幕放在 subtitle 轨道；视频原声由宿主建立绑定音频，不要把视频素材复制到 audio 轨道。任何两个片段不得在同一轨道发生非法时间交叉。

## Git 与完成

- `git.status/diff/log/branch/commit` 只管理内部剪辑源码工作树，不接触真实时间轴。
- commit id 由内嵌 Git 仓库生成；没有源码差异时不要重复提交。
- `timeline.publish_stage` 是可选的生产阶段发布。它成功后继续使用同一个源码仓库和工作会话，不得当作任务完成。
- 阶段发布后的新修改必须生成新的 Git commit，并以新 commit id 发布；不要把旧 commit id 用于新源码。
- 纯文本交付直接给最终回复并停止调用工具。
- 编辑交付只在 `timeline.commit` 成功后完成。发布失败时继续修正；revision conflict 时停止重复提交旧基线，并明确说明冲突。
