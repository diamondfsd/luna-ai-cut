# v1.4.0-hot.3 — 热更新发布说明

## Bug 修复

- **导出记录预览弹窗识别 Live Photo**：从导出记录打开预览时，Motion Photo 图片现在正确显示 Live Photo 播放按钮
- **预览弹窗文件夹按钮无效**：修复从导出记录预览时右上角「在文件夹中显示」按钮点击无反应的问题
- **Mac 安装逻辑修复**：修复部分场景下 Mac 安装包处理逻辑

## 改进

- **Swift 脚本统一热更新**：livetool.swift、bluetoothCoreScanner.swift、wifiCoreWlan.swift 三个原生脚本纳入热更新机制，后续更新无需重新下载完整安装包，通过热更新即可推送新版 Swift 脚本
- **Live Photo 完整支持**：工作台 Live Photo 图标、徽章、渲染播放全链路
- **构建脚本更新**：热更新打包脚本自动包含 Swift 文件
