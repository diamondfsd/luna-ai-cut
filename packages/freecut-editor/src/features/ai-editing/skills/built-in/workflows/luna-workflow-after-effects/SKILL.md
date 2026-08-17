---
name: luna-workflow-after-effects
description: After Effects 动效工作流映射技能。用户提到 AE、合成、预合成、关键帧、Graph Editor、缓动、遮罩、跟踪、文字动画、Motion Blur 或粒子效果时使用；把动效拆成当前时间轴可以验证的部分。
---

# After Effects 动效工作流映射

## 动效拆解

把 composition 拆成时间轴段落，把 layer 拆成轨道片段或文字图层，把 pre-compose 拆成可独立检查的编辑组。先写清对象、起止状态、持续时间和层级，再执行。

## 当前工具映射

- 位置、缩放、旋转、透明度 -> `luna.timeline.setTransform` 和 `luna.timeline.addKeyframe`。
- 关键帧缓动 -> `luna.timeline.addKeyframe.easing`，只使用工具实际支持的 easing。
- 文字动画 -> `luna.timeline.addText`、`luna.timeline.setTransform`、`luna.timeline.addKeyframe`；字号使用 `fontSizeRatio`，不要传像素。
- 画中画和叠加 -> 独立轨道加归一化变换，先检查遮挡和安全区域。
- 遮罩、Track Matte、Motion Tracking、复杂粒子、Motion Blur -> 当前没有对应 Harness 工具时只输出设计参数和人工执行步骤。

## 检查

每次关键帧写入后读取 `data`，确认时间是片段内相对时间、画面没有越界、文字可读且没有遮挡主体。不要把“设计了 AE 效果”说成“已经渲染完成”。
