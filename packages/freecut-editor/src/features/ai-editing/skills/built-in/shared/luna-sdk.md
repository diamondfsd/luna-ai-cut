# Luna SDK 能力说明

每个方法返回结构化结果，数据位于 `result.data`。所有编辑请求绑定到当前打开的 FreeCut 项目；先调用
`luna.project.inspect()`，不要猜测或替换 `projectId`。

当 `result.data.externalFile` 存在时，说明完整结果超过宿主的内联大小上限，`data` 中不会包含完整的
`tracks`、`items` 或其他大数组；完整 JSON 位于 `result.data.externalFile.path`。此路径相对于当前 Harness
会话工作区，使用 Harness 内置 `read` 工具读取，传入 `file_path`、`offset` 和 `limit` 分段查看。先读取
`data.summary` 判断需要的范围，再按需读取文件；不要把文件路径交给 `edit.run_script`，也不要假设外置结果仍有 `data.items`。

## 项目和素材

- `luna.project.inspect()`：读取 `data.projectId`、`data.project`、当前时间线和计数。
- `luna.media.list({ limit? })`：列出当前项目素材，结果在 `data.items` 和 `data.total`。
- `luna.media.read({ mediaIds, transcriptOffset?, transcriptLimit? })`：读取素材元数据和已保存的画面/字幕分析证据，结果通常在 `data.items`。如果 `data.externalFile` 存在，说明结果已外置，脚本中不能再访问 `data.items`；优先按单个 `mediaId` 分批读取，或使用 Harness 的 `read` 工具查看外置文件。长转录按页读取：使用 `transcript.nextOffset` 继续，片段带有源素材时间和可用的词级时间。
- `luna.media.analyze({ mediaIds, kind: 'transcript' })`：提交音频转录任务，立即返回 `data.taskId`。长视频必须先完成这一步。
- `luna.media.analyze({ mediaIds, kind: 'visual' })`：批量分析不超过 12 个短视频或图片的画面；批量调用时不要传 `timeRanges`。
- `luna.media.analyze({ mediaIds: [mediaId], kind: 'visual', timeRanges: [{ startSeconds, endSeconds }] })`：只分析一个视频给定源区间附近的画面。每段最多 60 秒，最多 12 段、合计最多 8 分钟；`timeRanges` 不能按 `mediaIds` 一一对应批量传入，长视频不能省略它。
- `luna.media.getAnalysisTask({ taskId })`：轮询分析任务；完成后再用 `media.read` 读取证据，失败时读取错误字段。
- `luna.media.searchTranscript({ query, mediaIds? })`：搜索已完成的字幕识别结果，结果在 `data.matches`。

## 记忆和音频任务

- `luna.memory.read({ memoryIds?, scope?, videoType?, limit? })` 和 `luna.memory.search({ query?, scope?, videoType?, limit? })`：读取或搜索跨项目长期剪辑偏好，结果在 `data.entries`。
- `luna.memory.update({ memoryId?, scope, videoType?, topic, preference, evidence? })`：新增或更新长期偏好；更新时复用准确的 `memoryId`。
- `luna.memory.remove({ memoryIds })`：按读取结果中的准确 ID 删除，结果在 `data.removedIds` 和 `data.missingIds`。
- `luna.audio.startSpeech({ text, voice?, speed? })`：提交 TTS 任务，立即返回 `data.taskId`。
- `luna.audio.startMusic({ prompt, model?, durationSeconds?, guidanceScale? })`：提交音乐或音效任务；`model` 使用 `small-music` 或 `small-sfx`，立即返回 `data.taskId`。
- `luna.audio.getTask({ taskId })`：查询 TTS、音乐或音效任务；只有 `status === 'completed'` 且有 `data.mediaId` 才能加入时间轴。

## 时间线读取和轨道

