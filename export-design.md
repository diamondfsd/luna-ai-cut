# 导出任务记录 + 统一 API 改造方案

> 基于 `export-status.md` 的分析，对导出系统进行重构设计。

---

## 一、目标

1. **统一的任务记录系统** — JSON 文件持久化，跨会话保留
2. **统一的 API** — 前端一个 `window.luna.exportTask` 搞定，不再散落各处
3. **所有导出都写记录** — Rust lrc 的图片/视频导出全部走任务记录
4. **删除 FFmpegFast** — 不再使用的代码清理掉
5. **Rust 图片导出改异步** — 和视频一样通过 AsyncTask 跑，避免阻塞主进程

---

## 二、Rust 改动：图片导出异步化

### 当前

```rust
// lib.rs — 同步，阻塞主进程
#[napi]
pub fn export_image_from_sources(...) -> napi::Result<()> {
    lock(|c| export::export_image_from_sources(...))
}
```

### 改后

```rust
// 新增 AsyncTask，和 export_file_async 同样的模式
pub struct ExportImageFromSourcesTask { ... }

impl Task for ExportImageFromSourcesTask {
    type Output = ();
    fn compute(&mut self) -> napi::Result<()> {
        lock(|c| export::export_image_from_sources(...))
    }
    fn resolve(&mut self, _env: Env, _output: ()) -> napi::Result<()> { Ok(()) }
}

#[napi]
pub fn export_image_from_sources_async(...) -> AsyncTask<ExportImageFromSourcesTask> {
    AsyncTask::new(ExportImageFromSourcesTask { ... })
}
```

图片是单帧处理，没有"进度"概念，异步化的意义是：

- 不阻塞 Electron 主进程（目前图片导出是同步调 `.node`，大图会卡 UI）
- `ipcLunaRenderCore.ts` 可以通过 `.then()` 发 `export:progress`（status: done/failed），驱动任务记录自动更新

### Electron 封装

`electron/lunaRenderCore.ts` 新增：

```typescript
export function exportImageFromSourcesAsync(...): Promise<void> {
  ensureInit()
  return getNative().exportImageFromSourcesAsync(...)
}
```

`electron/ipcLunaRenderCore.ts` 中 `lrc:exportImageFromSources` 改为异步模式：

```typescript
ipcMain.handle('lrc:exportImageFromSources', async (event, ...) => {
  // 发 exporting 事件
  event.sender.send('export:progress', { exportId, status: 'exporting', percent: 0 })

  await lrcExportImageFromSourcesAsync(ffmpegPath, ffprobePath, output, width, height, layers, format, quality)

  // 发 done 事件  
  event.sender.send('export:progress', { exportId, status: 'done', percent: 100, destinationPath })
})
```

---

## 三、任务记录服务

### 3.1 存储模型

文件路径：`{userData}/.luna-cache/export-tasks.json`

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "t_1749038400000",
      "name": "导出 5 个文件",
      "totalCount": 5,
      "status": "completed",
      "progress": 100,
      "startTime": 1749038400000,
      "endTime": 1749038500000,
      "duration": 100000,
      "items": [
        {
          "exportId": "exp_001",
          "fileName": "DSC_001.insv",
          "kind": "video",
          "status": "done",
          "progress": 100,
          "startTime": 1749038400000,
          "endTime": 1749038480000,
          "duration": 80000,
          "destinationPath": "/path/to/export/DSC_001.mp4"
        }
      ]
    }
  ]
}
```

### 3.2 文件：`electron/exportTaskService.ts`

```
╔══════════════════════════════════════════════╗
║  exportTaskService.ts                        ║
║                                              ║
║  loadTasks()       ← 启动时从 JSON 读入内存   ║
║  saveTasks()       ← 每次变更后同步写回        ║
║                                              ║
║  createTask(name, items?) → taskId           ║
║  addItems(taskId, items)                     ║
║  updateItem(taskId, exportId, data)          ║
║  recalcTask(taskId)          ← 自动聚合       ║
║  cancelTask(taskId)                          ║
║  getTask(taskId) → record                    ║
║  getTasks() → records                        ║
║  clearTasks()                                ║
║  pruneTasks()              ← 保留最近30天     ║
╚══════════════════════════════════════════════╝
```

核心逻辑 `recalcTask`：

```
recalcTask(taskId):
  items = task.items

  状态聚合:
    all done      → completed
    any failed    → failed
    all canceled  → canceled
    otherwise     → exporting

  进度聚合:
    progress = avg(items[].progress)

  时间聚合:
    endTime = max(items[].endTime)
    duration = endTime - startTime
