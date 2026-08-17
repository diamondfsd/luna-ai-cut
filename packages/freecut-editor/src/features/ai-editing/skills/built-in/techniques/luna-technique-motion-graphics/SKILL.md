---
name: luna-technique-motion-graphics
description: 动效与图形技能。用户要求标题动画、关键帧、缓动、推拉摇移、遮罩、画中画、合成、跟踪或 AE 风格动效时使用；把效果拆成可验证的时间轴参数，不假设未注册的跟踪能力。
---

# 动效与图形

## 动效拆解

- 先确定对象、起止状态、持续时间、运动方向、缓动和遮挡关系。
- 画面位置和尺寸使用归一化比例；`x/y` 是画布中心点，不能传像素。
- 文字先确定内容、可读时长和安全区域，再加位置、缩放、透明度或关键帧。

## 可执行路径

1. 用 `luna.timeline.addText` 或 `luna.timeline.addTextBatch` 创建文字；用 `luna.timeline.setTransform` 设置初始状态。
2. 用 `luna.timeline.addKeyframe` 创建位置、尺寸、旋转、透明度或字号变化；`atSeconds` 使用片段内相对秒数。
3. 使用 `linear`、`ease-in`、`ease-out` 或 `ease-in-out`，根据动作目的选择，不默认所有动画都弹跳。
4. 写入后读取返回数据，检查文字没有越界、遮挡主体或短到无法阅读。

## AE 思路的通用化

- 把 composition 理解为一个可检查的时间轴段落，把 pre-compose 理解为分组或独立的编辑段落。
- 把 graph editor 的原则转成关键帧间隔和 easing 选择；不要声称生成了曲线编辑器数据。
- 把 mask、track matte、motion tracking 和复杂粒子效果视为能力要求；当前没有对应工具时只给设计方案。
- 运动必须服务于注意力、层级或转场，不为每个对象添加动画。

## 检查标准

关键帧结果必须交回模型继续判断。若效果依赖遮罩、跟踪、复杂合成或渲染预览，而当前工具没有提供，不要伪造完成状态。