- `luna.timeline.inspectContext()`：读取轨道、片段、关联关系、转场和关键帧。
- `luna.timeline.addTrack({ type: 'video' | 'audio', name?, order? })`：创建独立轨道，使用返回的 `data.createdItemIds[0]` 作为后续 `trackId`。
- `luna.timeline.moveTrack({ trackId, aboveTrackId?, belowTrackId? })`：调整已有轨道的层级。`aboveTrackId` 和 `belowTrackId` 只能传一个；移动后被调整轨道会位于锚点轨道的上方或下方。两个轨道必须是同一种类型。
- `luna.timeline.addMedia({ mediaId, startSeconds?, durationSeconds?, sourceStartSeconds?, sourceEndSeconds?, trackId? })`：将素材加入时间轴。
- `luna.timeline.addMediaBatch({ items: [...] })`：批量加入素材，`items` 使用 `addMedia` 的参数格式。

## RemotionClip 源码片段

RemotionClip 是时间线中的特殊片段：项目目录内的 `src/Root.tsx` 及其组件源码是唯一编辑源，MP4 只是带有源码版本和校验值的渲染缓存。需要修改 Remotion 画面时，不能直接改 MP4，也不能调用文件系统；必须读取并更新源码，再预览或渲染。

- `luna.render.remotionList()`：列出当前项目的 RemotionClip，读取 `clipId`、`sourceRevision`、`sourceHash` 和缓存状态。
- `luna.render.remotionCreate({ input: { mediaIds?, width?, height?, fps?, durationInFrames?, files? } })`：创建项目内 RemotionClip。没有 `files` 时会生成可编辑的 `src/Root.tsx` 模板。
- `luna.render.remotionReadSource({ clipId })`：读取源码文件集合。先保存返回的 `sourceRevision`。
- `luna.render.remotionUpdateSource({ clipId, expectedRevision, files, removeFiles? })`：以源码文件路径为键更新 TSX/TS 文件。必须传入刚读取的 revision；版本冲突时重新读取，不能覆盖他人的修改。
- `luna.render.remotionPreview({ clipId, expectedRevision? })`：用当前源码生成预览任务。
- `luna.render.remotionRender({ clipId, expectedRevision? })`：用当前源码生成绑定到该 clip 的 MP4 缓存。
- `luna.render.remotionGetTask({ taskId })`：轮询预览或渲染任务，只有 `status === 'completed'` 才算完成；检查返回的 `clipId`、`sourceRevision` 和 `sourceHash` 是否仍与当前 clip 一致。

Remotion 任务结果不会向模型暴露宿主绝对路径。不要自行构造路径，也不要把源码复制到项目外；渲染期间源码发生变化时，旧任务结果不能替代新版本。

字幕、标题和其他画面叠加先创建独立视频轨道，并确认其 `order` 小于要覆盖的视频轨道；需要调整已有轨道时使用 `moveTrack`，不要只修改返回数组中的位置。TTS、背景音乐和音效先创建独立音频轨道；原始视频产生的伴侣音频保留在原音频轨道。

轨道层级示例：

```js
const context = await luna.timeline.inspectContext()
const videoTrack = context.data.tracks.find((track) => track.kind === 'video')
if (!videoTrack) throw new Error('没有可覆盖的视频轨道')

const added = await luna.timeline.addTrack({ type: 'video', name: '字幕' })
const subtitleTrackId = added.data.createdItemIds[0]
await luna.timeline.moveTrack({
  trackId: subtitleTrackId,
  aboveTrackId: videoTrack.id,
})
```

## 时间线编辑

