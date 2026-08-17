---
name: luna-style-music-video
description: 音乐视频风格技能。用户要求 MV、歌曲剪辑、音乐卡点、歌词画面、舞蹈或按副歌高潮组织镜头时使用；按歌曲段落和视觉母题构建节奏，不把每拍切换当成默认规则。
---

# 音乐视频

## 工作顺序

1. 确认使用哪首音乐；没有明确候选时先调用 `luna.media.list`。
2. 区分前奏、主歌、副歌、桥段和尾奏；没有可靠音乐结构证据时只描述为暂定段落。
3. 按动作、颜色、人物姿态、地点或道具建立视觉母题，让重复带来变化。
4. 用强拍、动作落点或段落变化安排切点；没有节拍分析时不声称完成自动卡点。

## 镜头规则

- 主歌允许更完整的动作和叙事，副歌增加景别、动作和镜头密度。
- 舞蹈或表演必须保留关键动作连续性，不为了每拍切断动作。
- 高潮前留出积累，高潮后保留反应、余韵或视觉停留。
- 歌词字幕必须来自用户文本或可靠转写，且有足够阅读时间。

## 工具路径

需要生成音乐时使用 `luna.audio.startMusic`，通过 `luna.audio.getTask` 查询到 `completed` 并取得 `mediaId` 后，再由模型判断是否调用 `luna.timeline.addMedia`。使用 `luna.timeline.addMediaBatch`、`luna.timeline.trim`、`luna.timeline.split` 和 `luna.timeline.addTransitionBatch` 执行剪辑；用 `luna.timeline.setAudio` 保持人声和音乐层级。
