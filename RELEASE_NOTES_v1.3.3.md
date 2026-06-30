# v1.3.3 — Live Photo 导出支持

## 新功能

- **Apple Live Photo 导出**：macOS 导出 Live Photo 时通过 `livetool.swift` 注入标准 Apple 配对元数据（Content Identifier UUID），文件可被 iPhone / iPad / Mac 照片 App 直接识别
- **Google Motion Photo 格式升级**：从旧版 `MicroVideo` 升级为标准 `Container:Directory` 格式，兼容小米、华为/鸿蒙、三星、OPPO 等 Android 设备

## Bug 修复

- **修正 Google XMP 命名空间**：改用属性语法 `Container:Item Item:Mime="..."`，`Item:Length` 纯数字无前导零，确保各 Android 厂商正确识别
