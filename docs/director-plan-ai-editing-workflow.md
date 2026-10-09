# AI 导拍与剪辑工作台

状态：PC 工作台已改为原生领域模型。拍摄计划、素材标注和 AI 剪辑共享一个 Agent 入口，分别使用本地拍摄计划、选片标注项目和 `LunaEditProject`；不再依赖旧的 Web 剪辑器或 iframe 工具桥。

## 工作流

### 拍摄计划

拍摄计划是独立交付，不要求先绑定素材、生成配乐或导出成片。Agent 按 App `shooting` v17 的字段与流程生成或修改计划，计划仍由 `director-lab` 负责持久化和 revision 校验。

### 素材点赞评论

用户可按素材整体点赞或不采用、写评论和标签，并在视频中标记点赞时间点、好片段与锁定范围。标注项目以稳定 `mediaId` 关联素材；Agent 按拍摄时间筛选，优先使用用户自己的点赞、评论、时间点和范围。真实抽帧只用于工具成功返回的画面证据，不从文件名推断事件，也不把稀疏帧说成完整视频理解。

### AI 剪辑

剪辑工程和拍摄计划、素材标注分开保存。`LunaEditProject` 使用稳定 project/source/clip ID 和乐观 revision。可编辑工程保存于 `baseDir/ai-editor-projects/<projectId>/project.json`。素材来源只接受主进程解析的本地 `mediaId`；渲染器与 Agent 工具不接收任意源文件路径。

PC 时间线支持视频和照片追加、插入、排序、替换、滑选、裁剪、原声音量、照片缓慢推近、变速曲线、片尾淡出、片段调色与构图裁切；全片支持本地 LUT、水印、配乐裁切/开关/音量和删除。配乐可读取 Luna 模板或根据 Music DSL 生成并挂接到工程。导出时对变速、照片运动与淡出片段做临时媒体预处理，再由 `luna-render-core` 合成画面；独立混音阶段把片段原声与配乐合成为 AAC。原片不被改写。

工作台使用 `LrcRender` 预览当前播放头所在片段、裁切、调色、LUT、水印和照片推近。工程导出通过主进程保存对话框和导出服务完成，先保存当前工程；只有导出服务成功返回输出位置才算导出完成。

## Agent 技能与工具

全局 Agent 页面是唯一聊天入口，技能由本机 MCP 服务动态发现。Agent 可选择 `shooting`、`footage-creation` 或 `editing-workspace`。界面不增加技能选择下拉框。

- `shooting`：读写本地拍摄计划，不声称计划已拍摄或剪辑。
- `footage-creation`：按 App skill v6 的时间窗、人工标注和最小抽帧原则查找素材；只问评论时只读回答，用户明确要求创作后才建立剪辑工程。
- `editing-workspace`：按 App skill v4 操作实时剪辑工程，批量校验后一次保存；使用真实滤镜、水印、素材和工程 revision。音乐生成也是工作区任务的一部分。
- `editing_workspace_undo_task`：仅当目标任务仍是该工程最近一次 Agent 修改时撤销，不覆盖较新的手动或 Agent 修改。

本地写操作校验 Agent session revision 与工程 revision。工程修改本身不代表导出成功；Agent 不能指定任意源路径，也不能绕过主窗口直接写入任意导出路径。

## 数据边界

- `baseDir/ai-editor-projects/`：剪辑时间线、效果、配乐与任务撤销信息。
- `baseDir/footage-selection-projects/`：人工点赞、评论、标签、时间点和片段范围。
- `director-lab`：独立管理拍摄计划；显式 ID 用于关联，不共用工程存储。
- `luna-render-core`：继续负责 PC 合成和编码。AI 编辑领域在其前后处理素材与音频，不把旧剪辑框架带回渲染链路。
