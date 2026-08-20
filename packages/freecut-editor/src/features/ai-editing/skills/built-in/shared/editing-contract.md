# AI 剪辑执行契约

这份契约是所有 Luna AI Cut 技能和 SDK 调用的共同规则。

## 脚本入口和证据

- 唯一编辑入口是 `edit.run_script`，脚本导出 `default async function main(luna)`。
- 不直接修改项目文件、时间线内部 Store 或 Electron 状态。
- 第一次编辑前调用 `luna.project.inspect()` 和 `luna.timeline.inspectContext()`；素材选择依赖画面或台词时，再调用 `media.read` 或提交 `media.analyze` 并轮询任务。
- 所有 SDK 方法的实际结果从 `result.data` 读取。每次写入都等待工具结果，完成一组操作后重新检查时间线。

## 时间线和轨道

- 时间参数使用秒：`trim` 使用绝对时间轴位置，`split` 使用绝对时间轴位置，`move` 使用目标起点。
- 先规划轨道：字幕、标题和画面叠加使用独立视频轨道；TTS、音乐和音效使用独立音频轨道。
- 转场只能使用 `type: 'crossfade'`，两个画面片段必须在同一视频轨道的切点相邻，并且两侧都有未使用的源素材余量。失败后重新读取时间线，不要假设转场已创建。

## 关联原声、删除和静音

带原声的视频由视频片段和关联音频片段组成，真正播放的原声通常是关联音频片段。

- 只删除伴侣音频并保留视频：先调用 `luna.timeline.unlink({ itemIds: [audioId] })`，再调用 `luna.timeline.remove({ itemIds: [audioId] })`。直接 remove 仍可能按关联规则级联删除视频。
- 静音使用 `luna.timeline.mute({ itemIds: [videoId] })`，对视频 ID 调用时会同时处理关联音频；也可以传准确的音频 ID。
- `setAudio.volume` 是 dB，范围为 `-60` 到 `12`；`0` 是正常的 0 dB，不是静音。静音应使用 `mute` 或 `setAudio({ muted: true })`，不要用 `volume: 0` 表示静音。
- 静音后必须在返回的项目数据中确认目标音频的 `volume === -60`，否则不能向用户声称已经静音。

## 异步能力和复核

- TTS、音乐、音效和素材分析先返回 `taskId`，必须查询到 `completed` 或 `failed`。
- 只有异步任务完成并返回有效 `mediaId` 后，才能加入时间轴；失败时读取结构化错误，不要假设结果存在。
- 工具结果必须返回给模型继续判断，宿主不根据自然语言文案替模型决定意图、继续、停止或完成。
