# Windows iOS USB / iproxy 构建交接

## 目标

验证仓库根目录现有的 `limd-build-msys2.sh`，用 GitHub Actions 实验构建 `iproxy.exe`，收集运行时 DLL 和许可证，并接入 Luna AI Cut Windows 安装包。当前产物和接线仍需 Windows 真机验收，不能视为正式发布依赖。

不把整套 libimobiledevice 工具或 MSYS2 安装目录塞进应用安装包，只随包提供 `iproxy.exe`、递归运行时 DLL 和许可证。

## 当前应用约定

- `electron/media/live-stream/iosTcpReceiver.ts` 会启动 `iproxy <local-port>:<device-port>`。
- 默认端口映射为本机 `127.0.0.1:4185` 到 iPhone 设备端口 `4184`。
- Electron 通过本机 TCP 连接读取 Luna 咔发送的 UCD2 帧；`iproxy` 只负责 USB 端口转发，不负责生成或解码 Luna 视频流。
- iPhone 上的 Luna 咔必须实现并启动设备端 `4184` 服务，才能建立此数据通路。
- 查找顺序优先使用 `USB_VIDEO_IPROXY_BIN` 覆盖值，然后在 Windows 安装包中查找 `process.resourcesPath/ios-usb/iproxy.exe`，最后回退到 PATH。
- `resources/ios-usb/win-x64/` 中保存 Windows x64 程序、DLL 和许可证；`scripts/stage-package-resources.mjs` 会校验并复制到打包暂存目录，`electron-builder.json5` 将其放入 Windows 安装包的 `resources/ios-usb/`。

## 对现有脚本的评估

仓库根目录的 `limd-build-msys2.sh` 标注 revision `1.0.4`，面向 MSYS2 MinGW64、MinGW32、UCRT64。它从 `github.com/libimobiledevice` 拉取多个组件，并包含 `libusbmuxd`，因此适合作为 Windows 构建验证的起点；它不是只构建 `iproxy` 的最小脚本。

首次运行前必须处理这些风险：

- 脚本按当前工作目录创建组件目录和日志。部分分支会对已有组件目录执行 `rm -rf`，并对组件 Git 仓库执行 `git reset --hard`。禁止在 Luna AI Cut 项目根目录或任何含用户数据的目录运行。
- 组件使用 `master` 分支，构建不可复现。记录每个仓库实际 checkout 的 commit SHA；正式构建应固定 commit/tag。
- `PREFIX`、`SDKDIR` 在脚本中被使用但未赋值。先从该脚本的官方来源或对应构建说明确认预期值，不要猜测后继续。
- libzip/libcurl 归档来自 Gist，脚本没有校验 SHA256。下载后记录来源、文件名和哈希；不要把这两个归档未经审计地作为正式依赖。
- 脚本构建 libimobiledevice、libirecovery、idevicerestore、ideviceinstaller 等多个组件。Luna 当前只需要 `iproxy`；完成全量验证后，再判断是否需要为正式流程裁剪最小组件集合。
- 用户提供的 DLL 清单只是初步估计。以本次产出的 `iproxy.exe` 的完整递归 DLL 依赖和干净环境运行结果为准。

脚本内容看起来来自 libimobiledevice 相关维护者的 MSYS2 构建流程，但正式使用前仍应在 Windows 主机上记录并核对它的上游 URL、版本/commit 和许可证。不要仅根据文件头认定来源。

## Windows 主机验证步骤

