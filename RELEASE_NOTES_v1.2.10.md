# v1.2.10

### 重构

- 统一弹窗层架构，提取可复用组件：ModalLayer / DropdownPanel / Modal / MediaPreviewPanel
- BaseModal / DownloadProgressModal / ExportProgressModal 统一使用新的弹窗层
- ExportModal 使用 MediaPreviewPanel 替代内联预览

### Bug 修复

- 修复竖图在预览弹窗中显示不全的问题
- 修复未下载的文件显示水印覆盖层和水印设置的问题
- 修复设备媒体库预览弹窗底部缩略图条显示导出数据的问题
- 修复弹窗遮罩层只覆盖工具栏区域的反复回归问题

### UI 变化

- 水印默认大小改为「大」，默认样式改为「中文」
- 预览弹窗导出时显示「已加入导出队列」toast 提示
