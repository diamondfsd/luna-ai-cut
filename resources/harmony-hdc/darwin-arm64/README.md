# hdc 最小运行包（macOS ARM64）

版本：3.2.0f。保留原始 SDK 二进制，不 strip、不重新签名。

最小运行依赖只有 `hdc` 和 `libusb_shared.dylib`，两者必须保持同目录。
其他依赖由 macOS 提供；不需要安装 DevEco Studio、Java、Node 或完整鸿蒙 SDK。
这是本机提取的 Apple Silicon 版本，不适用于 Windows、Linux 或 Intel Mac。

解压后使用：

```bash
chmod +x ./hdc
./hdc -v
./hdc -h
```

需要操作设备时可执行 `./hdc list targets`，设备需开启并授权调试。
本次提取仅验证版本和帮助命令，没有连接设备或启动调试会话。
最低 macOS 版本以 manifest.json 中 Mach-O 的 LC_BUILD_VERSION 为准，
未在其他 macOS 版本上验证。二进制遵循原 SDK 的许可条件。
