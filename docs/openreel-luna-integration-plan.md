# Luna AI Cut 与 OpenReel 集成实施计划

## 目标

将 OpenReel 作为 Luna AI Cut 的对话式剪辑工作区。AI 剪辑拥有独立的项目列表、项目 ID 和保存生命周期，不与 Luna 工作台项目清单混用；两者只共享受控的素材选择入口。

1. AI 剪辑项目可以独立创建、打开、重命名、删除和恢复；工作台项目的生命周期不影响 AI 剪辑项目。
2. 素材以本地文件路径为主，由 Electron 负责选择、读取、探测和流式播放，不通过浏览器文件输入框反复搬运大文件。
3. OpenReel 的时间线、轨道、片段、撤销和导出能力继续复用。
4. Luna 已有的素材分析、选片、字幕、抠像、消除、调色和美颜能力可以被编辑器和 AI 对话调用。
5. 原始素材不因进入 AI 编辑器而复制成另一份 Blob；代理、缩略图和分析缓存属于项目资源，并且可清理、可重建。

## 当前架构审计

| 能力 | Luna AI Cut 当前实现 | OpenReel 当前实现 | 集成问题 |
| --- | --- | --- | --- |
| 项目管理 | `workspace-projects/<id>/project.json`，由 Electron 的 `workspaceProjectService` 管理 | OpenReel 自己的 IndexedDB 自动保存、最近项目列表和 `.oreel` 文件 | 两套项目域应保持独立，不能把工作台项目 ID 当作 AI 项目 ID |
| 素材管理 | `WorkspaceProject.assets` 保存本地路径、设备信息和 Luna 编辑管线 | `MediaItem` 保存 `File/Blob`，大文件进入 IndexedDB | 进入 iframe 时发生文件复制，项目外部的素材分析无法直接关联 |
| 当前接入 | `/ai-editor` 嵌入 OpenReel；无项目参数时进入 OpenReel 欢迎页 | OpenReel 自己管理 AI 项目列表和编辑状态 | 不能再从工作台项目卡直接绑定或打开同一个项目 |
| 桌面桥 | `window.luna` 已有项目、素材、ffprobe、FFmpeg、模型和导出 IPC | 注入脚本映射 `window.openreel.fs`，并提供宿主素材选择请求 | OpenReel AI 工具和媒体分析还不能直接调用 Luna 服务 |
| AI 素材分析 | AI 选片已有质量、人物/人脸、内容/场景标签、构图、视频关键帧和故事板 | Agent 主要读取 OpenReel 项目状态并执行编辑动作 | 分析结果不在 OpenReel Agent 的可读上下文中 |
| AI 编辑能力 | 已有字幕转录、分割/抠像、对象消除、美颜、构图和调色等桌面服务 | Agent 工具循环和可撤销编辑已经存在 | 需要增加受控的能力适配层，不能让模型直接访问 Electron API |

相关实现位置：

- Luna 项目：`electron/features/workspace/workspaceProjectService.ts`、`src/shared/types/workspace.ts`。
- Luna AI 选片：`electron/features/ai-selection/`、`src/shared/types/aiSelection.ts`。
- Luna 桌面 API：`electron/preload.ts`、`src/shared/types/api.ts`、`electron/ipc/ipcWorkspaceService.ts`。
- OpenReel 项目和素材：`vendor/openreel/apps/web/src/services/project-manager.ts`、`vendor/openreel/apps/web/src/services/auto-save.ts`、`vendor/openreel/apps/web/src/stores/project/media-slice.ts`。
- 当前 iframe 接入：`src/pages/AiEditorPage.tsx`、`scripts/luna-openreel-bridge.js`。

## 架构决策

### 1. AI 剪辑和工作台是两个项目域

`WorkspaceProject` 和 OpenReel `Project` 是两套独立的项目模型：

- 工作台项目由 `workspaceProjectService` 管理，负责工作台素材清单、Luna 编辑管线和工作台资源。
- AI 剪辑项目由 OpenReel 的项目管理、自动保存和最近项目列表管理，使用 OpenReel 自己的 `project.id`。
- 工作台项目可以删除、重命名或切换，但不得改变 AI 剪辑项目列表；反向同样成立。
- AI 剪辑从工作台选择素材时只接收素材引用，不创建或更新 `WorkspaceProject`。

当前嵌入入口的生命周期是：

