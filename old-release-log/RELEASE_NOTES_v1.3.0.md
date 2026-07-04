# v1.3.0 发布说明

## 新功能

- **FFmpeg 硬件加速**：视频导出自动启用 GPU 加速
  - macOS: VideoToolbox（Apple Silicon + Intel 均支持）
  - Windows: NVIDIA CUDA / Intel QSV / AMD AMF 自动探测
  - 兼容降级：硬件不可用时自动回退到软件编码
- **日志系统**：主进程 + 渲染进程统一日志，方便排查问题
- **国内资源部署脚本**：构建产物自动上传到 GitCode 国内镜像
- **CI 构建优化**：macOS x64 / ARM64 + Windows x64 自动打包

## Bug 修复

- **导出码率不准**：硬件编码器默认码率过低的问题已修复，原始画质导出匹配源文件码率
- **macOS x64 硬件加速**：修复 `-hwaccel_output_format` 参数不兼容 tessus/evermeet.cx ffmpeg 构建的问题
- **Windows CUDA 探测**：修复 ffmpeg 静态检出 CUDA 编码器但机器无 NVIDIA 显卡时的崩溃
- **音频重编码**：音频流改为 `-c:a copy` 直拷，避免不必要的重编码和质量损失

## UI 变化

- 导出进度弹窗优化：实际帧率显示
- 设置页日志级别控制

## 其他

- 升级 electron-builder 配置
- 完善开发文档和发版流程
