# 剪辑源码工作协议

## 最短工作流

1. 用 `workspace.list` 查看目录，用 `workspace.search` 定位相关素材、证据或源码。
2. 不熟悉属性格式时用 `docs.search` 和 `docs.read` 查看当前 TypeScript 定义。
3. 用 `source.read` 读取要修改文件的当前原文。
4. 用 `source.replace` 精确替换唯一原文。失败时重新读取该文件后再修改。
5. 新建或删除模块时分别使用 `source.create`、`source.remove`，并维护引用它的索引文件。
6. 用 `timeline.check` 确认完整工程可编译，用 `git.diff` 检查实际变化。
7. 所有目标完成后调用 `git.commit`。提交成功就是本轮编辑完成，不需要额外发布。

只读取与任务有关的文件。互不依赖的查询可以同一轮执行；写操作有依赖时按顺序执行。工具返回失败时根据最新原文和错误信息修正，不重复发送相同参数。

## 仓库布局

```text
manifest.json
sequences/main/
  sequence.json
  transitions.json
  animations.json
  tracks/id-<track-id>/
    track.json
    segments/w<window>-p<page>.json
components/
  index.json
  id-<component-id>/...
media/       # 只读
evidence/    # 只读
docs/        # 只读，当前 TypeScript 类型与格式说明
```

轨道属性和片段正文分开保存。`track.json` 引用 segment；片段按 30 秒窗口分组，每页最多 32 个。详细顶层结构查询 `docs/types/project-source-schema.ts`，片段字段查询 `docs/types/project.ts` 及它引用的类型文件。

## 协同编辑

- 人工编辑和 Agent 编辑同一套文件，源码修改成功后时间轴立即刷新。
- `source.replace` 的 `oldText` 必须来自最近一次 `source.read`，并且在文件中唯一匹配。
- `SOURCE_CHANGED` 或找不到原文表示人工或其他操作已修改文件；重新读取并合并意图。
- `SOURCE_AMBIGUOUS` 表示原文出现多次；扩大 `oldText` 上下文，不要盲目使用全局替换。
- 不要回退、覆盖或删除不属于当前任务的变更。

## 完成条件

纯文本任务直接输出最终正文。编辑任务必须具备可编译的工程、符合目标的 `git.diff` 和一次成功的 `git.commit`。不要制造阶段发布、时间轴 revision 或第二次最终提交。