1. 访问 `/ai-editor` 进入 OpenReel `#/welcome`，由 OpenReel 展示自己的最近项目和新建入口。
2. 打开项目后，OpenReel 用自己的项目 ID 管理时间线、素材引用、撤销记录和 AI 对话上下文。
3. OpenReel 素材面板请求素材时，宿主只打开工作区素材弹窗并回传选择结果。
4. AI 项目删除或切换只作用于 OpenReel 项目，不触发工作台项目删除或素材登记。

旧的 `lunaProject.load/save` 和 `luna-editor` 适配代码暂时保留，作为历史兼容层；正常入口不再传入 Luna 工作台 `projectId`，也不使用该兼容层保存 AI 项目。

### 2. AI 项目只持有素材引用

OpenReel 的媒体条目需要增加或配套以下概念：

- `sourceAssetId`：对应素材选择结果中的资产 ID；它不代表 AI 项目属于某个工作台项目，跨会话以 `sourcePath` 和资产指纹辅助匹配。
- `sourcePath`：用于桌面读取和重连，不进入模型消息；项目可迁移时优先通过资产指纹重新定位。
- `proxyPath`：项目级可重建代理，原始文件仍是导出和重新分析的依据。
- `metadataVersion`、`analysisVersion`：标记元数据和 AI 结果是否需要更新。

OpenReel 运行时的 `MediaItem` 可以保留兼容的 `blob` 字段，但桌面项目默认不填入完整 Blob。序列化时只保存媒体 ID、名称、元数据和来源提示；实际播放地址由媒体桥按 `sourceAssetId` 解析。

### 3. 使用受控的本地媒体协议

不建议把任意绝对路径直接拼成 `file://` 地址作为长期方案。当前窗口虽然关闭了部分 Web 安全限制，但这种方式会扩大 iframe 对本地文件的读取范围，也不利于检查项目权限和处理 Range 请求。

建议在 Electron 主进程注册受控的 `luna-media://` 协议：

1. renderer 只请求 OpenReel 项目 ID、资产 ID 或受控的资源令牌。
2. 主进程验证 AI 项目和资产引用，再解析到当前允许读取的原始文件或代理文件；不能借用工作台项目 ID 绕过校验。
3. 协议处理器支持视频的 Range/seek、图片和音频读取，并拒绝目录遍历、未知项目和不属于项目的路径。
4. 缩略图、代理和分析结果使用同一套项目资源解析规则。

这样浏览器只负责解码和渲染，Electron 负责文件权限、路径校验和流式读取，不需要把整个视频读入 JS 内存或 IndexedDB。

### 4. OpenReel 与 Luna 之间增加能力桥，而不是互相 import 业务代码

`luna-openreel-bridge.js` 继续作为 iframe 边界，但扩展为窄接口：

```text
window.openreel.lunaProject
  getCurrent(projectId)
  saveEditorDocument(projectId, document)
  chooseAssets(projectId, existingPaths)
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
| 0 | 文档、数据边界和兼容策略 | 确认 AI 剪辑项目与 Luna 工作台项目分离，确定资产引用和协议边界 | 已完成，本批 |
| 1 | 项目启动和保存 | `/ai-editor` 打开 OpenReel 独立项目列表；OpenReel 自己管理项目和自动保存 | 已完成，本批修订 |
| 2 | 原生素材导入 | 通过工作区素材弹窗选择本地/已下载素材；OpenReel 保存 `sourceAssetId/sourcePath` 引用，不写入工作台项目 | 已完成，本批修订 |
| 3 | 桌面媒体播放 | 实现受控本地媒体协议、Range/seek、原始文件/代理切换和缺失素材重连 | 待处理 |
| 4 | AI 素材索引 | 将现有分析结果按项目资产关联，提供质量、人物、内容、构图、关键帧和分段查询；支持按需分析、取消和缓存 | 待处理 |
| 5 | AI 对话工具 | 在 OpenReel Agent 中增加素材检索、视频分段、字幕和 Luna 编辑能力工具；所有写操作继续走同一撤销组和确认策略 | 待处理 |
| 6 | 导出和性能 | 代理策略、后台任务、导出路径、内存占用和大文件回归 | 待处理 |
| 7 | 迁移和验收 | 旧 `.oreel`、旧 IndexedDB 项目、旧 Luna 项目、缺失素材、项目重启和中断恢复 | 待处理 |

## 当前已落地

本阶段先固定项目边界和素材入口，再继续实现桌面媒体播放与 AI 能力：

1. `/ai-editor` 无参数时进入 OpenReel `#/welcome`，由 OpenReel 展示独立的 AI 项目列表；旧的工作台项目参数不再作为打开依据。
2. OpenReel AI 项目使用自己的项目 ID、自动保存、最近项目和切换流程，不与 `WorkspaceProject` 共享项目清单。
3. 历史的 `lunaProject` 文档桥接和 Electron 项目文档服务暂时保留兼容代码，但正常入口不再把 AI 编辑文档写入工作台项目目录。
4. 从本地资源页带素材进入 AI 剪辑时只保留兼容的 `media` 初始导入路径；正式项目素材通过 OpenReel 素材面板选择。
5. 素材面板通过宿主复用工作区素材弹窗，返回素材引用和基础元数据，不复制完整 Blob，也不登记到工作台项目。

