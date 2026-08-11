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

每个 `track.json` 只保存轨道属性和 segment 引用。片段按 30 秒窗口分文件，同一窗口每页最多 32 个片段。创建、删除或移动片段时必须同步维护 `track.json` 的 `segments` 索引。

`media/`、`evidence/` 和 `docs/` 是运行时只读投影，不写入项目 Git 仓库。素材和当前工程证据从前两者查询；字段格式从 `docs/` 查询。

`media/index.json` 中每项同时包含 `id` 和 `ref`：写入片段的 `mediaId` 必须使用原样的 `id`；`ref`（形如 `media:<id>`）只用于需要素材引用的分析工具，不能写入工程源码。

编辑现有文件时先 `source.read`，再用 `source.replace` 提交唯一的 `oldText` 和 `newText`。替换失败表示文件已变化，重新读取后再决定修改。不要根据旧上下文覆盖整份文件。
