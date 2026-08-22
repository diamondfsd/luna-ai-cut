# AI 剪辑执行契约

这份契约是所有 Luna AI Cut 技能和 SDK 调用的共同规则。

## 脚本入口和证据

- 唯一编辑入口是 `edit.run_script`，脚本导出 `default async function main(luna)`。
- 不直接修改项目文件、时间线内部 Store 或 Electron 状态。
- 第一次编辑前调用 `luna.project.inspect()` 和 `luna.timeline.inspectContext()`；素材选择依赖画面或台词时，再调用 `media.read` 或提交 `media.analyze` 并轮询任务。
- 所有 SDK 方法的实际结果从 `result.data` 读取。每次写入都等待工具结果，完成一组操作后重新检查时间线。

## 动画成片和交付门禁

- 用户要求连续动画、知识点动效、RemotionClip 或 video-shotcraft 时，必须使用 RemotionClip 实际生成动画并渲染成片；Remotion 是硬性要求，不能用 `addText`、TTS、音乐或静止信息卡替代。
- Remotion 的创建、源码更新、预览或渲染失败后，必须读取结构化错误并停止当前交付流程。不能把失败任务当成成功，也不能以字幕卡降级后宣告完成。
- 画布尺寸、帧率和最终时长必须在创建字幕和音频前确定。Remotion 分镜、旁白、字幕、音乐使用同一份章节时间表；每个字幕的结束帧必须不晚于主视觉结束帧。
- 异步音频只有在 `status === 'completed'` 且有有效 `mediaId` 时才能加入时间线；`failed`、缺少 `mediaId` 或 `durationInFrames <= 1` 的结果必须删除或忽略。
- 所有编辑结束后调用 `luna.render.preflight({ maxDurationSeconds })`。`data.ready === false` 或 `data.issues` 含有 `severity: 'error'` 时不得回复完成，必须根据 `code` 和 `entityIds` 修复后再次调用。
- 成片交付前再调用 `luna.render.layout()` 检查文字框边界，并调用 `luna.render.frame()` 检查实际画面；只检查素材或时间线结构不算视觉验收。

## 时间线和轨道

- 时间参数使用秒：`trim` 使用绝对时间轴位置，`split` 使用绝对时间轴位置，`move` 使用目标起点。
- 先规划轨道：字幕、标题和画面叠加使用独立视频轨道；TTS、音乐和音效使用独立音频轨道。
- 轨道的 `order` 是画面层级：数值越小，轨道越靠上，预览和导出时越先显示在上层。字幕、标题和画面叠加必须是 `video` 轨道，并且 `order` 小于它们覆盖的视频轨道；不能把字幕放在视频轨道下方。
- 创建轨道时可以通过 `addTrack({ order })` 指定层级；调整已有轨道时使用 `moveTrack({ trackId, aboveTrackId })` 或 `moveTrack({ trackId, belowTrackId })`，两个锚点参数只能传一个。移动前先从 `timeline.inspectContext()` 读取真实轨道 ID 和 `order`，不要猜 ID，也不要依赖轨道数组顺序。
- 转场只能使用 `type: 'crossfade'`，两个画面片段必须在同一视频轨道的切点相邻，并且两侧都有未使用的源素材余量。失败后重新读取时间线，不要假设转场已创建。

## 关联原声、删除和静音

带原声的视频由视频片段和关联音频片段组成，真正播放的原声通常是关联音频片段。

- 只删除伴侣音频并保留视频：调用 `luna.timeline.removeAudio({ itemIds: [audioId] })`；它会自动解除关联后删除音频。`timeline.remove()` 删除单独的关联原声音频时也会自动解除关联。
- 静音使用 `luna.timeline.mute({ itemIds: [videoId] })`，对视频 ID 调用时会同时处理关联音频；也可以传准确的音频 ID。
- `setAudio.volume` 是 dB，范围为 `-60` 到 `12`；`0` 是正常的 0 dB，不是静音。静音应使用 `mute` 或 `setAudio({ muted: true })`，不要用 `volume: 0` 表示静音。
- 静音后必须在返回的项目数据中确认目标音频的 `volume === -60`，否则不能向用户声称已经静音。

## 异步能力和复核

- TTS、音乐、音效和素材分析先返回 `taskId`，必须查询到 `completed` 或 `failed`。
- 只有异步任务完成并返回有效 `mediaId` 后，才能加入时间轴；失败时读取结构化错误，不要假设结果存在。
- 工具结果必须返回给模型继续判断，宿主不根据自然语言文案替模型决定意图、继续、停止或完成。
