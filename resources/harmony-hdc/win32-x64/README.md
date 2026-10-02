# Windows x64 hdc 最小包

来源：本机解压的官方 command-line-tools/sdk/default/openharmony/toolchains。
仅提取 hdc.exe 和 libusb_shared.dll；原文件未修改，两者须保持同目录。

Windows 10 / 11 x64 标准安装环境中，剩余导入库为 Windows 系统组件与 Universal CRT。
不需要携带完整 SDK、Java、Node、DevEco Studio 或额外 VC++ DLL。
本次已检查两个 PE 文件的导入依赖，未在 Windows 上实际运行。

PowerShell 使用：

```powershell
.\hdc.exe -v
.\hdc.exe -h
.\hdc.exe list targets
```

连接真实设备需要设备开启、授权调试，并具备正确的 USB 驱动；本包不包含驱动安装器。
缺少系统 Universal CRT 的旧 Windows 环境不在这个最小包的范围内。
准确版本请在 Windows 上执行 -v 查看；Mac 无法直接执行 exe。
manifest.json 记录原文件大小、SHA-256 与依赖，便于验证完整性。
二进制遵循原 SDK 的许可条件，NOTICE.txt 保留来源 SDK 的声明。