```

### 3.3 文件：`electron/ipcExportTask.ts`

统一 IPC 通道：

| IPC 通道 | 对应方法 |
|---------|---------|
| `export-task:create` | `createTask(name, items?)` |
| `export-task:add-items` | `addItems(taskId, items)` |
| `export-task:update-item` | `updateItem(taskId, exportId, { progress?, status?, error?, destinationPath? })` |
| `export-task:cancel` | `cancelTask(taskId)` |
| `export-task:get` | `getTask(taskId)` |
| `export-task:list` | `getTasks()` |
| `export-task:clear` | `clearTasks()` |

### 3.4 Preload 暴露

```typescript
// electron/preload.ts
window.luna.exportTask = {
  create: (name, items?) => ipcRenderer.invoke('export-task:create', name, items),
  addItems: (taskId, items) => ipcRenderer.invoke('export-task:add-items', taskId, items),
  updateItem: (taskId, exportId, data) => ipcRenderer.invoke('export-task:update-item', taskId, exportId, data),
  cancel: (taskId) => ipcRenderer.invoke('export-task:cancel', taskId),
  get: (taskId) => ipcRenderer.invoke('export-task:get', taskId),
  list: () => ipcRenderer.invoke('export-task:list'),
  clear: () => ipcRenderer.invoke('export-task:clear'),
}
```

清理旧 API：删除 `window.luna.getExportTasks`、`window.luna.cancelExportTask`、`window.luna.workspace.createExportTask`、`window.luna.getExportTask`。

---

## 四、lrc 集成：所有导出自动写记录

### 4.1 流程图

```
              创建任务集
               createTask("批量导出", items)
                    │
                    ▼
          ┌─────────────────┐
          │  exportTask      │
          │  updateItem()    │ ← status: exporting
          └────────┬────────┘
                   │
          ┌────────▼────────┐
          │  lrc.exportVideo │
          │  / exportImage   │ ← Rust 异步执行
          └────────┬────────┘
                   │
          ┌────────▼────────┐
          │  exportTask      │
          │  updateItem()    │ ← progress / status: done|failed
          └─────────────────┘
```

### 4.2 关键改动：`electron/ipcLunaRenderCore.ts`

**视频导出 `lrc:exportVideo`（已有异步，加调 exportTaskService）：**

```typescript
ipcMain.handle('lrc:exportVideo', async (event, inputPath, outputPath, cw, ch, ...) => {
  // ❗ 新增参数：taskId, exportId（由调用方传递）
  const { taskId, exportId } = ... // 从参数或调用方上下文

  if (taskId && exportId) {
    await exportTaskService.updateItem(taskId, exportId, { status: 'exporting' })
  }

  lrcExportFileAsync(...)
    .then(() => {
      sendProgress(event, { status: 'done', ... })
      if (taskId && exportId) {
        exportTaskService.updateItem(taskId, exportId, { status: 'done', progress: 100, destinationPath })
      }
    })
    .catch((err) => {
      sendProgress(event, { status: 'failed', error })
      if (taskId && exportId) {
        exportTaskService.updateItem(taskId, exportId, { status: 'failed', error })
      }
    })

  // 定期进度也写记录
  // 在 sendProgress 中同时调 exportTaskService.updateItem()
})
```

**图片导出 `lrc:exportImageFromSources`（改为异步模式）：**

```typescript
ipcMain.handle('lrc:exportImageFromSources', async (event, output, width, height, layers, format, quality) => {
  // ❗ 新增参数：taskId, exportId

  if (taskId && exportId) {
    await exportTaskService.updateItem(taskId, exportId, { status: 'exporting' })
  }

  await lrcExportImageFromSourcesAsync(ffmpegPath, ffprobePath, output, width, height, layers, format, quality)

  sendProgress(event, { exportId, status: 'done', percent: 100, destinationPath: output })

  if (taskId && exportId) {
    await exportTaskService.updateItem(taskId, exportId, { status: 'done', progress: 100, destinationPath: output })
  }
})
```

### 4.3 调用方改造

**PreviewStage.export()** 改为创建任务记录：

```typescript
// 之前：直接 lrc().exportImageFromSources() / lrc().exportVideo()
// 之后：
const taskId = await window.luna.exportTask.create("帧导出", [
  { exportId, fileName, kind }
])

