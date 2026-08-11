# 剪辑源码工作协议

## 最短工作流

1. 用 `media.list` 查找项目素材，用 `media.read` 读取画面证据；用 `workspace.list` 查看工程目录，用 `workspace.search` 按文本定位源码。
2. 不熟悉属性格式时用 `docs.search` 和 `docs.read` 查看当前 TypeScript 定义。
3. 用 `source.read` 读取要修改文件的当前原文。
4. 用 `source.replace` 精确替换唯一原文。失败时重新读取该文件后再修改。
5. 新建或删除模块时分别使用 `source.create`、`source.remove`，并维护引用它的索引文件。
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

轨道属性和片段正文分开保存。`track.json` 引用 segment；片段按 30 秒窗口分组，每页最多 32 个。详细顶层结构查询 `docs/types/project-source-schema.ts`，片段字段查询 `docs/types/project.ts` 及它引用的类型文件。

## 时间轴硬性约束

- 音频和视频必须放在独立轨道。`media/index.json` 中 `hasAudio: true` 的视频只要没有明确要求静音，就必须同时创建 video 与 audio 片段；两者使用相同的 `mediaId`、`from`、`durationInFrames`、源区间和 `linkedGroupId`。`volume: 0` 表示 0 dB 的正常音量，不是静音；确实不要原声时在 video 上设置 `embeddedAudioMuted: true`。
- 文字片段的位置和尺寸只能写 `textBox: { left, top, width, height }`，四个字段都是相对画布的 `0..1` 归一化值，且整个框必须位于画布内。例如底部字幕可用 `{ "left": 0.1, "top": 0.78, "width": 0.8, "height": 0.12 }`。旋转锚点如有需要使用 `textAnchor: { x, y }`，同样是文字框内的 `0..1` 归一化坐标。文字的 `transform` 只用于旋转、透明度等非布局属性，禁止写 `x/y/width/height/anchorX/anchorY`，也不要使用不存在的 `scale`。
- 当前不要直接修改文字的空间关键帧（`animations.json` 中的 `x/y/width/height/anchorX/anchorY`）；静态文字布局统一使用 `textBox`，需要文字动画时优先使用非空间属性或现有动画能力。
- 轨道 `order` 越小，渲染层级越靠上。字幕文字必须放在 `kind: "subtitle"` 的可见轨道，并确保该轨道的 `order` 小于与它时间重叠的视频轨道，否则文字会被视频遮住。
- `git.commit` 会提交当前剪辑源码的完整变更，以保证提交本身可独立还原。提交前必须检查 `git diff`，保留并理解本轮开始前已经存在的相关修改。

## 协同编辑

- 人工编辑和 Agent 编辑同一套文件，源码修改成功后时间轴立即刷新。
- `source.replace` 的 `oldText` 必须来自最近一次 `source.read`，并且在文件中唯一匹配。
- `SOURCE_CHANGED` 或找不到原文表示人工或其他操作已修改文件；重新读取并合并意图。
- `SOURCE_AMBIGUOUS` 表示原文出现多次；扩大 `oldText` 上下文，不要盲目使用全局替换。
- 不要回退、覆盖或删除不属于当前任务的变更。

## 完成条件

纯文本任务直接输出最终正文。编辑任务必须具备可编译的工程、符合目标的 `git diff` 查询结果和一次成功的 `git.commit`。不要制造阶段发布、时间轴 revision 或第二次最终提交。
