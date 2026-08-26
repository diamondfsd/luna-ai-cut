# Windows GPU 预览与 WebGPU 调研结论

日期：2026-08-27

## 结论

当前项目不应把 Windows 预览直接切换到零拷贝 Media Foundation 解码，也不应把现有 Rust/wgpu 合成器直接改成 Electron WebGPU。

本次验证的结论是：

- WebGPU 在 Windows 上有机会让“浏览器视频元素 + 浏览器端合成”更快，但不能直接接管当前 Rust/wgpu 的 D3D12 纹理。
- 当前 Rust/wgpu 层的图层描述、排序、几何计算和 WGSL 算法可以复用；GPU 设备、纹理、管线、交换链和资源生命周期不能完整复用。
- 将预览解码切到 Media Foundation 的 D3D 表面零拷贝路径，在本机 Intel Iris Xe 上出现设备被移除，无法作为默认实现。
- 当前稳定路径虽然有 CPU 到 GPU 的拷贝，但能保持预览可用和资源生命周期可控。下一步应优先优化同步和预览分辨率，再考虑独立的 WebGPU 预览实验。

## 当前 Windows 路径

当前 native 预览链路为：

```text
Media Foundation 硬件解码
  -> 系统内存 NV12/P010 帧
  -> D3D11 上传
  -> D3D11 Video Processor 颜色转换/缩放
  -> D3D11On12 unwrap
  -> Rust/wgpu D3D12 合成
  -> native swap chain
```

开启 GPU 选项并不代表每一帧都零拷贝。当前路径仍会发生一次帧数据上传，并且颜色转换、D3D11/D3D12 资源交接和 wgpu 提交之间存在同步等待。因此在集成显卡、特别是高分辨率视频上，GPU 版本可能比 Chromium 普通视频预览更卡。

## 零拷贝实验

实验只把 `luna-render-core/src/windows/preview.rs` 中的解码器从 `VideoDecoder::open_system_memory` 切换到已有的 `VideoDecoder::open`，没有改变合成器、着色器或前端逻辑。

结果：

| 项目 | 结果 |
| --- | --- |
| Rust native 编译 | 通过，约 25.84 秒 |
| 工作台导航用例 | teardown 超过 120 秒 |
| 多素材/暂停/内存用例 | 切换素材后找不到 native canvas |
| 本机适配器 | Intel(R) Iris(R) Xe Graphics，D3D12 |
| native 日志 | `0x887A0005`，GPU 设备实例已暂停/被移除 |
| 后续错误 | wgpu `params` buffer 已失效并触发 validation panic |

失败日志中的关键顺序是：首帧渲染时颜色转换等待失败，随后 native preview 请求关闭，之后 wgpu 继续访问已失效设备上的资源。这说明解码器返回的 D3D11 表面与当前 D3D11On12/wgpu 资源生命周期组合，在本机驱动上不稳定。该实验没有形成可比较的持续帧率，因此不能声称零拷贝更快；它只能证明当前版本不适合默认启用。

实验完成后代码已恢复为系统内存路径，并保留工作台失活时暂停 native 预览的修复。

## WebGPU 是否可能更快

可以，但适用范围与当前 native 架构不同。

Electron 的 WebGPU 运行在 Chromium/Dawn 体系中。若预览改为浏览器端 `HTMLVideoElement`，可以尝试：

```text
HTMLVideoElement
  -> GPUDevice.importExternalTexture({ source: video })
  -> WebGPU shader 合成
  -> GPUCanvasContext
```

这条路径有机会绕过当前 `renderFrame -> RGBA buffer -> putImageData` 或 native surface 交接，适合实时预览。它不能直接提升当前 Rust 导出器的速度，因为导出仍需要逐帧渲染、编码、音视频封装和可复现的文件输出。

此外，`importExternalTexture` 的标准输入主要是 `HTMLVideoElement` 或 `VideoFrame`，不是任意 Media Foundation/DXGI handle。当前 native 产生的 D3D11/D3D12 纹理不能直接传给 Electron WebGPU；跨进程共享还需要浏览器支持外部纹理导入、资源状态转换、所有权和生命周期验证。

## 能否完全复用当前 wgpu 层

不能完全复用。可以按下面的边界拆分：

| 当前 Rust/wgpu 内容 | WebGPU 可复用性 | 说明 |
| --- | --- | --- |
| `CompositionInput` / layer 描述 | 高 | 可继续作为统一的渲染输入协议 |
| 图层排序、时间映射、几何规划 | 高 | 可抽到无平台依赖的共享模块 |
| WGSL 调色、遮罩、混合算法 | 中到高 | 需要核对 WebGPU/WGSL 绑定布局和精度差异 |
| wgpu `Device` / `Queue` / `Texture` | 无法直接复用 | Electron 使用 Dawn，通常是不同进程和设备对象 |
| D3D11On12 surface 与 lease | 无法直接复用 | 属于 native D3D 互操作生命周期 |
| wgpu render pipeline / bind group | 无法直接复用 | API 对象和资源归属不同，需要在 WebGPU 重建 |
| native swap chain | 无法直接复用 | WebGPU 应使用 `GPUCanvasContext` |
| 导出编码器与文件输出 | 不适合复用 | WebGPU 不替代 Windows 编码器和封装流程 |

因此可行的设计是“共享 layer 协议和算法，保留两套平台渲染后端”，不是把现有 wgpu 对象搬进 WebGPU。

## GitHub 资料

- wgpu `Implement support for importExternalTexture functionality`：<https://github.com/gfx-rs/wgpu/issues/8422>
  - 说明 wgpu 对视频外部纹理导入仍未完成，当前常见替代方案会产生 GPU 拷贝或 CPU 往返。
- GPUWeb `importExternalTexture: Support importing platform-shared GPU textures`：<https://github.com/gpuweb/gpuweb/issues/5167>
  - 说明 DXGI 等平台共享纹理导入需要额外标准和安全/生命周期设计；该议题已关闭，但并不等于 Electron/WebGPU 已提供通用 DXGI handle API。
- wgpu `Proposal for Underlying Api Interoperability`：<https://github.com/gfx-rs/wgpu/issues/4067>
  - 说明底层 API 互操作涉及资源所有权、状态转换和 drop guard，不能只靠取得一个原生指针完成。
- Electron `Enable WebGPU in Electron/Beta releases`：<https://github.com/electron/electron/issues/26944>
  - 说明 Electron WebGPU 能力取决于 Chromium/Dawn 构建和运行时开关，和本项目的 Rust/wgpu 设备不是同一套对象。

## 推荐路线

1. 继续使用 Rust/wgpu 作为导出唯一执行层，保证预览与导出共享 layer 输入和算法定义。
2. Windows native 预览暂时保留系统内存解码路径，并继续暂停不可见工作台的解码和合成。
3. 优先减少每帧同步等待、避免重复创建 GPU 设备、按预览清晰度限制解码尺寸，并记录解码、转换、unwrap、合成各阶段耗时。
4. 若要验证 WebGPU，单独增加 Electron 预览后端：使用 `HTMLVideoElement` + `GPUCanvasContext`，先实现基础变换/调色，再逐项补齐遮罩、LUT 和多图层效果。
5. 只有在同一批视频、同一输出尺寸和同一驱动上，WebGPU 预览稳定达到目标帧率后，才考虑作为预览默认后端；它仍不应替换当前导出后端。
