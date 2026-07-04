# v1.4.0-hot.5 — 热更新发布说明

## Bug 修复

- **Windows 工作台导出 LUT 路径错误**：ffmpeg filter_complex 中传入的 Windows 路径反斜杠 `\` 被 ffmpeg 解析器当作转义字符处理，导致 `C:\Users\...\.cube` 路径中的反斜杠和盘符全部丢失，导出失败。现修复为将 Windows 路径中的反斜杠替换为前斜杠传参（ffmpeg on Windows 支持前斜杠路径）

## 改进

- **ffmpeg filter_complex 路径兼容性**：在 `pipelineCompiler.ts` 中构造 `lut3d=file=...` 参数时，对 Windows 平台路径做反斜杠 → 前斜杠转换，避免再次出现类似转义问题
