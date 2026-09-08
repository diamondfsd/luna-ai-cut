# Luna AI Cut 与 OpenReel 集成实施计划

## 目标

将 OpenReel 作为 Luna AI Cut 的对话式剪辑工作区，而不是一个拥有独立项目和独立素材副本的嵌入网页。集成后需要满足：

1. 剪辑必须隶属于 Luna 项目，项目可以创建、打开、重命名、删除和恢复。
2. 素材以本地文件路径为主，由 Electron 负责选择、读取、探测和流式播放，不通过浏览器文件输入框反复搬运大文件。
3. OpenReel 的时间线、轨道、片段、撤销和导出能力继续复用。
4. Luna 已有的素材分析、选片、字幕、抠像、消除、调色和美颜能力可以被编辑器和 AI 对话调用。
5. 原始素材不因进入 AI 编辑器而复制成另一份 Blob；代理、缩略图和分析缓存属于项目资源，并且可清理、可重建。

## 当前架构审计

| 能力 | Luna AI Cut 当前实现 | OpenReel 当前实现 | 集成问题 |
| --- | --- | --- | --- |
| 项目管理 | `workspace-projects/<id>/project.json`，由 Electron 的 `workspaceProjectService` 管理 | IndexedDB 自动保存，也支持独立 `.oreel` 文件 | 两套项目 ID、保存和最近项目列表，无法保证同一个项目 |
| 素材管理 | `WorkspaceProject.assets` 保存本地路径、设备信息和 Luna 编辑管线 | `MediaItem` 保存 `File/Blob`，大文件进入 IndexedDB | 进入 iframe 时发生文件复制，项目外部的素材分析无法直接关联 |
| 当前接入 | `/ai-editor` 通过 `AiEditorPage` 向 iframe 的 `<input type=file>` 注入 `File` | 走普通网页导入流程 | 依赖浏览器行为，不能利用 Electron 原生文件能力 |
| 桌面桥 | `window.luna` 已有项目、素材、ffprobe、FFmpeg、模型和导出 IPC | 注入脚本目前主要只映射 `window.openreel.fs` | OpenReel AI 工具和媒体导入还不能调用 Luna 服务 |
| AI 素材分析 | AI 选片已有质量、人物/人脸、内容/场景标签、构图、视频关键帧和故事板 | Agent 主要读取 OpenReel 项目状态并执行编辑动作 | 分析结果不在 OpenReel Agent 的可读上下文中 |
| AI 编辑能力 | 已有字幕转录、分割/抠像、对象消除、美颜、构图和调色等桌面服务 | Agent 工具循环和可撤销编辑已经存在 | 需要增加受控的能力适配层，不能让模型直接访问 Electron API |

相关实现位置：

- Luna 项目：`electron/features/workspace/workspaceProjectService.ts`、`src/shared/types/workspace.ts`。
- Luna AI 选片：`electron/features/ai-selection/`、`src/shared/types/aiSelection.ts`。
- Luna 桌面 API：`electron/preload.ts`、`src/shared/types/api.ts`、`electron/ipc/ipcWorkspaceService.ts`。
- OpenReel 项目和素材：`vendor/openreel/apps/web/src/services/project-manager.ts`、`vendor/openreel/apps/web/src/services/auto-save.ts`、`vendor/openreel/apps/web/src/stores/project/media-slice.ts`。
- 当前 iframe 接入：`src/pages/AiEditorPage.tsx`、`scripts/luna-openreel-bridge.js`。

## 架构决策

### 1. Luna 项目是唯一项目边界

不继续使用 OpenReel 的 IndexedDB 项目列表作为正式项目管理。`WorkspaceProject` 负责应用级项目身份、素材清单、Luna 编辑管线和 AI 资源；OpenReel 只作为该项目的一个编辑文档。

建议项目目录调整为：

