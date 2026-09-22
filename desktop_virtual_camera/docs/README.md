# Desktop Virtual Camera Docs

本目录文档按接手开发的阅读顺序组织。

## 先读

1. [`../AGENTS.md`](../AGENTS.md)
   - 目录边界、稳定接口、当前状态和 Windows 下一步。
2. [`app-stream-bridge.md`](app-stream-bridge.md)
   - Luna 咔手机 App 如何通过 USB AOA 发送帧，Luna AI Cut 如何接收并转发给 Host。
3. [`protocol.md`](protocol.md)
   - UCD2 帧的字节级定义和接收要求。
4. [`usb-output-protocol.md`](usb-output-protocol.md)
   - 给桌面端 AI 的完整 USB 输出协议、AOA 握手、音视频流和验收清单。
5. [`audio-pipeline.md`](audio-pipeline.md)
   - 麦克风采集、USB 音频包、蓝牙限制和未来混音方案。
6. [`luna-ai-cut-integration.md`](luna-ai-cut-integration.md)
   - Electron 服务、IPC、直播控制台、构建、签名、授权和验收。

## 平台实现

- [`../macos/README.md`](../macos/README.md)
  - 已工作的 macOS 参考实现。
- [`../windows/README.md`](../windows/README.md)
  - Windows 11 Media Foundation 实施方案和待办边界。

## 快速验证 App 通路

```bash
node desktop_virtual_camera/tools/receive-luna-stream.mjs --self-test
node desktop_virtual_camera/tools/receive-luna-stream.mjs --port 4184
```

接收器解析手机端发送的 UCD2 格式。平台 Host 开发前可以先用它替代 Host 监听 4184，
确认 USB AOA 已把 HEVC access unit 送到电脑。
