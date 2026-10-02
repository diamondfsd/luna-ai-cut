# 鸿蒙原生 USB 直播连接

当前随包工具：macOS ARM64 hdc 3.2.0f。Windows x64 已嵌入用户提供的 `hdc-windows-x64.zip`；版本尚待 Windows 上执行
`hdc.exe -v` 确认。Intel Mac 尚无内置工具，不使用 ARM64 二进制替代。

## 资源来源与打包

`darwin-arm64/` 来自用户提供的 `hdc-macos-arm64-3.2.0f.zip`，包含原始 SDK
`hdc`、同目录 `libusb_shared.dylib`、提取说明及带 SHA256 的 manifest。
macOS 版本、文件大小、SHA256、Mach-O ARM64 / Windows PE x64 架构在 staging 时校验。
Windows 包包含原始 SDK `NOTICE.txt`，所有 DLL 与 exe 保持同目录；USB 驱动安装器
不在提取包中，Windows 10/11 x64 系统运行库由系统提供。
许可沿用 SDK 条件，macOS 提取包未提供独立许可证文本；不将此工具声明为项目 MIT 许可。

`stage-package-resources.mjs` 按目标平台放入 `harmony-hdc/`；未提供工具的平台
生成空目录。正式签名把 ARM64 hdc 加入额外二进制清单，Ad Hoc 签名明确处理
hdc 和 dylib。签名会改变二进制哈希，因此 manifest 校验在签名前完成。
未在本次开发中生成、签名或验证安装包。

开发时可设置 `LUNA_HDC_BIN`；默认从应用 Resources 或项目内对应平台目录加载。
工具执行使用自身目录作为 cwd，保持动态库/后续 Windows DLL 同目录。

## 接收框架

- 直播输入启动时与现有 Android/iOS 接收器一起检测；没有工具时不启动 hdc 接收器。
- `hdc list targets -v` 仅选择 USB 目标；多台鸿蒙手机时要求只连接一台。
- 分配本地端口后执行 `hdc -t <key> fport tcp:<port> tcp:4184`，冲突时最多重试三次。
- TCP 接入后发送 `capabilities.get`；收到有效 UCD2 才确认连接，视频帧才标记推流。
- ADB/HDC 共用 `ForwardTcpReceiver`，复用 UCD2 拆帧、控制回传、超时与旧连接隔离。
- 停止时仅清理 connectKey、本地端口、目标端口、Forward 方向均匹配的转发。
  不执行 hdc kill、reconnect 或全局清理，避免影响其他工具。
- 手机端监听只绑定 loopback，已有 INTERNET 权限即可；开发者模式与 USB 调试授权
  由用户在手机上完成。电脑不连接相机 Wi-Fi。

鸿蒙手机端由 Luna咔 `HarmonyUsbVideoOutput` 提供 `127.0.0.1:4184`。
首阶段支持相机 HEVC 视频与相机控制，未实现手机麦克风音频。
连接页有独立“鸿蒙原生连接指引”，不复用 Android AOA 配件授权提示。

## 验证与待验收

```bash
node scripts/harmony-hdc-resources.mjs
pnpm test:harmony-hdc
pnpm exec tsc --noEmit
```

已验证本机工具版本、本地协议与模拟转发生命周期；尚未验证真实鸿蒙设备的
hdc verbose 列表/转发任务输出、USB 转发吞吐、拔插恢复、长时直播与安装包运行。
完整用户链路仍是 Luna咔 → LunaAiCut → 抖音直播伴侣屏幕采集。
