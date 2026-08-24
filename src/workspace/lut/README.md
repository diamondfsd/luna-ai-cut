---
name: lut-filter-feature
description: 滤镜/LUT功能 — wgpu 3D LUT 渲染管线 + 工作台滤镜面板
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
    → window.lunaRenderCore.loadLut(Uint8Array) — IPC
    → electron/main: native.loadLut(cubeData) — Rust NAPI
    → Rust: parse_cube_lut() + create_lut_3d_texture() → 3D texture → GPU ID
  → PreviewStage: gpuLutId (state)
  → buildAdjustedLayers: layer.lutId = gpuLutId
  → LrcRender: buildCompositionFromPreviewLayers → CompositionLayer.lutId
  → Rust: render() → bind lut_3d texture → apply_lut() in WGSL
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
| `electron/platform/render/lunaRenderCore.ts` | Native `loadLut`/`releaseLut` 封装 |
| `electron/ipcLunaRenderCore.ts` | IPC handler 'lrc:loadLut' / 'lrc:releaseLut' |
| `electron/preload.ts` | 暴露 `window.lunaRenderCore.loadLut` |
| `src/workspace/lut/builtinLuts.ts` | 内置 LUT 生成器 (17级 .cube) |
| `src/workspace/lut/LutManager.ts` | 全局 LUT 生命周期管理 |
| `src/workspace/lut/FilterPanel.tsx` | 滤镜 UI 面板 |
| `src/components/PreviewStage.tsx` | LUT GPU ID 状态 + 注入渲染层 |
| `src/workspace/shared/editPipeline.ts` | `lutFilter.activeId` 管线字段 |

### Rust 端（之前已完成）

| 文件 | 角色 |
|------|------|
| `luna-render-core/src/compositor.rs` | `load_lut()` / `release_lut()` / `.cube` 解析 / 3D 纹理创建 |
| `luna-render-core/src/lib.rs` | `load_lut` / `release_lut` NAPI 导出 |
| `luna-render-core/src/shaders/params.wgsl` | `texture_3d<f32>` + `lut_size` |
| `luna-render-core/src/shaders/color.wgsl` | `apply_lut()` WGSL 函数 |

### 使用方式

用户点击滤镜侧边栏 → 选择内置滤镜 → 立即生效。可导入自定义 `.cube` 文件。
对比模式 (Space键) 会临时移除滤镜。
批量导出时自动加载 LUT。
