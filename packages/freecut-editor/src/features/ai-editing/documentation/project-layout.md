# 项目文件布局

`manifest.json` 是入口。主时间线位于 `sequences/main/`；复合片段位于 `components/`。

```text
manifest.json
sequences/main/
  sequence.json
  transitions.json
  animations.json
  tracks/id-<track-id>/
    track.json
    segments/w<30-second-window>-p<page>.json
components/
  index.json
  id-<component-id>/
    component.json
    transitions.json
    animations.json
    tracks/...
```

每个 `track.json` 只保存轨道属性。系统从 `tracks/*/track.json` 自动发现轨道，从各轨道的 `segments/*.json` 自动发现片段，不维护路径索引。片段按 30 秒窗口分文件，同一窗口每页最多 32 个片段。

文字片段的画布位置和尺寸使用 `textBox`，格式为 `{ left, top, width, height }`。所有值均为 `0..1` 的画布归一化比例，并且 `left + width <= 1`、`top + height <= 1`。自定义旋转锚点使用归一化的 `textAnchor: { x, y }`。文字源码禁止在 `transform` 中使用 `x/y/width/height/anchorX/anchorY`；这些是渲染器内部字段，不属于剪辑源码布局协议。

`media/`、`evidence/` 和 `docs/` 是运行时只读投影，不写入项目 Git 仓库。素材和当前工程证据从前两者查询；字段格式从 `docs/` 查询。

`media/index.json` 中每项同时包含 `id` 和 `ref`：工具调用和写入片段的 `mediaId` 都应使用原样的 `id`；`ref`（形如 `media:<id>`）只是只读投影中的兼容字段，不能写入工程源码。

编辑现有文件时先 `source.read`，再用 `source.replace` 提交唯一的 `oldText` 和 `newText`。替换失败表示文件已变化，重新读取后再决定修改。不要根据旧上下文覆盖整份文件。
