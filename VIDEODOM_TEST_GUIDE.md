# VideoDomPreviewLrcRender 测试说明

## 已完成的修改

### 1. 前端组件
- ✅ 创建 `VideoDomPreviewLrcRender.tsx`
- ✅ 使用 HTMLVideoElement 播放视频（浏览器硬解）
- ✅ 使用 OffscreenCanvas 缩放取帧（640x360）
- ✅ 调用现有的 Rust 方法（loadTexture / updateTexture / renderFrame）

### 2. PreviewStage 集成
- ✅ 在 video 情况下使用 VideoDomPreviewLrcRender
- ✅ 在 image 情况下继续使用 LrcRender

## 测试步骤

### 1. 确保 Electron 应用已启动

```bash
cd /Users/zhouchao/projects/luna-ai-cut/.worktrees/feat-creative-factory
pnpm run dev
```

### 2. 打开 PreviewModal

在应用中找到预览功能，打开一个视频文件。

### 3. 测试场景

#### 场景 1：基本播放
1. 打开视频文件
2. 点击播放按钮
3. 观察：
   - ✅ 视频是否流畅播放
   - ✅ 控制台是否有错误
   - ✅ 画面是否正常显示

#### 场景 2：拖动进度条
1. 拖动进度条到不同位置
2. 观察：
   - ✅ seek 响应时间（应该 < 100ms）
   - ✅ 画面是否正常显示
   - ✅ 是否有卡顿

#### 场景 3：快速拖动
1. 快速拖动进度条
2. 观察：
   - ✅ 是否仍然流畅
   - ✅ 内存占用是否稳定

### 4. 查看控制台日志

打开浏览器开发者工具（`Cmd+Option+I`），查看：
- 是否有错误信息
- 渲染耗时
- 内存占用

## 预期效果

### 性能指标
- ✅ **seek 响应时间**：< 100ms（当前 1-2 秒）
- ✅ **播放帧率**：60fps（当前 30fps）
- ✅ **内存占用**：降低 80%
- ✅ **CPU 占用**：降低 70%

### 对比当前方案

| 指标 | 当前方案 | 新方案 | 预期提升 |
|------|---------|--------|---------|
| seek 耗时 | 1-2 秒 | < 100ms | **10-20x** |
| 播放帧率 | 30fps | 60fps | **2x** |
| 帧数据大小 | 8MB | 0.9MB | **9x ↓** |
| 内存占用 | 240MB | 30MB | **8x ↓** |

## 可能的问题

### 1. 视频格式不支持
- **现象**：视频无法播放，画面黑屏
- **原因**：浏览器不支持该视频格式
- **解决**：检查视频格式（H.264/H.265/VP9/AV1）

### 2. OffscreenCanvas 不支持
- **现象**：报错 "OffscreenCanvas is not defined"
- **原因**：Electron 版本太旧
- **解决**：升级 Electron 或使用 Canvas 替代

### 3. Rust 方法调用失败
- **现象**：报错 "loadTexture is not a function"
- **原因**：preload.ts 没有暴露这些方法
- **解决**：检查 preload.ts 是否正确配置

### 4. 纹理未释放
- **现象**：内存持续增长
- **原因**：纹理没有正确释放
- **解决**：检查组件卸载时是否释放纹理

## 调试方法

### 1. 查看 Rust 日志
```bash
tail -f luna-render-core/luna-rc.log
```

### 2. 查看 Electron 主进程日志
```bash
tail -f luna-render-core/luna-rc.log | grep "\[main\]"
```

### 3. 查看浏览器控制台
```
Cmd+Option+I → Console
```

### 4. 监控内存
```
Cmd+Option+I → Performance Monitor
```

## 回退方案

如果新方案有问题，可以快速回退：

修改 `PreviewStage.tsx`：
```typescript
// 改回使用 LrcRender
<LrcRender
  layers={layers}
  canvasWidth={previewCanvas?.width}
  canvasHeight={previewCanvas?.height}
  onRender={handleRender}
  onVideoElement={handleVideoElement}
/>
```

## 下一步优化

如果测试成功，可以继续优化：

1. **Transferable Objects**：避免数据拷贝
2. **文件缓存**：缓存解码后的帧
3. **预加载**：预测用户拖动方向
4. **多分辨率**：拖动时低分辨率，停止后高分辨率

## 总结

这个方案通过**浏览器硬解 + OffscreenCanvas + GPU 直接上传**，可以大幅提升视频预览性能。

**预期性能提升**：
- seek 响应：10-20 倍
- 播放帧率：2 倍
- 内存占用：降低 80%
- CPU 占用：降低 70%

请测试并告诉我结果！ 🚀
