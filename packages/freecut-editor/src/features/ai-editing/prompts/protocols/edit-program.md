# EditProgram 协议

每轮都会直接获得完整的 `AgentWorkspaceDocument`。不要搜索编辑工具或逐步模拟鼠标操作。先理解轨道、片段、素材证据和用户目标，再用一次 `workspace.apply_edit_program` 提交完整改动。

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
        trackRef?: string // 省略时自动创建画面文字轨道
        role?: 'title' | 'caption'
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

- 制作类请求优先提交一份完整程序，不连续提交许多小程序。
- 新片段使用局部 `ref`，现有片段使用 workspace 中的 `clip:` 引用。
- `replaceRange` 删除指定轨道内与范围相交的原片段，再放入新片段。
- 单张图片可重复成为多个片段；用不同的 `center`、`zoom`、`from` 和 `to` 制作不同特写与运镜。
- 不要声称取景已经不同，除非返回 workspace 中的实际 framing/cameraMove 不同。
- 工具失败时，基于最新 workspace 修正整份程序，不得隐瞒失败。
- 不要输出或请求执行 JavaScript；这里只提交可序列化的声明式数据。