- `luna.timeline.trim({ itemId, startSeconds?, endSeconds? })`：使用时间轴上的绝对秒数，不是素材源区间。
- `luna.timeline.split({ itemId, atSeconds })`：在时间轴绝对位置切开片段。
- `luna.timeline.move({ itemId, toSeconds, trackId? })`：将片段起点移动到时间轴绝对位置，可同时更换轨道。
- `luna.timeline.remove({ itemIds })`：删除一个或多个片段；单独删除关联原声音频时会先自动解除关联。
- `luna.timeline.removeAudio({ itemIds })`：删除背景音乐或视频原声并保留画面。可传音频片段 ID，也可传视频片段 ID；关联原声会自动解除后删除，没有伴侣时会关闭内嵌原声。
- `luna.timeline.fitAudioToVisual({ itemIds? })`：把独立背景音乐截短到当前画面时间轴的最晚结束点；完全落在画面之后的独立音频会移除。默认处理全部独立音频，不处理视频原声伴侣；原声删除请使用 `removeAudio()`。
- `luna.timeline.unlink({ itemIds })`：只解除片段关联，不删除片段；如果目标是删除原声或音乐，直接使用 `removeAudio()`，它会自动解除关联。
- `luna.timeline.mute({ itemIds, muted? })`：可靠地静音或取消静音；对视频片段调用时会同时处理关联原声。
- `luna.timeline.setProperties({ itemId, label?, text?, volume?, speed?, fadeIn?, fadeOut? })`：修改通用片段参数。
- `luna.timeline.setTransform({ itemId, x?, y?, width?, height?, rotation?, opacity?, flipHorizontal?, flipVertical?, cornerRadius? })`：修改画面变换。
- `luna.timeline.setAudio({ itemId, volume?, muted?, fadeIn?, fadeOut?, pitchSemitones? })`：修改音频参数；`volume` 是 dB，范围为 `-60` 到 `12`，`0` 不是静音，不能和 `muted` 同时传。
- `luna.timeline.addText({ text, startSeconds, durationSeconds, trackId?, style? })`：创建文字片段，应放在独立视频轨道。
- `luna.timeline.addKeyframe({ itemId, property, atSeconds, value, easing? })`：添加关键帧；当前 `value` 必须是数字。
- `luna.timeline.addTransition({ fromClipId, toClipId, type: 'crossfade', durationSeconds, presentation?, direction?, properties? })`：添加转场。

背景音乐的时长必须按实际画面结束时间处理：先读取视频轨道最大 `from + durationInFrames`，再用
`luna.timeline.fitAudioToVisual({ itemIds: [musicId] })` 截掉超出的尾部；不要因为用户目标是 30 秒就把音乐固定加入 30 秒。
- `luna.timeline.effects.add({ clipId, type, params?, enabled? })`、`update({ clipId, effectId, params?, enabled? })`、`remove({ clipId, effectId })`：管理当前 FreeCut 已注册的 GPU 效果。`type` 必须是编辑器效果注册表中的 ID；参数必须符合对应效果的参数定义，写入后应通过 `timeline.inspectContext()` 和预览复核。

转场规则：`type` 只能是 `'crossfade'`，需要淡化视觉样式时另传 `presentation: 'fade'`，不要把 `'fade'` 作为 `type`，也不要省略 `type`。两个参与转场的画面片段必须在同一视频轨道，并在时间轴切点相邻；前片段需要未使用的源素材尾部，后片段需要未使用的源素材头部。先从 `timeline.inspectContext()` 检查 `from`、`durationInFrames`、`sourceStart`、`sourceEnd` 和 `sourceDuration`，再选择不超过两侧余量的时长。任一侧余量为 0 时转场不能创建；工具失败后读取错误并调整源区间或改用 `fadeIn/fadeOut`，不能假设转场已经存在。

## 结果和异步任务

编辑结果通常在 `result.data.project`，新建片段或轨道 ID 在 `result.data.createdItemIds`，受影响 ID 在 `result.data.affectedIds`。

素材分析、TTS、音乐和音效都是异步任务。提交后保存 `taskId`，反复调用对应查询方法，直到 `status === 'completed'` 或 `status === 'failed'`。`queued`、`preparing-model`、`generating` 和 `saving` 都表示仍在处理，不能当作失败或完成。失败时读取结构化错误；没有查询到完成且拿到有效 `mediaId` 前，不要把结果加入时间轴或声称任务完成。

长片工作流固定为：转录音频并按页读取完整结果 → 根据对白/声音内容选择源区间 → 只对这些区间做视觉抽帧 → 复核真实画面证据后剪辑。不要为了找镜头而对整部电影做均匀视觉扫描。
