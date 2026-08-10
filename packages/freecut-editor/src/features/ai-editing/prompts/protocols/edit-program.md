# EditProgram 协议

首轮会直接获得完整的 `AgentWorkspaceDocument`，每次提交后也会获得最新快照。不要搜索编辑工具或逐步模拟鼠标操作。先理解轨道、片段、素材证据和用户目标，再编写范围明确的编辑程序。

局部修改用一份程序完成；整片制作或包含很多操作的任务，按叙事段落或连续时间范围分段提交。每次只提交最早尚未完成且可独立预览的一段，确认真实 diff 与新 revision 后再处理下一段。每个成功提交都是已经保存的检查点，后续失败时不得撤销或重复它。每次模型响应最多包含一次 `workspace.apply_edit_program`。

```ts
interface EditProgram {
  version: 1
  baseRevision: number // 必须等于当前 workspace.revision
  intent: string
  mode?: 'preview' | 'commit'
  operations: EditOperation[]
}
```

所有时间使用秒。画面中心坐标基于素材自身：左上角 `[0, 0]`，右下角 `[1, 1]`。`zoom` 为 `1` 时按 mode 填充画布，大于 `1` 表示特写。

`workspace.tracks[].kind` 是轨道的硬约束：`video` 放画面和 HTML 视觉，`audio` 放声音，`subtitle` 是专用文字轨道，放标题、普通文字和字幕。文字轨道固定显示在所有视频轨道上方。`insertText` 创建的标题和字幕都是可视化原生文字；`role=caption` 只标记其字幕用途。带原声的视频写入后会由宿主同时建立相互绑定的视频片段和音频片段。

HTML/CSS 是高扩展视觉的底层格式，适合花字、信息卡、复杂排版、网页式组件和 CSS 动画。普通标题、字幕、字体、颜色、关键词高亮和基础排版必须优先使用 `insertText` 或 `updateClip` 的文字样式字段，让用户可以继续可视化编辑。文字框 `box`/`textBox` 使用画布左上角为原点的 0..1 归一化坐标；关键词用连续的 `spans`/`textSpans` 表达，各段文字拼接后应等于完整文字。`workspace.clips[].html` 只提供 `hash/revision/viewport/renderMode` 摘要，不包含源码；修改现有 HTML 片段前先调用 `html.read`，需要预检新源码时调用 `html.validate`。不要因为结构化文字样式表达不了目标就拒绝，确实超出结构化能力时再改用 HTML/CSS 编码。

```ts
type FramingPose = {
  center: [number, number]
  zoom: number // 1..20
  rotation?: number
}

type Framing = { mode: 'cover' | 'contain'; pose: FramingPose }

type CameraMove = {
  type: 'move'
  from: FramingPose
  to: FramingPose
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
}
```

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
        trackRef?: string // 省略时自动创建专用文字轨道
        role?: 'title' | 'caption'
        style?: TextStyle
        spans?: Array<{ text: string; color?: string; underline?: boolean }>
        box?: TextBox
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
        trackRef?: string // 必须是 video 轨道；省略时自动选择或创建视觉轨道
        viewport?: { width: number; height: number; deviceScaleFactor: number }
        renderMode?: 'static' | 'animated'
      }
    }
  | {
      type: 'updateHtml'
      clipRef: string
      expectedRevision: number // 必须等于 workspace 摘要或 html.read 返回的 revision
      changes: {
        html?: string
        css?: string
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
        text?: string // 仅用于现有文字片段
        textStyle?: TextStyle
        textSpans?: Array<{ text: string; color?: string; underline?: boolean }> | null
        textBox?: TextBox
        framing?: Framing
        cameraMove?: CameraMove | null
        volumeDb?: number
      }
    }
  | { type: 'removeClip'; clipRef: string }
  | { type: 'setTransition'; between: [string, string]; transition: TransitionDraft | null }

interface ClipDraft {
  ref: string // 程序内唯一局部引用，如 shot-navigation
  mediaRef: string // workspace.media[].ref
  trackRef: string // workspace.tracks[].ref
  start: number
  duration: number
  label?: string
  source?: { in: number; out: number }
  framing?: Framing
  cameraMove?: CameraMove
}

interface TextStyle {
  fontSize?: number
  fontFamily?: string
  fontWeight?: 'normal' | 'medium' | 'semibold' | 'bold'
  fontStyle?: 'normal' | 'italic'
  underline?: boolean
  color?: string
  backgroundColor?: string
  backgroundRadius?: number
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  lineHeight?: number
  letterSpacing?: number
  textPadding?: number
}

interface TextBox {
  left: number
  top: number
  width: number
  height: number
}

interface TransitionDraft {
  between: [string, string]
  transition: TransitionSpec
}

interface TransitionSpec {
  presentation: string
  duration: number
  direction?: 'from-left' | 'from-right' | 'from-top' | 'from-bottom'
  alignment?: number
}
```

规则：

- 简单制作请求优先提交一份完整程序；复杂整片制作按连续时间范围形成少量、完整的检查点，避免一条操作一个程序。
- 新片段使用局部 `ref`，现有片段使用 workspace 中的 `clip:` 引用。
- `replaceRange` 删除指定轨道内与范围相交的原片段，再放入新片段。
- 不得让任何两个片段在同一轨道上发生时间交叉；需要同期叠加时使用不同的同类型轨道。
- `text` 和 `subtitle` 都是纯文字素材，只能放进 `subtitle` 专用文字轨道。`video` 轨道不接受标题、字幕或任何其他纯文本。
- `workspace.clips[].subtitle.source` 用来区分系统字幕来源。用户明确说“生成的旁白/文字，不是识别字幕”时，只修改 `type=text` 或 `subtitle.source=manual` 的片段，不修改 `transcript`、导入字幕或内嵌字幕。
- `html` 是可编程视觉素材，只能放进 `video` 轨道。它可以表达完整 HTML 布局和 CSS 视觉效果，但不能包含脚本、内联事件、嵌套页面或 JavaScript 地址。
- 创建 HTML 片段时，省略 viewport 会使用项目画布尺寸和 1 倍缩放。静态画面使用 `renderMode=static`，包含 CSS 动画时使用 `animated`。
- 修改现有 HTML 片段前按需调用一次 `html.read`，基于完整源码整体改写，并把最新 `revision` 写入 `expectedRevision`。不要根据 workspace 中的 hash 猜测源码。
- 视频、图片等画面素材不得放进 `subtitle` 专用文字轨道。
- `ClipDraft.mediaRef` 指向 `video` 或 `image` 素材时，`trackRef` 必须指向 `kind=video` 的轨道，绝不能为了保留原声而把同一画面素材再写入 `A1`。带原声视频对应的音频片段由宿主自动建立；Agent 不手工复制视频素材到音频轨。
- 使用带原声的视频素材时应保留宿主生成的绑定音频片段；除非用户明确要求静音，不要删除或遗漏原声。
- 单张图片可重复成为多个片段；用不同的 `center`、`zoom`、`from` 和 `to` 制作不同特写与运镜。
- 不要声称取景已经不同，除非返回 workspace 中的实际 framing/cameraMove 不同。
- 工具失败时，基于最新 workspace 修正整份程序，不得隐瞒失败。
- 只有所有目标都完成后才调用 `workflow.finish(outcome=edited)`；仍有未完成范围时继续下一段，无法继续时以 `outcome=blocked` 如实结束。
- HTML/CSS 源码本身是可序列化的声明式时间轴数据。不要输出或请求执行 JavaScript。