## 数据安全和性能约束

- 模型消息只携带项目摘要和必要的分析结果，不携带任意本地绝对路径、完整视频和大段 Base64。
- 每个 AI 能力请求校验 OpenReel `projectId`、`assetId` 与 AI 项目归属；素材选择请求不能把工作台项目 ID 当作 AI 项目 ID。
- 原始文件不覆盖；代理、缩略图、帧图和分析结果可独立重建。
- 大视频默认优先代理预览，导出时按设置选择原片或代理；媒体读取支持取消和超时。
- AI 分析按需执行，使用资产指纹、模型版本和分析版本缓存，避免重复计算。
- 文件写入采用临时文件 + 原子替换；AI 项目自动保存失败不能破坏工作台项目，工作台项目更新失败也不能破坏 AI 项目。
- 不把 OpenReel 的 Blob、FileSystemHandle 或浏览器对象写入正式项目 JSON。

## 验收标准

### 项目

- 没有 OpenReel 项目 ID 时进入 AI 项目列表，不直接进入某个编辑器项目。
- AI 项目的新建、打开、重命名、切换、关闭和重启只影响 AI 项目自身。
- 删除工作台项目不删除 AI 项目；删除 AI 项目不删除工作台项目或项目外原始素材。

### 素材

- 导入通过宿主复用工作区素材弹窗和 Electron 原生文件选择，再由主进程补充基础元数据，不依赖 iframe 文件输入框。
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
- 已确定第一原则：AI 剪辑项目与工作台项目分离，素材只通过引用共享，避免两份媒体副本。
- 本批只更新计划文档，未修改功能代码；下一批从项目启动和保存契约开始。

### 2026-09-08：完成第一批项目启动和保存

- 初版曾让工作台项目卡按 `projectId` 打开 AI 剪辑，后续已按项目边界要求改为独立 AI 项目入口。
- 初版 Electron 在 `<baseDir>/workspace-projects/<projectId>/editor/openreel.json` 中保存编辑文档，相关兼容代码暂时保留。
- OpenReel iframe 新增 `lunaProject` 桥接、`luna-editor` 路由和加载门控；空文档会创建使用 Luna 项目 ID 的空项目。
- 初版嵌入 Luna 项目跳过 OpenReel IndexedDB 自动保存，后续独立项目方案不再走该路径。
- 验证通过：OpenReel web 类型检查、Luna 项目定向测试 3/3、OpenReel lint（0 errors）和根仓库 `pnpm run build:app`。
- 已知边界：本批尚未把本地素材登记为 OpenReel 资产引用，旧的 iframe `DataTransfer + File` 导入仍作为兼容路径；下一批处理原生素材导入。

### 2026-09-09：第二批素材选择与引用登记（初版）

- OpenReel 素材面板的“导入素材/添加素材”在 Luna 项目内改为请求宿主页面打开现有 `WorkspaceImportDialog`，弹窗继续复用本地文件选择和已下载素材列表。
- 初版宿主页面会登记选中素材到 `WorkspaceProject.assets`，该行为已在本次修订中移除。
- OpenReel 新增 `importWorkspaceAsset`，媒体条目只保存 `sourceAssetId`、`sourcePath`、基础元数据和缩略图，不调用 Blob 导入或 IndexedDB 媒体存储；重复选择按资产 ID/路径去重。
- 取消、页面卸载和选择超时都会结束素材选择请求，避免 iframe 内 Promise 长时间挂起。
- 定向验证通过：OpenReel `src/stores/project-store.test.ts`（81 passed、4 skipped）、OpenReel monorepo 类型检查、应用根目录类型检查；OpenReel Lint 仍为 0 errors。
- 已知边界：媒体引用目前仍有 `blob: null`，时间线预览、拖动定位、音频解码和导出读取仍依赖下一批的 `luna-media://` 受控媒体协议；无宿主选择器时保留原生文件输入兼容路径。

