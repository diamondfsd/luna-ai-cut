---
name: lut-filter-feature
description: 滤镜/LUT功能 — WebGPU 3D LUT 渲染管线 + 工作台滤镜面板
metadata:
  type: project
---

Luna AI Cut 的滤镜/LUT 功能，完整链路从 WebGPU 渲染到 UI 交互。

链路: FilterPanel → EditPipeline.lutFilter.activeId → LutManager.discoverLuts() → window.lunaRenderCore.readLutFile (IPC) → WebGpuCompositionRenderer 解析 .cube 并创建 3D texture → Composition → WebGPU shader 采样 LUT

内置6种滤镜: 日系清新、胶片复古、黑白经典、高饱和运动、冷调电影、奶油人像。
所有 .cube 数据由程序化生成器产生，无需捆绑文件。
导入: 用户可通过 FilePicker 导入自定义 .cube 文件，通过 LutManager 管理 GPU 生命周期。

**Key files:** electron/ipcLunaRenderCore.ts (文件读取和 LUT 管理 IPC), electron/preload.ts (preload API), src/workspace/lut/builtinLuts.ts | LutManager.ts | FilterPanel.tsx, src/components/PreviewStage.tsx (layer 注入), src/lib/webgpu/composition.ts, src/workspace/shared/editPipeline.ts (lutFilter.activeId field)

**Native side:** 不参与 LUT 解析或画面渲染；`luna-render-core` 仅保留 AI/语音 worker。
