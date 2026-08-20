# Luna SDK 能力说明

每个方法返回结构化结果，数据位于 `result.data`。所有编辑请求绑定到当前打开的 FreeCut 项目；先调用
`luna.project.inspect()`，不要猜测或替换 `projectId`。

## 项目和素材

- `luna.project.inspect()`：读取 `data.projectId`、`data.project`、当前时间线和计数。
- `luna.media.list({ limit? })`：列出当前项目素材，结果在 `data.items` 和 `data.total`。
- `luna.media.read({ mediaIds })`：读取素材元数据和已保存的画面/字幕分析证据，结果在 `data.items`。
- `luna.media.analyze({ mediaIds, kind })`：提交 `transcript` 或 `visual` 分析任务，立即返回 `data.taskId`。
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
- `luna.timeline.remove({ itemIds })`：删除一个或多个片段；关联片段可能级联删除。
- `luna.timeline.unlink({ itemIds })`：解除片段关联，不删除片段；只删除伴侣音频前必须先调用。
- `luna.timeline.mute({ itemIds, muted? })`：可靠地静音或取消静音；对视频片段调用时会同时处理关联原声。
- `luna.timeline.setProperties({ itemId, label?, text?, volume?, speed?, fadeIn?, fadeOut? })`：修改通用片段参数。
- `luna.timeline.setTransform({ itemId, x?, y?, width?, height?, rotation?, opacity?, flipHorizontal?, flipVertical?, cornerRadius? })`：修改画面变换。
- `luna.timeline.setAudio({ itemId, volume?, muted?, fadeIn?, fadeOut?, pitchSemitones? })`：修改音频参数；`volume` 是 dB，范围为 `-60` 到 `12`，`0` 不是静音，不能和 `muted` 同时传。
- `luna.timeline.addText({ text, startSeconds, durationSeconds, trackId?, style? })`：创建文字片段，应放在独立视频轨道。
- `luna.timeline.addKeyframe({ itemId, property, atSeconds, value, easing? })`：添加关键帧；当前 `value` 必须是数字。
- `luna.timeline.addTransition({ fromClipId, toClipId, type: 'crossfade', durationSeconds, presentation?, direction?, properties? })`：添加转场。

转场规则：`type` 只能是 `'crossfade'`，需要淡化视觉样式时另传 `presentation: 'fade'`，不要把 `'fade'` 作为 `type`，也不要省略 `type`。两个参与转场的画面片段必须在同一视频轨道，并在时间轴切点相邻；前片段需要未使用的源素材尾部，后片段需要未使用的源素材头部。先从 `timeline.inspectContext()` 检查 `from`、`durationInFrames`、`sourceStart`、`sourceEnd` 和 `sourceDuration`，再选择不超过两侧余量的时长。任一侧余量为 0 时转场不能创建；工具失败后读取错误并调整源区间或改用 `fadeIn/fadeOut`，不能假设转场已经存在。

## 结果和异步任务

编辑结果通常在 `result.data.project`，新建片段或轨道 ID 在 `result.data.createdItemIds`，受影响 ID 在 `result.data.affectedIds`。

素材分析、TTS、音乐和音效都是异步任务。提交后保存 `taskId`，反复调用对应查询方法，直到 `status === 'completed'` 或 `status === 'failed'`。`queued`、`preparing-model`、`generating` 和 `saving` 都表示仍在处理，不能当作失败或完成。失败时读取结构化错误；没有查询到完成且拿到有效 `mediaId` 前，不要把结果加入时间轴或声称任务完成。
