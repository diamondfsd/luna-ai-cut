# FreeCut Remotion 集成

## 当前状态

这套集成已经收进 FreeCut 仓库，发布后的应用不依赖 `~/projects/remotion`、
`~/projects/video-shotcraft` 或用户机器上的其它源码目录：

- `vendor/video-shotcraft/` 是固定版本的本地 skill 组件，DeepSeek Harness 构建时复制到应用资源。
- `integrations/remotion/`、渲染 worker 和 Scene Spec 随应用代码发布。
- Remotion 的 compositor、FFmpeg 和 Headless Chrome 在打包时复制到应用的 `resources/` 目录。
- 渲染输入只接受当前 FreeCut 项目中的 `mediaIds`，模型不能传任意文件路径。
- 生成结果当前是项目工作区中的 MP4 artifact；还没有自动注册成时间线媒体，后续可通过现有 `timeline.addMedia` 完成。

开发机上的 `~/projects/remotion` 只用于参考上游实现，不参与运行时。

## 结论

`video-shotcraft` 负责镜头语言、Remotion 示例、模板和声音素材；Remotion
负责把 React composition 渲染成视频。两者都不能直接替代 FreeCut 的原生时间线。

FreeCut 应采用混合模式：Remotion 负责生成宣传片、产品演示和动效镜头，生成的
MP4 再作为一个普通媒体导入 FreeCut，继续做裁切、分割、排序、配音和字幕。这样
第一阶段能复用 Shotcraft 的质量积累，同时不破坏现有时间线和导出链路。

```text
Harness / 用户请求
        |
        v
  video-shotcraft skill
        |
        v
  FreeCut Scene Spec (JSON)
        |
        v
  Remotion render worker
        |
        v
  MP4 + render manifest
        |
        v
  FreeCut media library -> timeline.addMedia()
```

## 本地目录职责

- `vendor/video-shotcraft/`：固定版本的 Apache-2.0 skill 和镜头/模板/音频资源，随
  FreeCut 仓库一起发布。
- `~/projects/remotion/`：Remotion 上游开发 monorepo，只作为源码和版本参考，不作为
  FreeCut 的运行时目录，也不应复制进应用。
- `~/projects/my-remotion-studio/`：现有的 Remotion 生产工作区，适合先做样片和
  验证 composition；它的 `node_modules` 和 episode 代码不应成为 FreeCut 的运行时
  隐式依赖。
- `integrations/remotion/`：FreeCut 对 Remotion 的桥接契约、渲染 worker 和共享
  composition 的归属位置。

## 第一阶段：可交付的混合渲染

### 1. 定义 Scene Spec

不要让模型直接拼接 Remotion CLI 参数，也不要让宿主从自然语言猜模板。模型通过
结构化能力提交经过 schema 校验的场景描述，例如：

```ts
type RemotionSceneSpec = {
  version: 1
  composition: 'shotcraft-promo' | 'shotcraft-shot'
  width: number
  height: number
  fps: number
  durationInFrames: number
  shots: Array<{
    id: string
    recipe: string
    from: number
    durationInFrames: number
    mediaIds: string[]
    text?: Record<string, string>
  }>
  audio?: Array<{
    mediaId: string
    from: number
    volume?: number
  }>
}
```

`recipe` 只允许本地 Shotcraft Gallery 中存在的镜头卡名；`mediaIds` 必须来自当前
项目的媒体库。宿主只负责 schema、ID、路径和资源边界校验，镜头选择和排列由模型
结合 skill 自己决定。

### 2. 增加 Remotion capability

Harness 脚本通过结构化的渲染命名空间调用：

```ts
const submitted = await luna.render.remotionStart({ scene })
const task = await luna.render.remotionGetTask({ taskId: submitted.taskId })
```

当前能力为：

- `render.remotion.start`：校验 Scene Spec，创建异步任务。
- `render.remotion.get_task`：返回 `queued`、`bundling`、`rendering`、`completed`
  或 `failed`，完成时返回 MP4 artifact 和输出文件信息。
- `render.remotion.cancel`：取消仍在运行的渲染进程。