1. 使用 Windows x64 主机，安装 MSYS2。优先从 MSYS2 UCRT64 shell 开始；确保 `MSYSTEM`、`MSYSTEM_CARCH`、`MINGW_PREFIX` 与 shell 匹配。不要混用 UCRT64 和 MinGW64 的头文件、静态库或 DLL。
2. 在全新的临时目录运行仓库里的脚本副本，例如 `C:/temp/luna-iproxy-build/`。运行前确认目录为空，并记录完整命令、MSYS2 环境、依赖版本及日志。
3. 先解决 `PREFIX`、`SDKDIR` 的预期值，再运行脚本。若需要修改脚本才能运行，保留原始文件，另存为临时副本并记录差异；不要直接覆盖用户提供的 `limd-build-msys2.sh`。
4. 构建结束后，在 `$PREFIX/bin` 和相关输出目录定位 `iproxy.exe`。记录它的版本、架构、SHA256，以及所有被构建组件的 commit SHA。
5. 检查 `iproxy.exe` 的完整递归 DLL 闭包。优先使用 `ntldd -R` 或 Windows PE 依赖检查工具；若工具不能解析递归依赖，则逐个继续检查非系统 DLL。至少区分 Windows 系统 DLL 与需要随应用分发的第三方 DLL。
6. 把 `iproxy.exe` 和所需第三方 DLL 复制到独立的临时目录，脱离 MSYS2 的 `bin` 搜索路径启动。确认没有依赖开发机上恰好安装的 DLL。
7. 连接 iPhone，安装/启动 Luna 咔并开启对应 USB 直播服务。单独启动 `iproxy.exe 4185:4184`，检查转发日志和本机 4185 端口；再停止手工启动的进程，由 Luna AI Cut 通过 `USB_VIDEO_IPROXY_BIN` 启动同一个二进制，验证控制台收到视频帧。不要同时手动和由应用启动两个监听 4185 的进程。
8. 至少验证：未连接手机时可等待；连接 iPhone 后 USB 转发建立；画面帧计数增长；停止获取后 `iproxy.exe` 退出；拔掉设备后状态能恢复等待。

若 `idevice_id -l` 等辅助工具也由脚本构建，可用于诊断设备可见性，但它们不是最终安装包必须包含的程序。

## 打包接入状态

- Electron 打包接线已完成，但资源来自实验构建，且没有完成真机验收，暂不代表正式发布通过。
- 可分发文件位于 `resources/ios-usb/win-x64/`；构建信息、源码 revision、递归依赖和 SHA256 清单位于 `resources/ios-usb/`。
- Windows 打包时，staging 会把可执行文件、3 个 DLL 和许可证复制到 `.package-resources/win32-x64/ios-usb/`；electron-builder 再将其放入安装包的 `resources/ios-usb/`。
- 运行时优先使用安装包内的 `iproxy.exe`，保留 `USB_VIDEO_IPROXY_BIN` 覆盖和 PATH 回退。

- 当前 Action 使用未固定的上游 `master` 和未经预先 SHA256 校验的 Gist 归档；正式发布前必须固定源码 revision 和依赖来源，并重新生成资源及哈希清单。
- 仍需在干净 Windows 10/11 x64 环境验证脱离 MSYS2 PATH 的启动，并用真实 iPhone/Luna 咔确认端口转发、视频帧接收和停止时进程清理。
- DLL 与 `iproxy.exe` 放在同一目录，以便 Windows loader 解析。不要把整个 MSYS2 `bin` 目录复制进安装包。
- `libimobiledevice`、`libusbmuxd` 和依赖库是用户态软件，不应直接称为 Windows 内核驱动。确认实际 USBMux 后端是否依赖 Apple Mobile Device Support、特定 USB 驱动或额外服务，并在干净 Windows 10/11 x64 机器上记录需要用户预装的条件。未经许可审查，不要分发 Apple 专有驱动或 DLL。

## 验收标准

- 从干净 Windows x64 环境构建成功；构建输出中的 `iproxy.exe` 是 x64 PE 文件。
- 记录上游来源、组件版本/commit、每个随包二进制的 SHA256 和许可证。
- 递归依赖清单完整；临时运行目录不依赖 MSYS2 PATH 中的 DLL。
- Luna AI Cut 安装包内能找到并启动打包的 `iproxy.exe`，不需要用户单独安装 MSYS2。
- 在目标 Windows 主机连接真实 iPhone 和 Luna 咔，验证端口转发、视频帧接收和进程清理。
- 单独记录仍需的 Apple USB 支持/驱动前置条件；不要在未测试时宣称零前置依赖。

## 给 Windows AI 的任务说明

请先阅读项目 `AGENTS.md` 和本文档。仅在 Windows x64/MSYS2 环境处理这项工作。

先在全新临时目录审计并运行 `limd-build-msys2.sh`，确认所需环境变量、实际输出位置、`iproxy.exe` 的递归 DLL 闭包和许可证；不得从项目根目录运行，不得覆盖用户提供的脚本，不得执行会删除或重置项目现有数据的命令。然后在 Windows x64 环境验证当前 Electron 安装包内的程序，并连接真实 iPhone/Luna 咔验收转发。

正式发布前还需新增独立、可复现的 Windows 准备流程，固定源码 revision、依赖来源并校验 SHA256。保留用户已有改动，不做无关整理。最终报告构建命令、版本/commit、DLL 清单、哈希、许可证、真机测试结果和仍需用户预装的驱动/服务。
