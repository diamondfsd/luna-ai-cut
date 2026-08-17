---
name: luna-workflow-capcut
description: 剪映工作流映射技能。用户提到剪映、剪映专业版、抖音模板、关键帧、蒙版、文本、画中画、变速、HSL、卡点或剪映教程时使用；将这些概念翻译为 Luna AI Cut 的真实素材和时间轴操作。
---

# 剪映工作流映射

## 先抽象需求

把剪映教程中的按钮或模板翻译成结果属性：镜头速度、文字位置、图层关系、遮挡、声音层级、颜色方向和切点。不要假设 Luna AI Cut 有同名面板，也不要把剪映模板当作可直接导入的工程。

## 概念映射

- 关键帧 -> `luna.timeline.addKeyframe`；位置和尺寸使用 0 到 1 的归一化值，时间是片段内相对秒数。
- 文本 -> `luna.timeline.addText` / `luna.timeline.addTextBatch`，先保证内容和阅读时长。
- 画中画 -> `luna.timeline.addMedia` 放入独立轨道，再用 `luna.timeline.setTransform` 设置位置和尺寸。
- 变速 -> `luna.timeline.split` 后用 `luna.timeline.setProperties.speed` 分段调整。
- 卡点 -> 需要真实节拍或明确时间点；没有节拍工具时按动作和段落规划，不声称自动完成。
- 蒙版、HSL、复杂特效 -> 当前没有对应 Harness 工具时，只输出参数方案和人工操作说明。

## 执行

先 `luna.media.list`、`luna.project.inspect`，再根据证据用批量时间轴工具执行。工具结果必须返回模型继续判断，是否把生成的音乐或配音放入时间轴由模型结合用户目标决定。
