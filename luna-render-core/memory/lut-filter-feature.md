---
name: lut-filter-feature
description: 滤镜/LUT功能 — wgpu 3D LUT 渲染管线 + 工作台滤镜面板
metadata:
  type: project
---

Luna AI Cut 的滤镜/LUT 功能，完整链路从 GPU 渲染到 UI 交互。

链路: FilterPanel → EditPipeline.lutFilter.activeId → LutManager.ensureLoaded() → builtinLuts.ts 生成.cube → window.lunaRenderCore.loadLut (IPC) → Rust parse_cube_lut + create_lut_3d_texture → GPU ID → PreviewStage.buildAdjustedLayers 注入 layer.lutId → Composition → Rust render() → apply_lut() in WGSL

内置6种滤镜: 日系清新、胶片复古、黑白经典、高饱和运动、冷调电影、奶油人像。
所有 .cube 数据由程序化生成器产生，无需捆绑文件。
导入: 用户可通过 FilePicker 导入自定义 .cube 文件，通过 LutManager 管理 GPU 生命周期。

**Key files:** electron/platform/render/lunaRenderCore.ts (loadLut/releaseLut), electron/ipc/ipcLunaRenderCore.ts (IPC handlers), electron/preload.ts (preload API), src/workspace/lut/builtinLuts.ts | LutManager.ts | FilterPanel.tsx, src/components/PreviewStage.tsx (gpuLutId state + layer injection), src/workspace/shared/editPipeline.ts (lutFilter.activeId field)

**Rust side (previously completed):** luna-render-core/src/compositor.rs | lib.rs, params.wgsl, color.wgsl
