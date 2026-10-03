# Windows iPhone USB 直播验收

## 范围

当前链路传输手机视频和双向控制，不传输手机音频。声音在直播伴侣中单独选择。

手机端在 4184 端口提供 UCD2 视频和控制响应，桌面端启动内置 iproxy，将其转发至 127.0.0.1:4185。桌面端主动请求控制能力；只有收到有效视频帧或控制响应才确认连接。本地端口接受连接不代表手机已经就绪。10 秒没有有效响应时重新连接；转发进程退出或启动失败后每隔 1.5 秒重试。

## Windows 前置条件

- 使用当前源码重新构建的 Windows x64 安装包；不要继续使用缺少 `resources/ios-usb` 的旧产物。
- 电脑安装 Apple Mobile Device Support（可通过应用的“下载驱动”获取），或已有 Apple Devices 提供设备支持，并确保苹果设备服务正常运行。应用按需下载独立驱动包并打开安装向导，由用户确认安装，不静默安装。详见 `docs/windows-apple-device-support.md`。
- 使用支持数据传输的 USB 线，解锁 iPhone 并允许信任此电脑。
- 手机端打开 Luna 咔并启动 USB 画面。

## 连接自检

安装后，PowerShell 中执行以下命令，替换安装目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\安装目录\resources\native\ios-usb-check.ps1"
```

开发者也可以将脚本指向暂存或安装后的资源目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File electron/platform/windows/ios-usb-check.ps1 -ResourcesDir .package-resources/win32-x64
```

脚本只读检查转发工具能否运行、苹果设备服务端口以及 USB 手机数量，不安装驱动、不修改服务、不打印手机标识。该检查通过不等于手机端协议、视频解码或直播伴侣已经通过验收。

## 非界面回归与打包校验

```sh
pnpm test:ios-tcp-receiver
pnpm test:ios-usb-resources
pnpm test:live-stream-capture
pnpm test:camera-video-stream
pnpm build:app
pnpm pack:win:x64
```

暂存资源和安装包完成后都会校验两个 EXE、四个 DLL、Windows x64 架构、固定 SHA256 和必要许可证；缺失、损坏或混入未登记的二进制会阻止打包。

检查已有解包目录：

```sh
node scripts/ios-usb-resources.mjs "release/1.8.8/win-unpacked/resources/ios-usb"
```

仅刷新 USB 暂存资源（不生成安装包，也不校验其他平台组件）：

```sh
node scripts/ios-usb-resources.mjs --stage .package-resources/win32-x64/ios-usb
```

不要通过手动给旧安装目录补 DLL 代替重建，旧应用仍包含旧连接逻辑。不要在 Mac 构建或资源校验通过后宣称 Windows 真机已通过。

## 真机最小验收

1. 初次连接：工具自检通过，手机启动 USB 画面后显示视频；控制能力响应本身不应显示为正在直播。
2. 双向控制：确认手机实际响应变焦、云台回中等操作，不仅检查桌面按钮状态。
3. 持续播放：检查 Windows 视频解码、画面连续性与独立预览。当前使用系统视频解码能力，不能由 Mac 的测试结果推断 Windows 兼容性。
4. 故障恢复：拔插 USB、关闭重开手机推流、结束 iproxy 进程后恢复画面，不重启桌面应用。
5. 停止与重启：停止接收后不再收帧；重新连接可恢复；退出应用后没有遗留 iproxy。
6. 输出：直播伴侣采集独立预览窗口，确认调色、水印和画面比例；声音单独验收。