工具结果必须回传模型，由模型决定是否继续查询、导入或调整方案；宿主不能根据
“渲染完成”等文案自行结束任务。

### 3. 使用独立 worker

Electron 主进程不直接 import Remotion composition。新增一个 Node worker，负责：

1. 将 Scene Spec 和宿主解析后的当前项目媒体路径传给本次任务。
2. 使用 `@remotion/bundler` / `@remotion/renderer` 打包 composition。
3. 使用固定的 `renderMedia()` 参数渲染 MP4，并支持 AbortSignal 取消。
4. 写入 `render-manifest.json`，记录 composition、版本、输入 media ID、尺寸、帧率、
   帧数和输出 SHA256。
5. 写入 MP4 artifact 和 manifest；导入媒体库是下一步显式操作。

渲染 worker 只能读取经过 host 解析的项目媒体路径，不能接受模型任意传入的文件
系统路径。输出先写项目工作目录或导出目录的临时文件，成功后原子移动并注册；失败
或取消时清理临时文件。

### 4. 第一阶段的时间线行为

生成的视频导入后可以作为普通 `VideoItem` 加入新的视频轨道，继续裁切、分割、
移动、静音、加字幕和加转场；MP4 内部的卡片、文字和运镜暂时不拆成独立时间线
片段。这是有意的边界：Shotcraft 的 2.5D 运镜和复杂动效不能可靠地映射为 FreeCut
原生 item。

## 第二阶段：可重渲染的 Remotion 片段

在项目数据中新增 `remotionComposition` 记录，保存 Scene Spec、输入 media ID
和 renderer 版本；时间线上仍显示一个“生成片段”包装 item。预览可以使用
`@remotion/player`，导出时重新渲染并缓存结果。用户修改素材或参数后，只需使该
记录失效并重新渲染，不必把所有 Remotion 图层转换成 FreeCut item。

这一步需要处理缓存键、过期渲染、预览与导出一致性，以及媒体删除/重链。它不应和
第一阶段的普通 MP4 导入混在一起。

## 第三阶段：有限原生化

只把稳定且语义清晰的 Shotcraft 动效映射成 FreeCut 原生 item，例如标题、图片卡、
透明 PNG、淡入淡出和简单关键帧。复杂的 3D、粒子、页面截图 2.5D 相机和声音设计
继续保留为 Remotion 片段。这样可以逐步提高可编辑性，不需要一次性重写 152 张
镜头卡。

## Remotion 依赖和打包

不要把 `~/projects/remotion` 的 1.2 GiB workspace 或 `my-remotion-studio` 的
`node_modules` 直接打入 FreeCut。FreeCut 根项目已固定 `remotion`、
`@remotion/bundler` 和 `@remotion/renderer` 为 `4.0.484`。正式包命令会先执行
`prepare:remotion-runtime`，按目标平台把 compositor、FFmpeg 和 Headless Chrome
复制到仓库的构建资源目录，再由 `electron-builder` 打入安装包。构建资源目录被
git 忽略，不会把二进制提交到代码仓库。

正式包需要在对应目标平台准备运行时；例如 macOS arm64、macOS x64 和 Windows
x64 分别执行对应的 `pack:*` 命令。安装包拿到另一台同平台机器后不需要 Node、
Remotion 源码或其它外部目录。

Remotion 当前有独立的 Free/Company License 条件；FreeCut 目前是开源非商业项目，
仍应在发布包中保留 Remotion license 和版本记录。Shotcraft 的 Apache-2.0 LICENSE
及 `assets/audio/ATTRIBUTION.md` 也必须随资源发布。

## 推荐落地顺序

1. 先完成本地 skill loader 和资源打包，确认 Harness 能读取 Shotcraft 镜头卡。
2. 在 `my-remotion-studio` 中用 FreeCut 真实截图做一支 5-8 秒样片，验证选定镜头
   和素材采集流程。
3. 增加媒体库导入和“插入时间线”动作，让生成 artifact 进入现有编辑流程。
4. 再做可重渲染片段和 `@remotion/player` 预览；不要先把复杂 Shotcraft 动效强行拆成原生 item。
