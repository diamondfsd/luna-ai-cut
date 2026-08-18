# AI 剪辑执行契约

这份契约适用于 AI 剪辑大师和所有风格技能。它规定如何从风格策略进入当前已有的素材和时间轴工具。

## 证据优先

开始规划前：

1. 读取适用的长期偏好，但把它们当作默认倾向。
2. 调用 `luna.media.list` 获取真实素材 ID、类型、时长和媒体状态。
3. 调用 `luna.project.inspect` 获取当前画布、轨道、片段和转场。
4. 需要按画面或口播选素材时，先调用 `luna.media.read`；证据不足再调用 `luna.media.analyze`。分析会立即返回 `taskId`，必须用 `luna.media.getAnalysisTask` 查询到 `completed` 或 `failed`，完成后再调用 `luna.media.read`。
5. 对局部时间轴编辑，在调用写入工具前使用 `luna.timeline.inspectContext` 重新确认片段 ID 和时间范围。

没有证据时，用“当前没有足够分析结果”描述事实，不要用文件名、用户形容词或旧的片段 ID 推断素材内容。

## 剪辑执行路径

风格由模型结合完整会话、项目规则、素材证据和已加载的风格技能自行判断，不再经过额外的风格协议或计划工具。

1. 先调用 `luna.media.list` 和 `luna.project.inspect`，需要看画面或台词时再调用 `luna.media.read` / `luna.media.analyze`；分析任务提交后用 `luna.media.getAnalysisTask` 轮询，不能把 `taskId` 当作素材 ID。
2. 在模型内部确定镜头顺序、源时间范围、节奏、声音和字幕策略后，在脚本中调用对应的 luna.timeline 方法。
3. 已经确定多条同类操作时，优先调用 `luna.timeline.addMediaBatch`、`luna.timeline.addTextBatch` 或 `luna.timeline.addTransitionBatch`，减少往返。
4. 每次写入后阅读返回的 `data`，完成一组编辑后再次调用 `luna.project.inspect`；工具结果必须交回模型继续判断。

## 时间轴工具规则

- 正常剪辑必须使用 `luna.timeline.*` 和 `luna.project.*` 工具，不能直接改工程 JSON。
- `mediaId` 必须来自当前项目的 `luna.media.list` 结果。
- 时间轴位置、片段长度、裁剪边界和转场长度使用秒。
- `luna.timeline.addKeyframe.atSeconds` 是片段内相对时间，不是成片绝对时间。
- `luna.timeline.setTransform` 使用归一化位置和尺寸，不要传入像素位置。
- 添加转场前调用 `luna.timeline.listTransitions`，只能使用返回的真实预设。
- 删除片段中间的一段时，先分割，再删除目标片段。
- 已经确定同类操作时，优先使用批量工具，减少不必要的中间状态。

## 每次编辑后的检查

每次编辑工具返回后：

1. 阅读 `data`，不要只看 `message`。
2. 确认返回的片段 ID、时间范围、素材 ID和轨道符合计划。
3. 如果失败，重新读取最新上下文，再决定修正或向用户说明。
4. 完成一组编辑后，再调用 `luna.project.inspect` 或 `luna.timeline.inspectContext` 复核。

工具执行成功不等于任务完成。必须把工具结果交回模型，由模型决定继续修改、补充检查或向用户汇报。

## 配音与背景音乐

- 需要新配音时调用 `luna.audio.startSpeech`，需要背景音乐时调用 `luna.audio.startMusic`。两者只提交后台任务；必须循环调用 `luna.audio.getTask`，直到任务完成后再使用返回的 `mediaId`。
- 任务完成后，先读取返回的结构化结果，再由模型决定是否调用 `luna.timeline.addMedia`、使用哪条轨道、从什么时间开始以及如何设置音量和淡入淡出。
- 生成音频不等于已经加入成片。宿主不能因为工具成功就自动入轴、自动选择轨道或自行宣告完成。
- 只有得到可靠节拍时间点或节拍分析结果时，才能把切点描述为节拍对齐；否则按段落、动作、台词和视觉变化组织节奏，并如实说明限制。

## 记忆边界

- 本轮时长、画幅、素材选择和临时要求不写入长期记忆。
- 项目专属规则属于项目规则，不写入用户记忆。
- 只有用户明确表达跨项目、可复用的偏好，或明确确认某项修正以后都适用时，才更新记忆。
- 更新前先搜索已有记忆，避免重复记录。
- 不把原始视频、完整聊天记录、人脸特征或声纹写入普通用户记忆。
