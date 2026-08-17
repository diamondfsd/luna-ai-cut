---
name: luna-workflow-premiere
description: Premiere Pro 工作流映射技能。用户提到 Premiere、PR、三点剪辑、素材箱、Ripple、Roll、Slip、Slide、多机位、音频混合或 Lumetri 调色时使用；把专业剪辑思路映射到 Luna AI Cut，而不是模拟 Premiere 界面。
---

# Premiere Pro 工作流映射

## 素材整理

先用 `luna.media.list` 建立真实素材清单，再用 `luna.media.read`、`luna.media.analyze` 和字幕搜索形成 selects。按事件、人物、场景和声音角色整理内部镜头表，不按文件名猜内容。

## 时间轴概念映射

- 三点剪辑 -> 用素材 ID、源起止秒数、目标 `startSeconds` 和 `luna.timeline.addMedia` 一次确定范围。
- Ripple/删除空隙 -> 用 `luna.timeline.trim`、`luna.timeline.remove` 或 `luna.timeline.move`，完成后重新检查后续片段。
- Roll/Slip/Slide -> 当前没有同名工具；能用明确源范围和时间轴位置表达时执行，否则给出方案，不声称完成。
- 多机位 -> 先按台词、动作和连续性选择真实镜头，再批量加入，不能假设当前有自动多机位切换。
- 标题和 Essential Graphics -> 用 `luna.timeline.addText`、`luna.timeline.setTransform` 和 `luna.timeline.addKeyframe` 表达可用部分。

## 音频与色彩

用 `luna.timeline.setAudio` 处理对白、音乐、环境声和淡入淡出；需要配音或音乐时使用 `luna.audio.generateSpeech` / `luna.audio.generateMusic`。Lumetri/HSL 没有专用 Harness 工具时只输出校色方案，不声称已经调色。