await window.luna.exportTask.updateItem(taskId, exportId, { status: 'exporting' })

// 调用 lrc 时传入 taskId + exportId（让 ipcLunaRenderCore 自动更新记录）
// ... 调用 lrc.exportVideo / exportImageFromSources
```

**导出任务调度器 `exportTaskRunner.ts`** 改用新 API：

```typescript
// 之前：window.luna.workspace.createExportTask + updateTaskItemProgress
// 之后：
const task = await window.luna.exportTask.create(taskName, items)
// 并发调度逻辑不变
// 每项执行时调 updateItem
```

---

## 五、批量导出流程

```
用户选中 N 个文件 → 导出
  │
  ├─ 弹出 ExportModal（水印设置）
  │
  ├─ 确认后：
  │     const items = files.map(f => ({
  │       exportId: generateId(),
  │       fileName: f.name,
  │       kind: f.kind,
  │     }))
  │     const taskId = await exportTask.create("导出 N 个文件", items)
  │
  ├─ 并发调度（复用 exportTaskRunner）:
  │     图片 4 路 / 视频 1 路
  │     for each item:
  │       调 lrc.exportVideo / exportImageFromSources（传入 taskId + exportId）
  │       → Rust 异步执行
  │       → ipcLunaRenderCore 自动：
  │           · 通过 'export:progress' 事件通知前端实时进度
  │           · 通过 exportTaskService.updateItem() 写 JSON 持久化记录
  │
  └─ 全部完成：
        ExportTaskTable 自动刷新显示最新状态
