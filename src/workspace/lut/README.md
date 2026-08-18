---
name: lut-filter-feature
description: 滤镜/LUT功能 — WebGPU 3D LUT 渲染管线 + 工作台滤镜面板
metadata:
  type: project
---

Luna AI Cut 的滤镜/LUT 功能，完整链路从 GPU 渲染到 UI 交互。

## 架构

### 链路

```
用户选择滤镜
  → FilterPanel (UI)
  → EditPipeline.lutFilter.activeId (string)
  → PreviewStage.useEffect 触发加载
  → LutManager.ensureLoaded(id)
    → builtinLuts.ts 生成 .cube 数据 (或用户导入)
    → window.lunaRenderCore.readLutFile(path) — IPC 读取文件文本
    → WebGpuCompositionRenderer: 解析 .cube 并创建 3D texture
  → PreviewStage: layer.lutId = LUT 文件路径
  → WebGPU 合成 shader: 绑定 LUT 纹理并采样
```

### 内置滤镜 (6种)

| ID | 名称 | 效果 |
|----|------|------|
| `japanese-fresh` | 日系清新 | 偏亮、轻微冷调、柔和 |
| `vintage` | 胶片复古 | 褪色、暖调、暗部提亮 |
| `black-white` | 黑白经典 | Rec.709 亮度权重、高对比 |
| `sport` | 高饱和运动 | 高饱和、冷色偏蓝 |
| `cool-cinema` | 冷调电影 | 青蓝调、电影感、暗部压低 |
| `portrait` | 奶油人像 | 肤色提亮、暖调、暗部淡化 |

### 关键文件

| 文件 | 角色 |
|------|------|
| `electron/ipcLunaRenderCore.ts` | LUT 文件读取、导入和资源包 IPC |
| `electron/preload.ts` | 暴露 LUT 文件读取和资源管理 API |
| `src/workspace/lut/builtinLuts.ts` | 内置 LUT 生成器 (17级 .cube) |
| `src/workspace/lut/LutManager.ts` | 全局 LUT 生命周期管理 |
| `src/workspace/lut/FilterPanel.tsx` | 滤镜 UI 面板 |
| `src/components/PreviewStage.tsx` | LUT GPU ID 状态 + 注入渲染层 |
| `src/workspace/shared/editPipeline.ts` | `lutFilter.activeId` 管线字段 |

### WebGPU 端

| 文件 | 角色 |
|------|------|
| `src/lib/webgpu/composition.ts` | `.cube` 解析、3D 纹理创建和 LUT 采样 |
| `src/lib/webgpu/lut-source.ts` | LUT 文件读取和 WebGPU 资源复用 |

### 使用方式

用户点击滤镜侧边栏 → 选择内置滤镜 → 立即生效。可导入自定义 `.cube` 文件。
对比模式 (Space键) 会临时移除滤镜。
批量导出时自动加载 LUT。