```text
<baseDir>/workspace-projects/<projectId>/
├── project.json                 # Luna 项目主档、素材清单、Luna 管线
├── editor/openreel.json         # OpenReel 时间线、轨道、片段和编辑器设置
├── analysis/index.json          # 项目内 AI 分析摘要和版本
├── cache/thumbnails/            # 可重建缩略图
├── cache/proxies/               # 可重建代理视频
├── removal/                     # 现有对象消除结果和蒙版
└── exports/                     # 可选的项目导出中间产物
```

`project.json` 和 `editor/openreel.json` 分开保存，避免把 OpenReel 的时间线结构、Blob 字段和 Luna 的单素材编辑管线混在一个不容易迁移的 JSON 中。两者通过同一个 `projectId` 和稳定的 `assetId` 关联。

进入 `/ai-editor` 时只传 `projectId`，不再传一批临时 `media`。没有项目时先进入项目选择/新建流程；编辑器关闭或切换项目时先刷新保存，再释放当前项目资源。

### 2. 素材由 Luna 维护，OpenReel 只持有引用

OpenReel 的媒体条目需要增加或配套以下概念：

- `sourceAssetId`：对应 `WorkspaceProject.assets[].id`，作为跨模块唯一关联键。
- `sourcePath`：只在 Electron 侧的素材目录或运行时索引中维护，不进入模型消息；项目可迁移时优先通过资产指纹重新定位。
- `proxyPath`：项目级可重建代理，原始文件仍是导出和重新分析的依据。
- `metadataVersion`、`analysisVersion`：标记元数据和 AI 结果是否需要更新。

OpenReel 运行时的 `MediaItem` 可以保留兼容的 `blob` 字段，但桌面项目默认不填入完整 Blob。序列化时只保存媒体 ID、名称、元数据和来源提示；实际播放地址由媒体桥按 `sourceAssetId` 解析。

### 3. 使用受控的本地媒体协议

不建议把任意绝对路径直接拼成 `file://` 地址作为长期方案。当前窗口虽然关闭了部分 Web 安全限制，但这种方式会扩大 iframe 对本地文件的读取范围，也不利于检查项目权限和处理 Range 请求。

建议在 Electron 主进程注册受控的 `luna-media://` 协议：

1. renderer 只请求 `projectId + assetId` 或受控的资源令牌。
2. 主进程验证项目存在、资产属于该项目，并解析到当前允许读取的原始文件或代理文件。
3. 协议处理器支持视频的 Range/seek、图片和音频读取，并拒绝目录遍历、未知项目和不属于项目的路径。
4. 缩略图、代理和分析结果使用同一套项目资源解析规则。

这样浏览器只负责解码和渲染，Electron 负责文件权限、路径校验和流式读取，不需要把整个视频读入 JS 内存或 IndexedDB。

### 4. OpenReel 与 Luna 之间增加能力桥，而不是互相 import 业务代码

`luna-openreel-bridge.js` 继续作为 iframe 边界，但扩展为窄接口：

```text
window.openreel.lunaProject
  getCurrent(projectId)
  saveEditorDocument(projectId, document)
  listAssets(projectId)
  chooseAssets(projectId)
  resolveMedia(projectId, assetId)
  runAnalysis(projectId, assetId, kind)
  runEditingAi(projectId, assetId, operation)
```

实际 IPC 仍由 Luna `preload` 和主进程实现。OpenReel 的 React 组件不直接调用 `window.luna`，Agent 也不直接拿到 IPC；所有调用经过宿主服务、参数校验、项目归属校验和可取消任务管理。

### 5. AI 对话只通过“素材检索 + 编辑动作”工作

对话 Agent 的上下文分成三层：

1. **项目事实**：项目名称、画布、轨道、片段、素材数量和当前选择。
2. **素材索引**：资产名称、类型、时长、分辨率、拍摄设备、时间、质量、人物、场景标签、构图和视频分段。
3. **编辑动作**：导入、放置、修剪、分割、移动、字幕、效果、消除、导出等经过注册表校验的工具。

模型先调用只读检索工具，再使用稳定的 `projectId/assetId/clipId` 执行动作。例如：