```

---

## 六、删除 FFmpegFast 清单

| 文件 | 动作 | 备注 |
|------|------|------|
| `electron/ipcWorkspaceFfmpegExport.ts` | 🗑️ 删 | FFmpegFast 主入口 |
| `electron/ffmpeg/pipelineCompiler.ts` | 🗑️ 删 | 仅被上面引用 |
| `electron/ffmpeg/colorGrading.ts` | 🗑️ 删 | 仅被 pipelineCompiler 引用 |
| `electron/ffmpeg/watermark.ts` | 🗑️ 删 | 同上 |
| `electron/ffmpeg/codec.ts` | 🗑️ 删 | 仅 FFmpegFast 和 videoPipelineService 使用 |
| `electron/ffmpeg/bitrate.ts` | 🗑️ 删 | 同上 |
| `electron/ffmpeg/scale.ts` | 🗑️ 删 | 仅 videoPipelineService |
| `electron/ffmpeg/framerate.ts` | 🗑️ 删 | 同上 |
| `electron/ffmpeg/hwaccel.ts` | 🗑️ 删 | 仅 FFmpegFast + videoPipelineService 使用 |
| `electron/videoPipelineService.ts` | 🗑️ 删 | FFmpeg 管线封装 |
| `electron/lunaExportService.ts` | 🗑️ 删 | 旧版 Worker 导出 |
| `electron/exportWorker.ts` | 🗑️ 删 | 旧版 Worker 入口 |
| `electron/ipcLunaExport.ts` | 🔄 重构 | 去掉 Worker 部分，`getTasks`/`clearTasks` 迁移到新服务 |
| `src/workspace/shared/canExportFFmpeg.ts` | 🗑️ 删 | FFmpegFast 判断 |
| `src/workspace/shared/exportUtils.ts` | 🗑️ 删 | 曲线→FFmpeg filter |

**保留（其他地方在使用）：**

| 文件 | 保留原因 |
|------|---------|
| `electron/ffmpeg/pipeline.ts` | 提供 `getFfmpegPath()` / `getFfprobePath()` / `probeMedia()`，lrc 要用 |
| `electron/ffmpeg/lutGenerator.ts` | 创意模式的 `bakeAndGetLut` / `bakeColorLutData` 还在用 |
| `electron/livePhotoService.ts` | 创意模式 TripleStitch 还在用 |

---

## 七、实施步骤

### Phase 1：基础服务（exportTaskService）

```
Step 1  electron/exportTaskService.ts   新建 — 核心 CRUD + JSON 持久化
Step 2  electron/ipcExportTask.ts       新建 — 统一 IPC 通道
Step 3  electron/preload.ts             更新 — 挂 window.luna.exportTask
Step 4  electron/exportStubs.ts         删除，旧引用改为新 API
Step 5  electron/ipcLunaExport.ts       清理 — 去掉 Worker 部分
Step 6  src/shared/types/export.ts      更新 — 确认类型完备
```

### Phase 2：Rust 图片导出异步化

```
Step 7  luna-render-core/src/lib.rs     新增 export_image_from_sources_async
Step 8  electron/lunaRenderCore.ts      新增 exportImageFromSourcesAsync
Step 9  electron/ipcLunaRenderCore.ts   改为异步 + 发进度事件 + 写任务记录
```

### Phase 3：前端集成

```
Step 10 src/lib/useExportTask.ts        新建 Hook
Step 11 src/lib/exportTaskRunner.ts     重构 — 用新 API
Step 12 src/components/PreviewStage.tsx 导出时创建任务记录
Step 13 src/components/ExportTaskTable.tsx 改为 exportTask.list()
Step 14 src/context/AppContext.tsx      简化 exportProgress 逻辑
```

### Phase 4：清理

```
Step 15 删除 FFmpegFast 相关代码（见上方清单）
Step 16 验证全流程：媒体库批量导出 / PreviewStage 导出 / 记录弹窗
```

---

## 八、类型定义（最终版）

```typescript
// src/shared/types/export.ts

/** 创建/追加子任务的输入 */
export interface ExportItemInput {
  exportId: string
  fileName: string
  kind: 'image' | 'video'
}

/** 子任务记录 */
export interface ExportTaskItem extends ExportItemInput {
  status: 'queued' | 'exporting' | 'done' | 'failed' | 'canceled'
  progress: number
  startTime: number
  endTime: number | null
  duration: number | null
  destinationPath?: string
  error?: string
}

/** 父任务记录 */
export interface ExportTaskRecord {
  id: string
  name: string
  totalCount: number
  status: 'pending' | 'exporting' | 'completed' | 'failed' | 'canceled'
  progress: number
  startTime: number
  endTime: number | null
  duration: number | null
  items: ExportTaskItem[]
}
```

---

## 九、未解决的问题 / 待讨论

1. **`lrc:exportVideo` 的 taskId 传递** — 当前 Rust 的 `task_id` 仅用于取消/进度查询。我们需要在 `lrc:exportVideo` 的 IPC 参数中传入 `exportTaskTaskId` + `exportId` 两个字段。实现方式有两种：
   - A) 加到 `lrc:exportVideo` 的 IPC 参数中（推荐，改动最小）
   - B) 在 `ipcLunaRenderCore.ts` 内部维护一个 `Map<lrcTaskId, { exportTaskId, exportId }>` 映射

2. **导出记录上限** — JSON 文件中保留多少条记录？建议最多 200 条/最近 30 天，超出自动清理。

3. **前端实时刷新方式** — 当前 `ExportTaskTable` 用轮询（2s 间隔）+ 事件混合。建议改为全部事件驱动（`export:progress` 事件到达时自动刷新），减少轮询。
