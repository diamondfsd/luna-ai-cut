# Windows GPU 预览与 WebGPU 调研结论

日期：2026-08-27

## 结论

Electron 44 的 WebGPU 在当前 Windows 环境可用，适合做工作台实时预览后端，但不能替代 `luna-render-core` 的 Rust/wgpu 导出后端，也不能把 Rust 的 `wgpu::Texture`、`Device` 或 `BindGroup` 直接搬到 Electron 的 Dawn/WebGPU 中。

本次已落地一个独立实验后端：

```text
HTMLVideoElement
  -> GPUDevice.importExternalTexture()
  -> WebGPU WGSL 合成
  -> GPUCanvasContext
```

它通过设置页的“系统视频预览（实验）”开关启用，默认关闭，不改变已有 native/wgpu 路径。当前只接管单个基础视频图层；蒙版、LUT、调色、变换、裁剪时间轴、多个视频层和创意效果会继续使用 Rust compositor。WebGPU 初始化失败或设备丢失时会自动回到普通预览。

## 为什么当前 wgpu 路径会慢

Windows native 预览目前需要在多个图形资源体系之间交接：

```text
Media Foundation
  -> 系统内存 NV12/P010
  -> D3D11 上传与颜色转换
  -> D3D11On12 unwrap
  -> Rust/wgpu D3D12 合成
  -> native child window present
```

因此“开启 GPU”不等于零拷贝。高分辨率视频上，上传、YUV 转换、D3D11/D3D12 资源交接、wgpu 提交等待和原生子窗口呈现可能超过 Chromium 自己的视频管线。原生子窗口还会绕过 DOM 层级，导致工作台切换菜单时出现遮挡风险。

## Native 零拷贝实验

曾在 Windows native 预览中将解码器从系统内存输出切换到 D3D 表面输出，只改解码路径，没有改变合成器、着色器和前端逻辑。当前 Intel Iris Xe / D3D12 环境出现 `0x887A0005` 设备被移除，随后 wgpu 继续访问失效资源并触发 buffer validation 错误。该实验没有形成可比较的持续帧率，代码已经恢复到系统内存路径，因此不能把“零拷贝”直接当成更快或更稳定。

这个结果支持当前的后端拆分：先让 Chromium 管理视频解码和 WebGPU 预览，Rust/wgpu 继续承担导出和复杂效果；不要优先做 D3D11/D3D12/wgpu/Electron 的跨 API 纹理转换。

## 复用边界

可以复用：

- `PreviewLayer` 和 `CompositionInput` 数据结构
- 图层排序、时间轴和视频时间映射
- `dst/src` 几何、透明度和混合模式定义
- WGSL 中与平台无关的调色、蒙版和效果算法

必须在 WebGPU 端重建：

- adapter、device、queue 和 canvas context
- 视频 `texture_external` 与静态资源 `texture_2d`
- bind group、pipeline、uniform buffer 和资源生命周期
- native swap chain、D3D 资源句柄以及跨 API fence

最佳结构是共享“图层协议和算法”，维护 Rust/wgpu 与 Electron WebGPU 两个后端，而不是做 wgpu 对象转换层。WebGPU 使用 Chromium 的 `HTMLVideoElement`，可以避开当前 native 子窗口和 D3D11On12 到 wgpu 的交接；只有在确实需要把 native 解码纹理交给 Chromium 时，才考虑 Electron `sharedTexture`。

## GitHub 调研

- Electron shared texture：<https://github.com/electron/electron/pull/47317>
  - Electron 40 及以上支持将平台共享纹理导入为 `VideoFrame`。
  - 适合 Rust/D3D 解码结果交给 Chromium 的场景，但仍要处理句柄、同步和生命周期。
- Electron + libmpv 实例：<https://github.com/yscoder/electron-mpv-video>
  - Windows 使用 D3D11 纹理、共享纹理、`VideoFrame` 和 WebGPU `importExternalTexture`。
  - 是可参考的实际案例，但仍有一次 GPU 内拷贝，并没有复用 wgpu 纹理对象。
- wgpu 外部视频纹理：<https://github.com/gfx-rs/wgpu/issues/8422>
  - `importExternalTexture` 仍未完成，替代方式通常要付出 GPU 拷贝或 CPU 往返。
- wgpu 外部纹理 RFC：<https://github.com/gfx-rs/wgpu/issues/3145>
  - 多平面视频格式、底层 API 互操作和外部纹理生命周期不是普通 `Texture` 能覆盖的。

## 本次验证

- `pnpm run build:app`：通过。
- `pnpm test:workspace`：通过。
- `pnpm test:settings-storage`：通过。
- `pnpm exec playwright test e2e/webgpu-preview.e2e.spec.ts`：通过。
  - 真实启动 Electron。
  - 申请 WebGPU adapter。
  - 验证 WebGPU canvas 尺寸和画面输出。
  - 验证播放、暂停、切换设置页并返回工作台。
- 默认路径回归：`workspace-video-playback.e2e.spec.ts` 和 `workspace-preview-switch.e2e.spec.ts` 均通过。
- `pnpm lint` 仍受仓库已有的 `no-explicit-any` 错误和 hook 警告阻断；本次新增 WebGPU 文件和用例单独 lint 通过。

这些结果证明 WebGPU 后端在当前环境“能工作”，还没有证明它比当前 wgpu 快。性能结论必须使用同一批视频、同一预览尺寸、同一驱动，分别记录解码、渲染、提交和丢帧；至少连续运行 30 秒后比较有效帧率、帧间抖动、CPU/GPU 占用和设备丢失次数。

## 推荐路线

1. 先用当前实验后端采集 Windows 设备矩阵的真实帧率和功耗数据，不立即把它设为默认。
2. 将共享 WGSL 拆成平台无关算法层，分别生成 `texture_external` 视频版本和 `texture_2d` 静态纹理版本。
3. 逐项迁移基础变换、调色、LUT、蒙版和水印，每项都保留能力检查和 LRC 回退。
4. WebGPU 只负责实时预览；Rust/wgpu 继续负责可复现的图片和视频导出。
5. 只有 WebGPU 在目标 Windows 设备上稳定达到目标帧率，并且低于当前 native/wgpu 的卡顿率后，才考虑把实验开关改成自动选择。
