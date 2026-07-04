// 自动生成 — 由 generate-changelog.cjs 创建
// 用法: node landing/generate-changelog.cjs
const CHANGELOG_DATA = [
  {
    "version": "1.4.0-hot.5",
    "title": "v1.4.0-hot.5 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>Windows 工作台导出 LUT 路径错误</strong>：ffmpeg filter_complex 中传入的 Windows 路径反斜杠 <code>\\</code> 被 ffmpeg 解析器当作转义字符处理，导致 <code>C:\\Users\\...\\.cube</code> 路径中的反斜杠和盘符全部丢失，导出失败。现修复为将 Windows 路径中的反斜杠替换为前斜杠传参（ffmpeg on Windows 支持前斜杠路径）</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>ffmpeg filter_complex 路径兼容性</strong>：在 <code>pipelineCompiler.ts</code> 中构造 <code>lut3d=file=...</code> 参数时，对 Windows 平台路径做反斜杠 → 前斜杠转换，避免再次出现类似转义问题</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.4.0-hot.4",
    "title": "v1.4.0-hot.4 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>批量导出选中项被过滤</strong>：工作台批量导出时，<code>activeIndex</code> 被错误地从选中列表中剔除，导致实际导出的文件少于选中的文件</li>\n<li><strong>工作台批量导出任务明细丢失</strong>：重构 <code>exportBatch</code>，采用与媒体库一致的导出模式（先建任务再并发调度），确保所有明细正确创建并跟踪</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>Cmd+A / Ctrl+A 全选</strong>：工作台底部素材列表支持全选快捷键</li>\n<li><strong>通用导出调度器</strong>：新增 <code>exportTaskRunner</code>，统一管理导出任务创建、并发调度、进度跟踪</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.4.0-hot.3",
    "title": "v1.4.0-hot.3 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>导出记录预览弹窗识别 Live Photo</strong>：从导出记录打开预览时，Motion Photo 图片现在正确显示 Live Photo 播放按钮</li>\n<li><strong>预览弹窗文件夹按钮无效</strong>：修复从导出记录预览时右上角「在文件夹中显示」按钮点击无反应的问题</li>\n<li><strong>Mac 安装逻辑修复</strong>：修复部分场景下 Mac 安装包处理逻辑</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>Swift 脚本统一热更新</strong>：livetool.swift、bluetoothCoreScanner.swift、wifiCoreWlan.swift 三个原生脚本纳入热更新机制，后续更新无需重新下载完整安装包，通过热更新即可推送新版 Swift 脚本</li>\n<li><strong>Live Photo 完整支持</strong>：工作台 Live Photo 图标、徽章、渲染播放全链路</li>\n<li><strong>构建脚本更新</strong>：热更新打包脚本自动包含 Swift 文件</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.4.0-hot.2",
    "title": "v1.4.0-hot.2 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复裁剪模式重新进入时丢失上次裁剪数据的问题</strong>：裁剪确认后重新进入裁剪模式，现在会保留上一次的裁剪位置和尺寸。</li>\n</ul>\n<ul>\n<li><strong>修复旋转按钮不基于当前角度的问题</strong>：左侧面板的旋转按钮（±90°）现在基于变换草稿（activeTransform）计算，裁剪模式下也能正确显示和操作当前角度。</li>\n</ul>\n<ul>\n<li><strong>修复旋转后裁剪框重置到居中的问题</strong>：旋转 orientation 时不再调用 <code>maxCropInsideImage</code> 重新计算，改为 <code>fitCropInsideImage</code> 保持现有裁剪框适配到新帧。</li>\n</ul>\n<ul>\n<li><strong>修复裁剪框旋转映射算法</strong>：从 UV 空间旋转改为通过源 UV 坐标映射（frame → source UV → new frame），正确处理横竖图切换时 frame 宽高比交换导致的裁剪框位置偏移。</li>\n</ul>\n<ul>\n<li><strong>修复裁剪模式下 Enter 键无效的问题</strong>：当焦点在侧边栏按钮上时，Enter 键触发按钮默认 click 事件导致确认裁剪被抵消。改用 capture 阶段 + preventDefault 拦截。</li>\n</ul>\n<ul>\n<li><strong>修复 Escape 键未回到调色模式的问题</strong>：<code>cancelCrop</code> 现在始终回到「色彩调节」面板。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.4.0",
    "title": "v1.4.0 — 工作台全面升级",
    "bodyHtml": "<h3>🎨 新功能</h3>\n<ul>\n<li><strong>工作台 Phase 1 上线</strong>：全新图片/视频编辑工作台，统一编辑体验</li>\n<li><strong>专业调色工具</strong>：白平衡（含吸色滴管）、影调（曝光/对比度/高光/阴影/饱和度等）、曲线（RGB 5 通道+色阶）、颜色分级（阴影/中间调/高光三路色轮）、细节（锐化/降噪）</li>\n<li><strong>视频调色</strong>：视频实时调色预览 + ffmpeg 调色导出，支持调色前后对比</li>\n<li><strong>批量调色参数复制</strong>：同场景素材一键复制粘贴调色参数</li>\n<li><strong>裁剪工具</strong>：9 种裁剪预设 + 自由尺寸、翻转旋转、宽高比锁定</li>\n<li><strong>智能水印</strong>：根据 EXIF 相机型号自动匹配水印样式，支持批量添加</li>\n<li><strong>导出任务管理</strong>：统一导出任务列表，实时进度显示</li>\n<li><strong>Apple Live Photo 导出</strong>：支持导出 Apple Live Photo 格式</li>\n</ul>\n<h3>⚡ 性能优化</h3>\n<ul>\n<li>ffmpeg 全面替代 WebGL readPixels 导出，导出速度 3-5 倍提升</li>\n<li>视频帧捕获重构为 play-capture 模式 + ring buffer IPC，导出过程更流畅</li>\n<li>缩略图懒加载，提升媒体库加载速度</li>\n</ul>\n<h3>🐛 Bug 修复</h3>\n<ul>\n<li>视频调色预览首次切换黑屏问题</li>\n<li>导出记录缩略图和文件名显示不正确</li>\n<li>水印文件名顺序修正</li>\n<li>多处调色参数与 ffmpeg 映射对齐修复</li>\n<li>更新检查下载匹配修正</li>\n</ul>\n<h3>🔧 其他</h3>\n<ul>\n<li>调色管线以 ffmpeg filter 为标准重建 GLSL 实现</li>\n<li>设备调试模块：支持 Insta360 GO Ultra 等设备连接诊断</li>\n<li>IPC handler 自动注册重构</li>\n<li>UI 组件规范化（Dialog 替代旧弹窗、标准 Table 组件）</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.3.3-hot.4",
    "title": "v1.3.3-hot.4 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复缩略图不加载问题</strong>：修复了主进程 <code>luna:cacheFile</code> 队列任务缺少 try-catch 导致异常被吞的 Bug，并增强全链路日志便于排查缩略图加载失败根因</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>增强缩略图调试日志</strong>：从渲染进程 <code>requestThumbnail</code> → IPC → 主进程队列 → <code>cacheFile</code> 下载 → <code>thumbnailService</code> ffmpeg 缩略图生成 → <code>thumbnail-ready</code> 回调的完整链路添加 INFO/ERROR 级别日志</li>\n<li><strong>缩略图生成日志修复</strong>：<code>thumbnailService.ts</code> 原来使用 <code>console.log/error</code>，日志不会写入文件，现改为 <code>logMain*</code> 写入正式日志文件</li>\n<li><strong>系统信息日志</strong>：应用启动时打印操作系统版本、芯片架构、CPU 核心数、内存等信息到日志文件</li>\n<li><strong>文件加载状态统计</strong>：媒体库加载完成后打印文件状态摘要（有缩略图/本地路径/缓存路径的文件数）</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.3-hot.3",
    "title": "v1.3.3-hot.3 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复缩略图生成失败时无日志的问题</strong>：<code>cacheFile()</code> 中的 <code>catch { /* 静默 */ }</code> 改为记录详细错误日志（本地路径检查、下载尝试、失败原因等），方便排查缩略图不显示的问题。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>HTTP URL 和相机路径不再被脱敏</strong>：<code>sanitizePaths</code> 现在会保留 <code>http://</code> 开头的 URL 和 <code>/DCIM</code>、<code>/storage_</code> 开头的相机路径完整显示，让日志更能反映真实请求。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.3-hot.2",
    "title": "v1.3.3-hot.2 — 热更新发布说明",
    "bodyHtml": "<h3>改进</h3>\n<ul>\n<li><strong>添加设备连接、HTTP 读取和缩略图生成日志</strong>：在设备连接流程（TCP 鉴权、端口检测、保活）、HTTP 文件读取（文件列表、缓存、下载）以及缩略图生成（成功/失败/清理损坏缓存）过程中增加了详细的日志记录，便于排查用户反馈的设备连接和缩略图加载问题。日志文件位于 <code>{userData}/logs/</code> 目录下。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.3-hot.1",
    "title": "v1.3.3-hot.1 — 热更新发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>Apple Live Photo 导出开关</strong>：设置页新增「Apple Live Photo」开关（默认关闭），仅在 macOS 上显示，开启后才在导出时生成配对文件夹</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>Live Photo 视频加速</strong>：跳过完整 ffmpeg pipeline，强制 <code>h264_videotoolbox</code> 硬件编码，速度提升 3-5 倍</li>\n<li><strong>版本更新检测优化</strong>：遍历 GitCode release 列表找最新版本，不再依赖有 bug 的 <code>/releases/latest</code> 接口</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>livetool.swift 元数据修复</strong>：补上关键的 <code>live-photo-info</code> 字段，修正 <code>content-identifier</code> 键名，Apple Live Photo 在 iOS 上能被正确识别</li>\n<li><strong>修复安装包文件名匹配</strong>：修正 macOS DMG 和 Windows exe 的匹配规则，使更新检测能正确找到 v1.3.3</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.3",
    "title": "v1.3.3 — Live Photo 导出支持",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>Apple Live Photo 导出</strong>：macOS 导出 Live Photo 时通过 <code>livetool.swift</code> 注入标准 Apple 配对元数据（Content Identifier UUID），文件可被 iPhone / iPad / Mac 照片 App 直接识别</li>\n<li><strong>Google Motion Photo 格式升级</strong>：从旧版 <code>MicroVideo</code> 升级为标准 <code>Container:Directory</code> 格式，兼容小米、华为/鸿蒙、三星、OPPO 等 Android 设备</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>修正 Google XMP 命名空间</strong>：改用属性语法 <code>Container:Item Item:Mime=\"...\"</code>，<code>Item:Length</code> 纯数字无前导零，确保各 Android 厂商正确识别</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.3.2-hot.14",
    "title": "v1.3.2-hot.14 — 热更新发布说明",
    "bodyHtml": "<h3>改进</h3>\n<ul>\n<li><strong>优化 Live Photo 视频处理速度</strong>：跳过完整 ffmpeg pipeline，强制 <code>h264_videotoolbox</code> 硬件编码，旧款 ARM Mac 上速度提升 3-5 倍</li>\n<li><strong>暂关闭 Apple Live Photo 配对导出</strong>：待兼容问题修复后再开启，安卓 Google Motion Photo 输出不受影响</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.2-hot.13",
    "title": "v1.3.2-hot.13 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复版本更新检测</strong>：不再依赖 GitCode 有 bug 的 <code>/releases/latest</code> 接口，改为遍历 release 列表寻找最新版本，确保能正确检测到 v1.3.3</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.2-hot.12",
    "title": "v1.3.2-hot.12 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复版本更新检测</strong>：修正安装包文件名匹配规则，使当前版本能正确检测到 v1.3.3 新版本并提示下载</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.2-hot.11",
    "title": "v1.3.2-hot.11 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复 Windows NVIDIA 显卡导出 10-bit HEVC 视频时崩溃</strong>：NVIDIA CUDA 硬件加速配置中使用了 <code>overlay_cuda</code> GPU 滤镜，当视频为 10-bit HEVC（yuv420p10le）格式时，PNG 水印上传到 GPU 后无法完成格式转换，导出直接失败。现改为 CPU overlay + GPU 编码的混合方案，稳定性大幅提升。</li>\n</ul>\n<ul>\n<li><strong>修复 Windows 上检查更新时下载到 .dmg 文件</strong>：更新服务中安装包匹配逻辑使用 <code>.find()</code> 返回第一个匹配项，当 Release 中同时存在 Mac 和 Windows 安装包时，Windows 用户可能匹配到 Mac 的 .dmg 文件。现已根据操作系统精确匹配对应平台和架构的安装包。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>Watermark 水印滤镜优化</strong>：软件 overlay 路径增加 <code>format=rgba</code> 确保 PNG 透明通道稳定，overlay 增加 <code>:format=auto</code> 自动选择最佳输出格式。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.2-hot.10",
    "title": "v1.3.2-hot.10 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复旧 Mac 上回退 H.264 编码时文件不可播放</strong>：当旧 Mac 不支持 HEVC 硬件编码时，系统回退到 <code>h264_videotoolbox</code> 硬件编码，但容器 tag 仍标为 HEVC（<code>hvc1</code>），导致输出文件不可播放。现根据实际编码器动态选择正确的 <code>avc1</code>/<code>hvc1</code> tag。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>hevc 不可用时不使用 libx265（软件）编码，而是回退到 h264_videotoolbox（硬件）</strong>：速度提升 10 倍以上，代价是输出从 HEVC 变为 H.264，但对旧硬件这是最快可用的方案。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.2-hot.9",
    "title": "v1.3.2-hot.9 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复低版本 macOS 视频导出失败问题</strong>：某些旧 Mac（macOS &lt; 10.13 或旧款 Intel 硬件）不支持 HEVC 硬件编码，使用 <code>hevc_videotoolbox</code> 时底层 VideoToolbox 框架返回 <code>kVTParameterErr (-12905)</code> 导致导出报错。现增加启动时自动探测机制，检测到 <code>hevc_videotoolbox</code> 不可用时自动回退到 <code>libx265</code> 软件编码，确保所有 Mac 都能正常导出。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>硬件加速探测增强</strong>：macOS 平台首次导出前会快速验证 <code>hevc_videotoolbox</code> 是否真实可用，避免因旧系统兼容性问题导致导出中途失败</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.2-hot.8",
    "title": "v1.3.2-hot.8 — 热更新发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>设置拆分\"基础目录\"和\"本地资源目录\"</strong>：原来的\"下载目录\"更名为\"基础目录\"，新增独立\"本地资源目录\"设置项，可分别控制通用文件（缓存/预览）和相机下载文件的存放位置</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>统一路径管理</strong>：所有 <code>localResources</code> 路径统一通过 <code>getLocalResourcesDir()</code> 公共方法获取，消除魔法字符串</li>\n</ul>\n<h3>修复</h3>\n<ul>\n<li><strong>修复本地资源目录读取路径错误</strong>：因目录结构调整导致\"本地资源\"页面不显示文件的问题</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.2-hot.7",
    "title": "v1.3.2-hot.6 — 热更新发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>热更新发布说明查看</strong>：检测到热更新时横幅新增「更新内容」按钮，点击可查看本次热更新的 Bug 修复和改进详情</li>\n<li><strong>构建脚本自动打 tag</strong>：<code>build-hot-update.sh</code> 执行完后自动创建 <code>hot/v1.3.2-hot.x</code> 并推送到远程</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复 Live Photo 水印定位偏移问题</strong>：<code>probeImage()</code> 改用 <code>probe-image-size</code> 库替换 ffprobe，彻底解决不同 ffprobe 版本/平台下 Live Photo 文件流顺序不一致导致图片尺寸读错、水印位置跑偏的问题</li>\n<li><strong>修复导出后预览仍加载源文件的问题</strong>：导出进度弹窗点击「预览」时，正确使用导出文件（带水印）替代原始相机文件。同时修复 Live Photo 预览因文件名缓存碰撞导致播放无水印原片的问题</li>\n<li><strong>修复 Live Photo 视频水印位置偏高的问题</strong>：视频水印 Y 方向边距改用 <code>outputH × 3%</code>（之前误用 <code>outputW</code>），使其与图片水印底部边距比例一致</li>\n<li><strong>修复预览预览 Live Photo 视频无水印的问题</strong>：播放区块新增 <code>WatermarkOverlay</code> 覆盖层</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>开发模式跳过热更新</strong>：<code>npm run dev</code> 时不再加载已安装的热更新代码，直接使用本地源码</li>\n<li><strong>窗口标题始终显示版本号</strong>：无热更新时显示 <code>Luna AI Cut v1.3.2</code>，有热更新追加 <code>-hot.x</code> 后缀</li>\n<li><strong>减少 ffprobe 依赖</strong>：图片尺寸探测从 ffprobe 子进程改为 <code>probe-image-size</code> 库，减少跨平台兼容问题</li>\n<li><strong>导出进度弹窗日志增强</strong>：新增 <code>[PROBE IMG]</code>、<code>[WATERMARK IMG]</code>、<code>[WATERMARK VID]</code>、<code>[EXPORT]</code> 等关键链路日志，方便问题排查</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.3.2",
    "title": "# 新功能",
    "bodyHtml": "<ul>\n<li><strong>集成热更新系统</strong>：从此版本开始，UI 修复和功能迭代可通过增量 JS 热更新推送，无需下载完整安装包。应用启动后自动检查热更新，1.4MB 左右的 zip 包秒级下载生效</li>\n<li>热更新版本号显示在窗口标题栏（如 <code>Luna AI Cut v1.3.2-hot.1</code>）</li>\n<li>设置页新增热更新状态提示</li>\n</ul>\n<h3>UI 变化</h3>\n<ul>\n<li>精简设置页，移除设备类型选择（单一设备时无实际意义）</li>\n<li>日志文件名加入应用版本号，方便问题排查</li>\n</ul>\n<h3>其他</h3>\n<ul>\n<li>移除已废弃的 <code>sharp</code> 原生模块依赖和相关配置</li>\n<li>构建脚本新增 <code>build-hot-update.sh</code>，支持一键构建并上传热更新包</li>\n<li>部署脚本 <code>deploy-release.sh</code> 自动附带热更新资产上传</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.3.1",
    "title": "v1.3.1",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>Camera 子文件夹兼容</strong>：修复相机在图片过多时自动创建 Camera01、Camera02 等多文件夹后，应用只能读取 Camera01 的问题。现在会自动扫描 DCIM 根目录下的所有 Camera* 子文件夹并聚合显示所有文件。</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.3.0",
    "title": "v1.3.0 发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>FFmpeg 硬件加速</strong>：视频导出自动启用 GPU 加速</li>\n</ul>\n<p>\n  - macOS: VideoToolbox（Apple Silicon + Intel 均支持）\n<br>\n  - Windows: NVIDIA CUDA / Intel QSV / AMD AMF 自动探测\n<br>\n  - 兼容降级：硬件不可用时自动回退到软件编码\n</p>\n<ul>\n<li><strong>日志系统</strong>：主进程 + 渲染进程统一日志，方便排查问题</li>\n<li><strong>国内资源部署脚本</strong>：构建产物自动上传到 GitCode 国内镜像</li>\n<li><strong>CI 构建优化</strong>：macOS x64 / ARM64 + Windows x64 自动打包</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>导出码率不准</strong>：硬件编码器默认码率过低的问题已修复，原始画质导出匹配源文件码率</li>\n<li><strong>macOS x64 硬件加速</strong>：修复 <code>-hwaccel_output_format</code> 参数不兼容 tessus/evermeet.cx ffmpeg 构建的问题</li>\n<li><strong>Windows CUDA 探测</strong>：修复 ffmpeg 静态检出 CUDA 编码器但机器无 NVIDIA 显卡时的崩溃</li>\n<li><strong>音频重编码</strong>：音频流改为 <code>-c:a copy</code> 直拷，避免不必要的重编码和质量损失</li>\n</ul>\n<h3>UI 变化</h3>\n<ul>\n<li>导出进度弹窗优化：实际帧率显示</li>\n<li>设置页日志级别控制</li>\n</ul>\n<h3>其他</h3>\n<ul>\n<li>升级 electron-builder 配置</li>\n<li>完善开发文档和发版流程</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.2.14",
    "title": "v1.2.14",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li>修复并发导出时的临时目录冲突问题。同时导出多个文件时，每个导出使用独立的临时目录，避免文件被误删导致导出失败（<code>ENOENT</code> 错误）。</li>\n<li>修复水印计算在特定场景下的差异问题，优化水印叠加视觉效果。</li>\n<li>移除错误的抖音账号（登录页）。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li>水印计算逻辑重构，提升稳定性和可维护性。</li>\n<li>新增水印布局模块（containRect / layout），为后续水印位置自定义打下基础。</li>\n<li>部署脚本优化，完善 GitCode 国内镜像发布流程。</li>\n</ul>\n<h3>其他</h3>\n<ul>\n<li>GitCode 发布 landing 页面样式更新。</li>\n<li>macOS/Windows 打包配置维护。</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.2.13",
    "title": "发布说明 v1.2.13",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>视频导出功能</strong> — 支持视频导出时叠加自定义水印、调整分辨率/帧率/码率、转码及水印预览</li>\n<li><strong>导出队列预览列表</strong> — 导出进度弹窗增加队列预览列表，直观查看所有待导出任务的进度状态</li>\n<li><strong>导出示意图功能</strong> — 导出设置中的图片支持拖拽可视化调整布局</li>\n<li><strong>新增 UI 组件</strong> — 新增手风琴折叠面板（Accordion）和下拉选择器（Select），优化导出设置交互</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>导出进度修复</strong> — 修复同一文件多次导出时进度记录互相覆盖的问题</li>\n<li><strong>遮罩层关闭修复</strong> — 修复点击遮罩层无法关闭面板的问题</li>\n<li><strong>Windows 构建 ffmpeg 缺失</strong> — 修复 Windows 安装包中缺少 ffmpeg.exe 的问题</li>\n</ul>\n<h3>UI 变化</h3>\n<ul>\n<li><strong>导出设置布局调整</strong> — 导出弹窗布局优化，水印设置项分组更清晰</li>\n<li><strong>设置面板调整</strong> — 导出参数设置布局重构，更好适配各项参数配置</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.2.10",
    "title": "v1.2.10",
    "bodyHtml": "<h4>重构</h4>\n<ul>\n<li>统一弹窗层架构，提取可复用组件：ModalLayer / DropdownPanel / Modal / MediaPreviewPanel</li>\n<li>BaseModal / DownloadProgressModal / ExportProgressModal 统一使用新的弹窗层</li>\n<li>ExportModal 使用 MediaPreviewPanel 替代内联预览</li>\n</ul>\n<h4>Bug 修复</h4>\n<ul>\n<li>修复竖图在预览弹窗中显示不全的问题</li>\n<li>修复未下载的文件显示水印覆盖层和水印设置的问题</li>\n<li>修复设备媒体库预览弹窗底部缩略图条显示导出数据的问题</li>\n<li>修复弹窗遮罩层只覆盖工具栏区域的反复回归问题</li>\n</ul>\n<h4>UI 变化</h4>\n<ul>\n<li>水印默认大小改为「大」，默认样式改为「中文」</li>\n<li>预览弹窗导出时显示「已加入导出队列」toast 提示</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.2.9",
    "title": "v1.2.9",
    "bodyHtml": "<h3>优化</h3>\n<ul>\n<li>GitCode 上传拆为独立 Job，不阻塞 GitHub Release</li>\n<li>进度条显示（pv），隐藏 curl 详细输出</li>\n<li>URL 编码文件名</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.2.8",
    "title": "v1.2.8",
    "bodyHtml": "<h3>修复</h3>\n<ul>\n<li>URL 编码上传文件名，修复含空格文件名导致 curl 拒绝</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.2.7",
    "title": "v1.2.7",
    "bodyHtml": "<h3>修复</h3>\n<ul>\n<li>GitCode 认证方式改为 PRIVATE-TOKEN Header</li>\n<li>修复构建产物文件路径查找（find 递归匹配）</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.2.6",
    "title": "v1.2.6",
    "bodyHtml": "<h3>修复</h3>\n<ul>\n<li>修复 GitCode Release 创建失败问题（补全必填 body 字段）</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.2.5",
    "title": "v1.2.5 发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>国内镜像加速</strong> — 构建产物同步上传至 GitCode Release，国内用户可高速下载</li>\n<li><strong>GitCode 镜像仓库</strong> — README 自动更新最新版本下载链接</li>\n<li><strong>GitHub Pages 镜像入口</strong> — Landing 页面新增「国内镜像加速」板块</li>\n</ul>\n<h3>其他</h3>\n<ul>\n<li>优化发布流程，GitCode 与 GitHub Release 同步更新</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.2.4",
    "title": "v1.2.4 发布说明",
    "bodyHtml": "<p>\nLuna AI Cut 的首个公开发布版本！一款面向 Insta360 Luna Ultra 相机的桌面媒体管理应用。\n</p>\n<h3>新功能</h3>\n<ul>\n<li><strong>相机连接</strong> — 支持连接 Luna Wi-Fi 热点，自动检测并加载媒体库</li>\n<li><strong>媒体浏览</strong> — 按日期分组浏览相机中的照片和视频</li>\n<li><strong>媒体下载</strong> — 单选/组选/框选下载，支持下载进度提示</li>\n<li><strong>媒体预览</strong> — 支持预览照片和视频，包含缩略图条</li>\n<li><strong>水印工具</strong> — 支持导出时添加水印，可自定义位置和样式</li>\n<li><strong>WiFi + 蓝牙双模连接</strong> — 自动扫描并连接 Luna 设备</li>\n<li><strong>设置页面</strong> — 下载目录、开发者模式、Mock Server、AI 配置</li>\n</ul>\n<h3>UI 变化</h3>\n<ul>\n<li>紧凑型媒体库布局，媒体内容为主</li>\n<li>支持响应式布局，适配不同窗口尺寸</li>\n<li>预览弹窗支持方向键导航</li>\n</ul>\n<h3>其他</h3>\n<ul>\n<li>基于 Electron + React + TypeScript 构建</li>\n<li>macOS DMG 和 Windows NSIS 安装包支持</li>\n</ul>",
    "isHotfix": false
  }
]