```text
“找出有人的旅行视频，挑画面较好的片段放到主轨道并自动加字幕”
  -> search_project_assets(tags=[“人物”, “旅行”])
  -> get_video_segments(assetId)
  -> place_media_clip(assetId, segment)
  -> transcribe_subtitles(assetId)
  -> add_caption_track(...)
```

不把完整 AI 选片会话直接塞进系统提示；只把当前项目需要的摘要返回给模型，避免上下文膨胀。原始分析 JSON 留在项目资源中，可按版本重新生成。

## 可复用的 Luna AI 能力

### 素材理解和检索

- 基础质量：亮度、对比度、细节、清晰度、建议复查。
- 人物/人脸：人物存在、脸部数量、可见性、闭眼、人物分组和头像。
- 内容/场景：图片对象标签、场景标签、车辆、动物、室内、自然和城市等。
- 构图：主体位置、覆盖范围、构图评分和裁剪建议。
- 视频分析：关键帧、镜头变化、可用片段、故事板和视频人物证据。
- 字幕：本地音频转写和字幕轨道导出。

### 编辑和后处理

- 分割/抠像、实例选择、蒙版跟踪和对象消除。
- 美颜分析与局部调整。
- 调色、参考匹配和 LUT 生成。
- 预览帧、导出和代理生成。

图片生成仍保持关闭，不纳入这次集成目标。

## 分批实施计划

每批只允许一个 agent 修改当前范围；批次验收后先更新本文件的进度记录，再进入下一批。OpenReel 子模块批次按“子模块提交并推送 -> 根仓库更新子模块指针并推送”执行。

| 批次 | 范围 | 结果 | 状态 |
| --- | --- | --- | --- |
| 0 | 文档、数据边界和兼容策略 | 确认 Luna 项目为主档，确定 `editor/openreel.json`、资产 ID 和协议边界 | 已完成，本批 |
| 1 | 项目启动和保存 | `/ai-editor` 按 `projectId` 打开；OpenReel 读写项目目录中的 `editor/openreel.json`，嵌入项目跳过 IndexedDB 自动保存 | 已完成，本批 |
| 2 | 原生素材导入 | 通过 Electron 选择本地文件，主进程探测元数据、生成缩略图并登记到 Luna 项目；移除 `DataTransfer + File` 导入主路径 | 待处理 |
| 3 | 桌面媒体播放 | 实现受控本地媒体协议、Range/seek、原始文件/代理切换和缺失素材重连 | 待处理 |
| 4 | AI 素材索引 | 将现有分析结果按项目资产关联，提供质量、人物、内容、构图、关键帧和分段查询；支持按需分析、取消和缓存 | 待处理 |
| 5 | AI 对话工具 | 在 OpenReel Agent 中增加素材检索、视频分段、字幕和 Luna 编辑能力工具；所有写操作继续走同一撤销组和确认策略 | 待处理 |
| 6 | 导出和性能 | 代理策略、后台任务、导出路径、内存占用和大文件回归 | 待处理 |
| 7 | 迁移和验收 | 旧 `.oreel`、旧 IndexedDB 项目、旧 Luna 项目、缺失素材、项目重启和中断恢复 | 待处理 |

## 第一批建议先做什么

第一批代码不要同时实现全部 AI 能力，先完成项目主档和编辑器启动契约。本批已完成：

1. 给 `/ai-editor` 增加 `projectId` 路由状态和项目加载状态；无项目 ID 时返回工作台。
2. 在 Electron 项目服务中增加 `editor/openreel.json` 的读取、格式校验和临时文件原子保存。
3. iframe 通过窄桥接接口加载/保存项目文档；没有编辑文档时按 Luna 项目 ID 创建空 OpenReel 项目。
4. 嵌入 Luna 项目跳过 OpenReel IndexedDB 自动保存，改用编辑文档防抖保存和 `pagehide` 刷新；`forceSave()` 也统一走项目目录。
5. 保留当前 `DataTransfer` 导入作为兼容路径；原生素材登记和资产引用留到第二批。
6. 增加 Luna 项目加载、空文档初始化和安全序列化的定向测试。

