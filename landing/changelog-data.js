// 自动生成 — 由 generate-changelog.cjs 创建
// 用法: node landing/generate-changelog.cjs
const CHANGELOG_DATA = [
  {
    "version": "1.7.1",
    "title": "v1.7.1",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>原片预览与下载</strong>：支持在预览窗口查看相机原始视频，并可直接下载单个素材。</li>\n<li><strong>手机分享</strong>：支持将本地媒体通过临时分享页面发送到手机，提供更完整的分享操作和下载体验。</li>\n<li><strong>本地媒体分享服务</strong>：增加分享文件整理、压缩和访问能力，支持在设置中管理相关选项。</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>缩略图滚动</strong>：修复缩略图条无法正确响应垂直滚轮的问题。</li>\n<li><strong>提示位置</strong>：调整工作区工具提示的位置，减少对编辑内容的遮挡。</li>\n<li><strong>模拟相机访问</strong>：支持媒体请求独立于短暂的连接会话，便于本地调试和录制。</li>\n</ul>\n<h3>UI 变化</h3>\n<ul>\n<li>优化预览窗口头部、缩略图条和分享弹窗的操作布局。</li>\n<li>补充相机媒体页和设置页中的分享入口与状态展示。</li>\n</ul>\n<h3>其他</h3>\n<ul>\n<li>更新项目版本至 <code>1.7.1</code>。</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.7.0-hot.7",
    "title": "v1.7.0-hot.7 - 热更新发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>按日期整理下载</strong>：可在设置中开启按拍摄日期将新下载放入 <code>YYYY-MM-DD</code> 文件夹。</li>\n<li><strong>整理旧下载</strong>：可在设置中将已有下载按拍摄日期归入文件夹，无法识别日期或遇到重名的文件会保留原处。</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>下载目录兼容</strong>：日期子目录中的下载现在可以正常识别、浏览、预览和继续下载。</li>\n<li><strong>热更新重启</strong>：应用重启后会自动恢复窗口并激活，避免 macOS 窗口停留在最小化状态。</li>\n</ul>\n<h3>UI 变化</h3>\n<ul>\n<li><strong>文件与存储设置</strong>：整理旧下载按钮会在开启按日期分文件夹后显示，并位于开关左侧。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.7.0-hot.6",
    "title": "v1.7.0-hot.6 - 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复 Dolby Vision 水印导出失败</strong>：导出到尚未创建的目录时，应用现在会自动创建目标目录，避免封装阶段无法创建临时文件。</li>\n</ul>\n<h3>兼容性说明</h3>\n<ul>\n<li>本次更新包含 Apple 芯片 Mac、Intel Mac 和 Windows x64 三个平台的原生渲染组件，支持从 Luna AI Cut v1.7.0 或任意较早的 v1.7.0 热更新直接升级。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.7.0-hot.5",
    "title": "v1.7.0-hot.5 - 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复本地存储迁移失败</strong>：迁移时不再处理应用正在写入的运行日志，避免 Windows 因日志文件被占用而中断项目、素材和设置迁移。</li>\n</ul>\n<h3>兼容性说明</h3>\n<ul>\n<li>本次更新继续包含 Apple 芯片 Mac、Intel Mac 和 Windows x64 三个平台的原生渲染组件，支持从 Luna AI Cut v1.7.0 或任意较早的 v1.7.0 热更新直接升级。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.7.0-hot.4",
    "title": "v1.7.0-hot.4 - 热更新发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>AI 选片人物管理升级</strong>：支持查看已识别人物、合并同一人物、隐藏不需要的人物，并可重新选择人物头像。</li>\n<li><strong>本地资源目录迁移</strong>：修改本地资源保存位置时，可将已有项目和素材迁移到新目录，并在迁移前检查空间与文件状态。</li>\n<li><strong>视频导出可关闭声音</strong>：导出视频时可选择是否保留原始声音，预览页和工作台导出均可使用。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>提高 AI 选片准确性与可控性</strong>：优化照片和视频中的人脸归组、人物封面、选中状态与重新分析流程；视频人脸可定位到对应画面。</li>\n<li><strong>改善人物合并体验</strong>：重新整理人物合并界面和操作反馈，合并结果会正确保留人物名称、头像与选择状态。</li>\n<li><strong>改善图片自然美颜</strong>：优化磨皮与细节处理，在平滑肤色的同时减少边缘和纹理损失。</li>\n<li><strong>改善素材拖放与复制</strong>：支持将本地素材拖入 AI 选片，并改善文件复制、下载目录和跨目录保存的稳定性。</li>\n<li><strong>提高设置与项目数据可靠性</strong>：调整设置、项目、预设和任务记录的保存位置及迁移流程，减少目录变更后数据丢失或读取旧数据的问题。</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复 AI 选片缓存异常</strong>：避免重新分析或人物调整后继续显示过期的识别和选择结果。</li>\n<li><strong>修复素材拖放失败</strong>：修复部分本地文件拖入媒体库或 AI 选片后没有正确加入的问题。</li>\n<li><strong>修复视频导出声音处理</strong>：关闭声音时不再执行音轨合并，并改善 macOS 与 Windows 的导出结果一致性。</li>\n<li><strong>修复更新说明缺失</strong>：帮助弹窗会显示安装版和已安装热更新的全部更新记录，包括此前的 <code>hot.2</code> 与 <code>hot.3</code>。</li>\n</ul>\n<h3>兼容性说明</h3>\n<ul>\n<li>本次更新包含原生渲染组件改动，将分别提供 Apple 芯片 Mac、Intel Mac 和 Windows x64 三个平台的热更新包。</li>\n<li>热更新仅适用于已安装的 Luna AI Cut v1.7.0。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.7.0-hot.3",
    "title": "v1.7.0-hot.3 - 热更新发布说明",
    "bodyHtml": "<h3>改进</h3>\n<ul>\n<li><strong>工作台缩略图显示视频时长</strong>：工作台底部的视频素材缩略图现在会显示总时长，方便快速识别和切换素材。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.7.0-hot.2",
    "title": "v1.7.0-hot.2 - 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>改善热更新安装可靠性</strong>：更新下载或内容异常时会保留当前可用版本，并在下次检查时重新获取。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>预览缩略图显示视频时长</strong>：预览窗口底部的视频缩略图会直接显示总时长，无需先打开视频。</li>\n<li><strong>放大预览缩略图</strong>：缩略图条会随窗口高度调整大小，并限制最大高度，让素材更容易辨认。</li>\n<li><strong>补全媒体库视频信息</strong>：视频缩略图准备完成后会自动读取时长并显示。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.7.0",
    "title": "v1.7.0 - 发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>图片对象消除</strong>：可使用画笔、矩形或智能点选标记不需要的内容，在本地补全背景；支持多次处理、原图对比、项目保存和编辑后导出。</li>\n<li><strong>发送到手机</strong>：电脑与手机连接同一局域网后，可扫描二维码浏览本地素材和导出文件，预览图片或兼容视频，并选择多个文件下载到手机。</li>\n<li><strong>图片自然美颜</strong>：为人像图片提供面部美白、皮肤整体美白、磨皮和质感调整，支持自动识别皮肤区域并手动修复选区。</li>\n<li><strong>视频语音字幕</strong>：可在本地从视频语音生成带时间的字幕，修改文字和样式，并随画面一起导出或单独导出 SRT 文件。</li>\n<li><strong>DNG 素材支持</strong>：本地资源、相机媒体和 AI 整理流程可以识别并处理 DNG 原始图片。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>扩展视频截取与导出</strong>：时间线可分别标记视频片段、静态照片和 Live 图片段，并将多种结果一次加入导出队列。</li>\n<li><strong>优化工作台编辑体验</strong>：重新整理编辑工具入口和素材切换流程，复制效果时可同时包含美颜、边框等设置。</li>\n<li><strong>改善手机浏览体验</strong>：优化移动端相册、预览切换、图片缩放、持续加载和微信内打开提示。</li>\n<li><strong>提高 Windows 兼容性</strong>：D3D12 不可用时会自动回退到 OpenGL，并完善原生组件和 Dolby 工具的构建检查。</li>\n<li><strong>改善自动字幕分段</strong>：新增本地 ONNX 标点恢复模型，结合自然语言词组、停顿和字幕长度重新分段；保留问号并清理其他句末标点。</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复局部调色叠加异常</strong>：多个重叠蒙版会按预期共同生效，旧版不兼容的调色数据会在渲染前安全处理。</li>\n<li><strong>修复自定义水印导入限制</strong>：允许使用小尺寸水印，并改善部分 WebP 水印的导入与显示。</li>\n<li><strong>修复预览与导出细节</strong>：改善暂停视频调色刷新、复杂图层组合和不同输出类型下的画面一致性。</li>\n</ul>\n<h3>说明</h3>\n<ul>\n<li>对象消除、自然美颜和语音字幕所需模型会在首次使用时按需下载，素材处理均在本地完成。</li>\n<li>对象消除与自然美颜当前用于图片；语音字幕当前用于视频。</li>\n<li>发送到手机只在用户主动开启时提供临时只读访问，停止发送或退出应用后原二维码失效。</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.6.7-hot.3",
    "title": "v1.6.7-hot.3 热更新发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>灵活标记导出内容</strong>：可以在视频时间线上分别添加视频片段、静态照片和 Live 图片段标记。</li>\n<li><strong>支持多种导出方式</strong>：可以按需要导出普通视频、通用 Live 图或 Apple Live 图，并将多种结果一次加入导出队列。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>优化时间线编辑体验</strong>：统一不同标记的预览、选择、命名和删除操作，导出内容更加直观。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.6.7-hot.2",
    "title": "v1.6.7-hot.2 - 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>允许使用小尺寸自定义水印</strong>：移除自定义水印图片的最小尺寸限制。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>控制水印图片大小</strong>：自定义水印图片单边最大尺寸调整为 2048 像素。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.6.7-hot.1",
    "title": "v1.6.7-hot.1 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复视频调色预览不更新</strong>：修复部分设备在视频暂停时调整 LUT、色彩参数或使用原图对比后，预览画面没有及时变化的问题。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>提升暂停预览响应</strong>：视频暂停时修改画面效果会立即刷新预览，无需播放视频后才能看到变化。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.6.7",
    "title": "v1.6.7 - 发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>柔焦相框支持水印</strong>：图片和视频使用柔焦相框时，水印会正确显示在清晰主图上，并保留所选位置、大小和透明度。</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复 Windows 预览播放问题</strong>：改善硬件加速预览的启动、暂停、继续播放和素材切换稳定性，减少黑屏、卡顿及画面停止更新。</li>\n<li><strong>修复 Windows 水印与相框导出</strong>：统一预览和导出的图层顺序及位置计算，避免水印被主图遮挡或偏离设置位置。</li>\n<li><strong>修复 Luna Ultra 水印选择</strong>：恢复不同水印样式的正确识别和切换，图片与视频会使用对应资源。</li>\n<li><strong>修复长时间预览的资源占用</strong>：完善预览会话创建、更新和释放流程，降低连续播放或频繁切换素材后的资源累积。</li>\n</ul>\n<h3>UI 变化</h3>\n<ul>\n<li><strong>水印设置与柔焦相框联动</strong>：水印的位置和大小现在以柔焦相框中的清晰主图区域为基准，设置结果更直观。</li>\n</ul>\n<h3>其他</h3>\n<ul>\n<li><strong>缩短 Windows 首次渲染等待</strong>：优化渲染组件准备流程，减少首次打开硬件加速预览时的等待。</li>\n<li><strong>完善 Windows 构建资源</strong>：补充发布构建所需资源的自动准备与校验，提高安装包构建稳定性。</li>\n<li><strong>优化有线相机读取</strong>：连接多个相机磁盘时，会自动读取所有包含媒体目录的磁盘。</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.6.6-hot.1",
    "title": "v1.6.6-hot.1 - 热更新发布说明",
    "bodyHtml": "<h3>改进</h3>\n<ul>\n<li><strong>优化连线模式</strong>：检测到多个相机磁盘时，会自动读取所有包含 DCIM 目录的磁盘，无需逐个手动选择。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.6.6",
    "title": "v1.6.6 - 发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>像素流光</strong>：支持为图片和视频生成像素流光效果。应用会识别主体与画面层次，让细密像素沿不同区域流动并逐步唤醒原有色彩；可调整效果时长、像素密度、亮度、主体方向和初始画面状态。</li>\n<li><strong>只有你的色彩</strong>：支持保留图片主体色彩并将背景自然转为黑白。提供快速识别、精准识别和点选主体三种方式，可分别调整主体与背景的曝光、色彩、亮度和对比度。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>完善创意工作流</strong>：两个新创意均支持在素材栏连续处理多个素材并保存各自参数；“只有你的色彩”支持批量导出图片，“像素流光”支持图片和视频导出。</li>\n<li><strong>增加效果对比</strong>：创意编辑时可快速查看原图与当前效果，便于确认主体边缘和色彩表现。</li>\n<li><strong>改善 Intel Mac 兼容性</strong>：修正 Intel Mac 安装包中智能识别组件的加载方式，并在打包阶段自动检查所需组件是否完整。</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复图片导出方向</strong>：保留竖拍图片的原始方向信息，避免导出后出现横竖方向错误。</li>\n<li><strong>修复像素流光导出一致性</strong>：改善主体边缘、画面层次和硬件加速导出表现，使预览与最终文件更加一致。</li>\n<li><strong>修复部分视频导出异常</strong>：改善帧率与源文件信息读取，降低导出速度或画面节奏不符合预期的情况。</li>\n</ul>\n<h3>说明</h3>\n<ul>\n<li>“只有你的色彩”当前用于图片素材；“像素流光”支持图片和视频素材。</li>\n<li>智能识别结果会保存在当前项目中，切换素材后可继续调整，不会修改或覆盖原始文件。</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.6.5-hot.1",
    "title": "v1.6.5-hot.1 - 热更新发布说明",
    "bodyHtml": "<h3>更新方式</h3>\n<ul>\n<li>本次为平台无关的应用热更新，只更新界面和应用逻辑，不包含原生模块，无需分别构建 macOS 或 Windows 平台包。</li>\n<li>版本 <code>1.6.5</code> 用户可在应用内直接下载更新并重启生效。</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复竖图导出方向错误</strong>：修复本地资源中的竖向照片导出后横躺的问题，导出图片现在会保持正确方向，同时保留相机与拍摄信息。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>完善导出图片信息</strong>：导出图片记录的宽高会与实际文件保持一致。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.6.5",
    "title": "v1.6.5 - 发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>AI 选片</strong>：支持从本地资源、多个文件或文件夹创建选片任务，通过场景、相似素材、人物证据和视频关键帧形成推荐结果，并允许用户随时换选、保留或排除素材。</li>\n<li><strong>人物整理</strong>：支持识别和整理人物分组，在不同选片任务之间复用人物名称，并可手动合并被拆分的人物组。</li>\n<li><strong>自定义水印库</strong>：支持批量导入 PNG、JPEG 和 WebP 水印，按文件名搜索并持久化保存；单次选择一个水印后可调整六个预设位置、自由位置、大小和透明度。</li>\n<li><strong>视频片段标记</strong>：工作台可以保存多个视频时间范围和剪辑备注，点击标记即可恢复对应截取范围，并支持复制或导出片段 JSON。</li>\n<li><strong>Dolby Vision 素材支持</strong>：本地资源列表可识别 Dolby Vision 与 I-Log 视频；符合条件的 Dolby Vision 8.4 视频可使用保真水印导出。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>更快形成选片结果</strong>：照片优先完成分析，视频继续在后台处理；视频故事板仅在查看时生成并缓存。</li>\n<li><strong>简化选片工作区</strong>：左侧集中选片阶段、筛选和操作，右侧专注素材预览，减少重复信息和无效步骤。</li>\n<li><strong>完善水印管理</strong>：设置页使用独立的深色水印管理弹窗，可继续添加、查看文件名或删除自定义水印；内置水印继续保持原有五个固定位置和固定大小。</li>\n<li><strong>优化水印搜索</strong>：文件名匹配会忽略大小写、空格、常见标点、特殊符号和全角半角差异。</li>\n<li><strong>优化 LUT 分类浏览</strong>：LUT 分类改为垂直折叠布局，不再依赖横向滚动查找分类。</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复设备媒体库导航状态</strong>：从设备连接页进入媒体库后，顶部“设备媒体库”会正确显示为当前页面。</li>\n<li><strong>修复 Dolby Vision 导出信息</strong>：保留源视频检测到的码率，并修正导出视频的 HEVC 配置信息。</li>\n<li><strong>改善人物与缩略图处理</strong>：修复部分选片任务中的人物头像、缩略图和分组状态异常。</li>\n</ul>\n<h3>说明</h3>\n<ul>\n<li>AI 只提供非破坏性推荐，不会自动删除、移动或覆盖原始素材。</li>\n<li>自定义水印大小表示水印宽度占素材画面宽度的比例，默认 <code>23%</code>；导入文件会复制到应用管理目录，删除水印库条目不会删除用户的原始文件。</li>\n<li>视频片段标记用于整理、回看和交换时间范围，不会自动拼接或批量导出多个片段。</li>\n<li>Dolby Vision 保真导出首版仅支持本地资源中的 Profile 8.4 视频和静态水印。</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.6.3-hot.1",
    "title": "v1.6.3-hot.1 - 热更新发布说明",
    "bodyHtml": "<h3>问题修复</h3>\n<ul>\n<li><strong>改进预览启动失败提示</strong>：根据组件缺失、版本不匹配、系统运行组件缺失或显卡驱动异常，显示更准确的处理建议。</li>\n<li><strong>增加诊断详情</strong>：预览无法启动时可展开诊断详情，便于截图反馈和定位问题。</li>\n<li><strong>修复重新检测状态</strong>：预览组件加载失败时会正确结束初始化流程，避免应用持续停留在异常保护状态。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.6.3",
    "title": "v1.6.3 - 发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复 Apple 芯片 Mac 的视频解析失败</strong>：ARM64 安装包改用原生 ffprobe，解决部分用户预览或导出时出现的架构不兼容问题，无需安装 Rosetta。</li>\n<li><strong>修复热更新版本选择</strong>：先选择最新热更新版本，同版本同时存在通用包和平台包时再优先选择平台包。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>增加 macOS 打包架构校验</strong>：打包时自动检查 ffmpeg 和 ffprobe 的目标架构，防止不兼容的工具进入安装包。</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.6.2-hot.3",
    "title": "v1.6.2-hot.3 - 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>自动恢复渲染初始化保护</strong>：旧版本异常遗留渲染保护时自动重新检测一次，用户无需手动删除配置文件；如果显卡初始化仍然崩溃，应用会继续保持兼容保护，避免循环崩溃。</li>\n<li><strong>避免正常退出遗留保护状态</strong>：应用关闭时主动清理正在初始化的临时标记，减少下次启动误判显卡不兼容的问题。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.6.2-hot.2",
    "title": "v1.6.2-hot.2 - 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复相机素材预览黑屏</strong>：相机素材缓存完成后会重新读取预览区域尺寸，修复缩略图正常但打开照片或视频预览时显示黑屏的问题。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.6.2-hot.1",
    "title": "v1.6.2-hot.1 - 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>恢复 Luna 相机文件列表读取</strong>：连接相机后重新通过 TCP 协议读取媒体列表，修复协议迁移后错误使用 HTTP 目录列表的问题。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>加强协议构建检查</strong>：发布前验证文件列表调用链和私有协议组件能力，避免后续迁移再次遗漏 TCP 接入。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.6.2",
    "title": "v1.6.2 - 发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复 Windows 无法启动</strong>：修复 Windows 安装包中相机连接组件无法正常加载、应用只有后台进程但不显示主界面的问题</li>\n<li><strong>增加启动反馈</strong>：应用打开后立即显示加载状态，主界面准备完成后自动进入应用</li>\n<li><strong>改善启动失败提示</strong>：启动异常时显示明确提示并保留诊断记录，方便快速定位问题</li>\n</ul>\n<h3>其他</h3>\n<ul>\n<li>加强三平台安装包发布检查，避免不完整的相机连接组件进入正式版本</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.6.0",
    "title": "v1.6.0 - 发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>智能蒙版编辑</strong>：支持识别人像、天空、树木、水面等画面区域，并可通过画笔、形状和选区继续精修蒙版</li>\n<li><strong>视频蒙版跟踪</strong>：视频中的蒙版可跟随目标移动，减少逐帧调整的工作量</li>\n<li><strong>调色蒙版</strong>：可针对画面局部单独调整颜色，并支持叠加、反选、羽化和强度控制</li>\n<li><strong>像素拉伸创意</strong>：新增可编辑路径、取样范围和效果参数的像素拉伸创意，并支持一致的预览与导出</li>\n<li><strong>虚化照片相框</strong>：新增可调节的虚化照片相框，支持边框、阴影和画面布局调整</li>\n<li><strong>有线相机素材访问</strong>：连接 Luna Ultra 后可直接浏览相机存储中的素材，扩展无线连接之外的导入方式</li>\n<li><strong>资源按需下载</strong>：首次使用智能蒙版等能力时自动下载所需资源，支持中断后继续下载和多下载源切换</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>提升预览与导出一致性</strong>：修复蒙版、边框、像素拉伸及多图层效果在预览和导出中表现不一致的问题</li>\n<li><strong>修复蒙版编辑稳定性</strong>：修复选区边界、画笔预览、重置、撤销恢复和项目重新打开后的多项异常</li>\n<li><strong>修复视频处理过期结果</strong>：快速切换素材或重复操作时，不再应用已经失效的识别和跟踪结果</li>\n<li><strong>保留照片信息</strong>：导出照片时恢复并保留拍摄信息，修复部分导出文件信息缺失的问题</li>\n<li><strong>恢复 Luna Ultra 水印</strong>：修复特定导出流程中相机水印未正确显示的问题</li>\n<li><strong>改善大素材预览</strong>：优化轻量预览和缩略图就绪判断，减少打开大尺寸素材时的等待和空白状态</li>\n</ul>\n<h3>UI 变化</h3>\n<ul>\n<li><strong>重新设计相机连接页</strong>：连接状态和可用方式更加清晰，新增 Luna 品牌视觉并优化操作反馈</li>\n<li><strong>重整工作区蒙版面板</strong>：智能选择、手动编辑、局部调色和跟踪操作集中到更清晰的工作流中</li>\n<li><strong>优化工作区工具栏与帮助</strong>：调整预览工具、导入入口、创意工厂和帮助内容，减少常用操作的查找成本</li>\n<li><strong>改进设置页</strong>：资源状态、下载进度和相关设置集中展示，便于查看当前可用能力</li>\n</ul>\n<h3>其他</h3>\n<ul>\n<li><strong>恢复 Luna Ultra 色彩</strong>：新增相机素材的色彩恢复选项，可在后续调色前还原更自然的基础画面</li>\n<li><strong>增强资源可靠性</strong>：资源按版本管理并自动检查完整性，下载失败时可切换备用来源</li>\n<li><strong>完善关键流程检查</strong>：补充蒙版、跟踪、资源下载、相机访问、预览和导出等核心流程的自动检查</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.5.2",
    "title": "v1.5.2 — 发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>Windows GPU 导出</strong>：新增 Windows 平台零拷贝 GPU 硬件加速导出，大幅提升 Windows 端视频导出性能</li>\n<li><strong>色彩揭晓创意</strong>：新增 Color Reveal 创意模板，支持颜色渐变揭晓动画效果</li>\n<li><strong>HSL 自定义调色</strong>：新增 HSL 色彩面板，支持 Hue/Saturation/Lightness 精细调节</li>\n<li><strong>Insta360 相机媒体删除</strong>：新增 Insta360 相机素材本地删除功能，支持设备端文件清理</li>\n<li><strong>热更新发布平台</strong>：新增统一的热更新发布通道，支持增量修复快速推送</li>\n<li><strong>GPU 渲染预热</strong>：页面加载后自动预热渲染核心，减少首次操作延迟</li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复 Windows Vulkan 驱动崩溃</strong>：避免在部分 Windows 显卡驱动下 Vulkan 初始化导致的崩溃问题</li>\n<li><strong>修复预览崩溃诊断</strong>：增强预览崩溃的日志采集和诊断能力</li>\n<li><strong>消除非 Windows 平台警告</strong>：静默非 Windows 平台下渲染核心加载的冗余警告</li>\n</ul>\n<h3>UI 变化</h3>\n<ul>\n<li><strong>HSL 调色面板</strong>：新增 HSL 面板界面，集成到调色工作流中</li>\n<li><strong>创意工厂样式优化</strong>：调整创意模板创建流程的交互样式</li>\n<li><strong>代码风格规则优化</strong>：统一渲染核心代码风格</li>\n</ul>\n<h3>其他</h3>\n<ul>\n<li>更新官网下载链接至 v1.5.2</li>\n<li>新增 Windows GPU 导出测试指南</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.5.1",
    "title": "v1.5.1",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复部分 macOS 无法连接相机的问题</strong>：macOS 构建改为使用 Ad Hoc 签名，并在 CI 中增加签名校验，提升连接相机 Wi-Fi 热点时访问本地网络的兼容性。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>macOS 发布包增加本地网络访问说明</strong>：保留相机连接所需的网络权限配置。</li>\n<li><strong>热更新包体积优化</strong>：内置字体和 LUT 由正式安装包提供，避免重复打入热更新包。</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.5.0-hot.3",
    "title": "v1.5.0-hot.3 — 热更新发布说明",
    "bodyHtml": "<h3>改进</h3>\n<ul>\n<li><strong>缩小热更新包体积</strong>：热更新不再重复包含安装包已经提供的内置字体和 LUT 资源，包体积从约 110 MB 降至约 1.7 MB。</li>\n<li><strong>保持资源加载方式不变</strong>：内置字体、LUT 仍由已安装应用提供，用户导入的 LUT 不受影响。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.5.0-hot.2",
    "title": "v1.5.0-hot.2 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>调整设备连接检测顺序</strong>：优先建立 6666 控制通道，再进行后续服务确认，避免相机服务启动顺序造成误判。</li>\n<li><strong>相机 HTTP 请求改为直连</strong>：访问相机局域网文件服务时不经过系统 HTTP 代理，减少 VPN、代理配置对相机连接的影响。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>改进网络诊断结果</strong>：控制通道未建立时不再并行探测依赖它的 HTTP 服务。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.5.0-hot.1",
    "title": "v1.5.0-hot.1 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>增强 Mac 本地网络连接诊断</strong>：设备连接失败时可以在连接页面一键检测网络状态。</li>\n<li><strong>支持对比不同连接方式</strong>：同时记录系统默认路由和绑定本地地址的连接结果，帮助定位部分 Mac 无法连接相机的问题。</li>\n<li><strong>支持当前设备地址诊断</strong>：诊断不再固定使用 Luna 默认地址。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>自动复制诊断反馈</strong>：检测完成后自动复制诊断信息，用户可直接粘贴发送给开发者。</li>\n<li><strong>复制失败时提供提示</strong>：系统无法自动复制时，可手动点击复制反馈信息。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.5.0",
    "title": "v1.5.0 — 发布说明",
    "bodyHtml": "<h3>新功能</h3>\n<ul>\n<li><strong>工作台全新架构</strong>：基于 WGPU 的 Luna Render Core 渲染引擎重构，支持 GPU 硬件加速渲染和预览</li>\n<li><strong>GPU 硬件导出加速</strong>：</li>\n</ul>\n<p>\n  - macOS: Apple Metal 硬件导出支持（零拷贝 GPU 渲染导出）\n<br>\n  - Windows: Media Foundation + D3D12 硬件导出\n</p>\n<ul>\n<li><strong>边框（Border）编辑功能</strong>：支持自定义边框样式、颜色、大小</li>\n<li><strong>水印（Watermark）功能升级</strong>：全新水印设置面板，支持文字水印、图片水印、位置调整</li>\n<li><strong>色彩预设面板</strong>（Color Preset）：快速应用预设色彩方案</li>\n<li><strong>LUT 滤镜系统</strong>：</li>\n</ul>\n<p>\n  - 内置 LUT 滤镜库\n<br>\n  - 支持导入自定义 LUT（.cube）\n<br>\n  - HSL 色彩调整支持\n<br>\n  - LUT 导出兼容\n</p>\n<ul>\n<li><strong>直播图/实况照片导出</strong>（Live Photo）：支持导出 iOS Live Photo 格式</li>\n<li><strong>三连拼图</strong>（Triple Stitch）：创意多图拼接功能</li>\n<li><strong>视频裁剪与截取</strong>（Video Trim）：支持裁剪视频起止点，智能缓存</li>\n<li><strong>导出任务面板</strong>：全新导出对话框，后台导出任务管理，支持批量导出</li>\n<li><strong>热更新系统</strong>：增量更新支持，快速修复推送</li>\n<li><strong>图片预览增强</strong>：缩略图缓存、渐进式加载</li>\n<li><strong>全局滚动条美化</strong></li>\n</ul>\n<h3>Bug 修复</h3>\n<ul>\n<li>修复裁剪旋转一系列问题</li>\n<li>修复 Windows 工作台导出 LUT 路径反斜杠被 ffmpeg 当转义字符导致路径丢失</li>\n<li>修复 Windows LUT filter path 转义问题</li>\n<li>修复连接失败诊断信息展示 &amp; Wi-Fi 调试状态检测</li>\n<li>修复 GPU 渲染空帧和纹理丢失问题</li>\n<li>修复水印渲染大小和位置错误</li>\n<li>修复导出预览逻辑和下载逻辑</li>\n<li>修复大图导出失败问题</li>\n<li>修复视频首帧黑屏问题</li>\n<li>修复 Windows 构建和图标问题</li>\n<li>修复实况照片渲染和播放问题</li>\n</ul>\n<h3>UI 变化</h3>\n<ul>\n<li>工作台（Workspace）页面 UI 重构</li>\n<li>工具栏和操作按钮样式更新</li>\n<li>新导入对话框和模态框设计</li>\n<li>三连拼图/创意布局 UI</li>\n<li>色彩预设和滤镜面板样式优化</li>\n<li>导出对话框全新设计</li>\n</ul>\n<h3>其他</h3>\n<ul>\n<li>Rust 原生模块集成加速</li>\n<li>网络诊断信息及连接超时诊断收集</li>\n<li>热更新构建流程改进</li>\n<li>大量代码清理和重构</li>\n<li>隐藏调试功能入口</li>\n</ul>",
    "isHotfix": false
  },
  {
    "version": "1.4.0-hot.12",
    "title": "v1.4.0-hot.12 — 热更新发布说明",
    "bodyHtml": "<h3>改进</h3>\n<ul>\n<li><strong>添加网络诊断信息</strong>：连接超时或失败时，自动采集全面的网络诊断数据（ping、路由、端口探测、子网匹配等），展示在连接页诊断面板中，方便排查连接问题</li>\n<li><strong>优化连接超时体验</strong>：<code>enrichConnectionStatus</code> 降级为完整的网络诊断收集，失败时回退到基础 Wi-Fi 状态检测</li>\n<li><strong>控制会话绑定地址日志</strong>：<code>resolveLocalAddress</code> 结果写入主进程 debug 日志，便于追踪多网卡场景下的路由绑定情况</li>\n<li><strong>减少无谓重试</strong>：Luna Ultra 控制会话建立重试次数从 6 次降至 3 次，加快连接失败时的反馈速度</li>\n</ul>\n<h3>技术变更</h3>\n<ul>\n<li>新增 <code>electron/networkDiagnostics.ts</code>：主进程网络诊断服务</li>\n<li>新增 <code>src/shared/types/networkDiagnostics.ts</code>：诊断结果类型定义</li>\n<li>新增 IPC 通道 <code>luna:collectNetworkDiagnostics</code>，暴露 <code>window.luna.collectNetworkDiagnostics()</code></li>\n<li>新增 <code>network.resolvedLocalAddress</code> 字段：通过子网掩码匹配目标主机，显示实际绑定的本地地址（与 <code>connectSocket</code> 逻辑一致）</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.4.0-hot.11",
    "title": "v1.4.0-hot.11 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>修复连接 PO 逻辑</strong>：重构连接协议（Connect PO）逻辑，优化设备连接流程稳定性</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>Mock Server 增强</strong>：新增 HTTP Auth 网关鉴权支持，提升本地调试体验</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.4.0-hot.10",
    "title": "v1.4.0-hot.10 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>多网卡路由问题</strong>：修复 macOS 上同时连接普通 Wi-Fi 和 Luna 相机网络时，TCP 连接被 macOS Service Order 错误路由到主网卡导致连接超时的问题。现在自动检测本机与目标在同一子网的 IP 地址，强制 socket 绑定到正确网卡（<code>localAddress</code> 绑定）</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li>无</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.4.0-hot.9",
    "title": "v1.4.0-hot.9 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>连接失败诊断信息展示</strong>：连接失败时自动采集系统网卡信息，展示诊断面板并支持一键复制，方便排查连接问题</li>\n<li><strong>Windows Wi-Fi 调试接口注册条件</strong>：修复 <code>wifiDebug:getStatus</code> 被错误包含在 Windows 平台条件判断内的问题，确保各平台均可获取系统网络状态</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>Wi-Fi 调试状态检测重构</strong>：从依赖 <code>airport</code>/<code>netsh wlan show interfaces</code> 改为通用跨平台实现，基于 <code>os.networkInterfaces()</code> 直接采集系统网卡信息，提升兼容性和稳定性</li>\n<li><strong>精简日志输出</strong>：移除缩略图生成、文件缓存等流程中的冗余 debug/info 日志，减少日志文件冗余</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.4.0-hot.8",
    "title": "v1.4.0-hot.8 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>水印大小不一致</strong>：修复 <code>watermarkService.ts</code>、<code>MediaPreviewPanel.tsx</code>、<code>PreviewStage.tsx</code> 三处遗漏的 <code>Math.min(..., wmInfo.width)</code> 水印宽度上限限制，导出和预览的水印不再被 PNG 原图宽度卡住</li>\n<li><strong>超大图导出编码失败</strong>：检测源图尺寸，任一维 &gt; 12000 时自动使用 <code>-pix_fmt yuvj420p -threads 1</code> 避免 mjpeg 编码器初始化失败</li>\n<li><strong>移除工具栏遗留导出报错</strong>：导出错误已统一在导出弹窗展示，移除工具栏中旧的 <code>exportError</code> 横幅</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>导出错误详情弹窗</strong>：导出弹窗中失败项可直接点击查看完整错误日志，支持一键复制，复制后 toast 提示</li>\n<li><strong>任务级错误入口</strong>：导出任务行增加感叹号按钮，可查看该任务所有失败文件的完整错误汇总</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.4.0-hot.7",
    "title": "v1.4.0-hot.7 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>Windows 工作台调色导出失败</strong>：修复 FFmpeg <code>lut3d</code> 滤镜读取 LUT 文件时，Windows 盘符路径中的冒号被误解析为滤镜参数分隔符，导致导出失败的问题。现在会统一把 LUT 路径转换为 FFmpeg 可识别的安全格式。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>导出诊断日志增强</strong>：新增 LUT 文件状态、传入管线前路径、filter 路径转换结果等日志，便于定位 Windows 环境下的导出路径问题。</li>\n</ul>",
    "isHotfix": true
  },
  {
    "version": "1.4.0-hot.6",
    "title": "v1.4.0-hot.6 — 热更新发布说明",
    "bodyHtml": "<h3>Bug 修复</h3>\n<ul>\n<li><strong>Windows 工作台导出 LUT 路径裸盘符错误</strong>：当导出目录设为裸盘符（如 <code>E:</code>）时，<code>path.join</code> 不自动添加目录分隔符，导致 <code>E:.lut_xxx.cube</code> 传入 ffmpeg 后冒号被误当作选项分隔符解析失败。现改为使用系统临时目录存放 LUT 文件，避免依赖导出目录的路径格式。</li>\n</ul>\n<ul>\n<li><strong>色调（Tint）参数方向错误</strong>：正 tint 值应使画面偏红/品红，负 tint 值应使画面偏绿，此前公式符号写反，导致预览和导出效果相反。已修正 LUT 生成器和 direct 回退模式中的 tint 计算公式。</li>\n</ul>\n<h3>改进</h3>\n<ul>\n<li><strong>ffmpeg filter 路径可靠性</strong>：在 <code>pipelineCompiler.ts</code> 中增加裸盘符路径防御性处理（<code>E:.lut_</code> → <code>E:/.lut_</code>），防止类似问题再次出现。</li>\n</ul>",
    "isHotfix": true
  },
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
