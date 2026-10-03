# iPhone USB runtime

macOS ARM64 / Intel 资源分别位于 `darwin-arm64` / `darwin-x64`。每套包含
`iproxy`、`idevice_id`、`idevicepair` 及实际依赖的六个动态库。最低系统版本为
macOS 12.0，使用系统 usbmuxd 和系统 curl，不安装或替换苹果设备服务。

应用只使用自身资源：安装版读取 `Contents/Resources/ios-usb`，开发模式读取
本仓库对应架构的目录。不会读取 Homebrew、PATH 或 `USB_VIDEO_*_BIN`。
安装版资源缺失时不会回退到当前目录中的开发资源。

每个架构的 `manifest.json` 记录官方源码地址、版本、固定提交、二进制和
许可证/源码包的 SHA256。`licenses` 随工具一起打包，包含许可证和 LGPL/GPL
组件的对应未修改源码；OpenSSL 使用 Apache-2.0，保留 LICENSE 和 NOTICE。
`iproxy` 为单独启动的 GPL 工具，不链接进应用。

## 重建工具（不构建应用）

构建机需要 Xcode Command Line Tools、Git、Perl、autoconf、automake、libtool
和 pkg-config。Homebrew 仅可作为构建机的开发工具来源，不是用户运行依赖。

```sh
pnpm build:macos-ios-usb                 # 两个架构
node scripts/build-macos-ios-usb.mjs --arch x64
pnpm check:macos-ios-usb-resources
pnpm test:macos-ios-usb-resources
pnpm test:ios-usb-resources
pnpm test:ios-tcp-receiver
```

源码和中间产物位于被忽略的 `.cache/ios-usb-sources`，不要提交缓存目录。
打包暂存和 afterPack 会验证资源完整性、架构、独立动态库路径和最低系统版本；
签名流程包含工具及动态库。修改二进制后必须重新生成清单。

## 配对排查

本次补齐连接工具，不自动执行配对或重置已有信任。`idevicepair` 可用于
真机排查：解锁手机后执行内置 `idevicepair validate`，需要配对时执行
`idevicepair pair` 并在手机确认信任。不要调用系统中同名工具代替内置工具。

```sh
"/Applications/Luna AI Cut.app/Contents/Resources/ios-usb/idevice_id" -l
"/Applications/Luna AI Cut.app/Contents/Resources/ios-usb/idevicepair" validate
"/Applications/Luna AI Cut.app/Contents/Resources/ios-usb/idevicepair" pair
```

移位目录执行测试会清除 Homebrew PATH 和动态库环境变量；Apple Silicon 主机
只验证 ARM64 执行，Intel 资源验证架构、依赖和校验值。真实信任提示、视频和
双向控制仍需 iPhone 真机验收。

Windows 继续使用原有 `win-x64` 和 `SHA256SUMS.txt`；该资源集不含 idevicepair。