本批已验证项目文档契约和构建；“重启后能重新打开同一项目、时间线和素材关系不丢失”还需要第二批完成原生素材引用后，进行 Electron 重启验收。

## 数据安全和性能约束

- 模型消息只携带项目摘要和必要的分析结果，不携带任意本地绝对路径、完整视频和大段 Base64。
- 每个 IPC 请求校验 `projectId`、`assetId` 与项目归属；所有路径解析后必须位于允许目录或已登记的原始文件位置。
- 原始文件不覆盖；代理、缩略图、帧图和分析结果可独立重建。
- 大视频默认优先代理预览，导出时按设置选择原片或代理；媒体读取支持取消和超时。
- AI 分析按需执行，使用资产指纹、模型版本和分析版本缓存，避免重复计算。
- 写入采用临时文件 + 原子替换；编辑文档和 Luna 项目主档更新失败时不能留下半写状态。
- 不把 OpenReel 的 Blob、FileSystemHandle 或浏览器对象写入正式项目 JSON。

## 验收标准

### 项目

- 没有 `projectId` 不能直接进入 AI 编辑器。
- 新建、打开、重命名、切换、关闭和重启后，项目名称、素材清单、时间线和撤销边界一致。
- 项目删除只删除项目目录和可重建资源，不误删项目外原始素材。

### 素材

- 导入使用 Electron 原生选择和主进程探测，不依赖 iframe 文件输入框。
- 大文件导入过程不产生整文件 Blob 副本；视频可拖动定位，素材元数据、缩略图和代理可复用。
- 原始文件移动或丢失时显示可恢复状态，不静默指向另一文件。

### AI

- AI 能按当前项目检索素材和视频分段，且不能访问其他项目资产。
- AI 读取分析结果后执行编辑动作，写操作仍可确认、撤销和回滚。
- 分析任务支持进度、取消、失败重试和版本失效；普通剪辑对话不因未启用视觉分析而失败。

### 工程验证

- 根仓库执行 `pnpm run build:app`。
- OpenReel 相关批次执行最小类型检查和对应测试。
- IPC、项目持久化、媒体路径校验、迁移和 AI 结果过期至少有非界面自动化覆盖。
- 里程碑阶段再使用 Playwright 验证 Electron 启动、项目重启和关键素材行为。

## 进度记录

### 2026-09-08：建立集成计划

- 已完成 Luna 和 OpenReel 的项目、素材、桌面桥和 AI 能力审计。
- 已确认当前 `/ai-editor` 通过 iframe 文件输入框注入 `File`，不能作为最终的本地素材导入方案。
- 已确认 Luna 已有可复用的素材分析和桌面 AI 服务，不需要重新做一套独立分析系统。
- 已确定第一原则：Luna 项目主档 + OpenReel 编辑文档 + 项目资产引用，避免两套项目状态和两份媒体副本。
- 本批只更新计划文档，未修改功能代码；下一批从项目启动和保存契约开始。

### 2026-09-08：完成第一批项目启动和保存

- 工作台项目卡可以按 `projectId` 打开 AI 剪辑；没有项目 ID 不再直接打开独立编辑器。
- Electron 在 `<baseDir>/workspace-projects/<projectId>/editor/openreel.json` 中保存编辑文档，使用临时文件 + 原子替换，并校验项目主体结构。
- OpenReel iframe 新增 `lunaProject` 桥接、`luna-editor` 路由和加载门控；空文档会创建使用 Luna 项目 ID 的空项目。
- Luna 项目不进入 OpenReel IndexedDB 自动保存，编辑变化通过防抖队列写回项目目录，窗口隐藏时尝试刷新。
- 验证通过：OpenReel web 类型检查、Luna 项目定向测试 3/3、OpenReel lint（0 errors）和根仓库 `pnpm run build:app`。
- 已知边界：本批尚未把本地素材登记为 OpenReel 资产引用，旧的 iframe `DataTransfer + File` 导入仍作为兼容路径；下一批处理原生素材导入。
