# 剪辑源码文档

这里的文档是只读的，不属于项目 Git 工作树。

- `docs/project-layout.md`：项目文件布局、分片规则和编辑流程。
- `docs/types/project-source-schema.ts`：每类工程 JSON 文件的顶层结构。
- `docs/types/project-source-schema.ts`：实际源码片段字段；文字布局以其中的 `textBox` 为准。
- `docs/types/project.ts`：渲染器内部项目与轨道字段，不要把文字的内部像素 transform 写入源码。
- `docs/types/timeline.ts`：各片段类型的详细字段。
- `docs/types/transform.ts`：位置、尺寸、旋转、透明度和裁剪。
- `docs/types/transition.ts`：转场。
- `docs/types/keyframe.ts`：关键帧和动画。

不熟悉字段时先用 `docs.search` 搜索属性名或类型名，再用 `docs.read` 读取命中的定义。实际项目文件中的原文仍需通过 `source.read` 获取。