### 2026-09-09：修订为独立 AI 项目列表

- `/ai-editor` 无参数时直接打开 OpenReel `#/welcome`，使用 OpenReel 自己的最近项目和新建项目入口，不再跳转工作台。
- 工作台项目列表移除“在 AI 剪辑中打开”按钮，避免把工作台项目误认为 AI 剪辑项目；本地资源页的带素材入口仅作为兼容的初始素材导入。
- 素材选择请求携带当前 OpenReel `project.id` 和已有 `sourcePath`，宿主只复用 `WorkspaceImportDialog` 选择素材、补充基础元数据并回传，不调用 `addAssetsToProject`。
- OpenReel 的素材引用按当前 AI 项目去重；AI 项目的保存、切换和删除与 Luna 工作台项目互不影响。
- 已验证：根仓库类型检查、OpenReel monorepo 类型检查、`src/stores/project-store.test.ts`（81 passed、4 skipped）、桥接脚本语法检查、`git diff --check` 和 `pnpm run build:app` 均通过；根仓库 lint 仍受 44 条既有 warning 限制，未发现本批改动产生的 error。

### 2026-09-09：AI 剪辑入口与页面保活

- AI 剪辑菜单现在优先进入 OpenReel `#/welcome` 独立项目列表，重复点击菜单也会重新回到项目列表，不再依赖当前工作台项目。
- `/ai-editor` 路由改为保活，切换到其他菜单时只隐藏页面，不卸载 OpenReel iframe；切回其他菜单后，编辑器项目状态和对话上下文继续保留。
- 从本地资源页带素材进入的兼容流程仍打开 `#/new` 并导入初始素材；AI 剪辑菜单入口则始终打开 `#/welcome`。
- 切换项目列表或离开 AI 剪辑时，会取消未完成的素材选择请求，避免工作区弹窗关闭后 iframe 请求悬挂。
- 本阶段暂不拆分独立 Electron 窗口；单窗口保活已满足历史项目选择和编辑状态保持需求，多窗口方案留待后续按窗口生命周期、项目锁和资源隔离单独设计。
- 验证通过：根仓库类型检查、OpenReel monorepo 类型检查、OpenReel 定向测试（81 passed、4 skipped）、桥接脚本语法检查、变更范围 Lint、`git diff --check` 和 `pnpm run build:app`；根仓库完整 Lint 仍因既有 warning 超出 `--max-warnings 0` 失败，本批新增代码无 error 或新增 warning。

### 2026-09-09：补充强制项目管理入口

- 确认 OpenReel 原本已有 `WelcomeScreen` 和 `RecentProjects`，但 `skipWelcomeScreen` 开启后，访问 `#/welcome` 会自动跳转到编辑器，因此不能作为 AI 剪辑的稳定项目入口。
- 新增 OpenReel `#/projects` 路由和独立项目列表页，复用现有自动保存项目恢复逻辑，支持查看历史项目、打开项目和新建项目。
- Luna 的 AI 剪辑菜单改为进入 `#/projects`；该入口不受 OpenReel “启动时跳过”设置影响，解决打开后直接进入剪辑页的问题。
- 项目数据仍由 OpenReel 自己保存和恢复，未引入 Luna 工作台项目列表，也未改变两个项目域的边界。
- 验证通过：OpenReel monorepo 类型检查、OpenReel 项目存储测试（81 passed、4 skipped）、子模块 Lint（0 errors）、根仓库类型检查、`pnpm run build:app` 和 `git diff --check`。

### 2026-09-09：调整项目列表与编辑器层级

- 明确 AI 剪辑交互层级：项目列表是模块首页，编辑器是打开项目后的第二层页面。
- 移除项目列表中的“返回编辑器”按钮，避免首页出现不符合层级的反向入口。
- 在编辑器左上角增加“返回项目列表”图标按钮，点击后进入 `#/projects`，当前项目继续由 OpenReel 自动保存管理。
- 验证通过：OpenReel monorepo 类型检查、变更范围 Lint、根仓库类型检查、`pnpm run build:app` 和 `git diff --check`。

### 2026-09-09：移除项目列表重复 header

- 根据界面反馈移除项目列表页顶部重复 header，避免同时出现两个“新建项目”入口。
- 项目列表保留下方的标题和单一新建入口；编辑器返回项目列表仍使用编辑器左上角图标按钮。
- 验证通过：OpenReel 页面变更范围 Lint、OpenReel 与根仓库类型检查、`pnpm run build:app` 和 `git diff --check`。
