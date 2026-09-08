(() => {
  'use strict'

  const translations = {
    'Open Reel Video': 'OpenReel 视频',
    'Video Editor': '视频编辑',
    'Motion Design': '动效设计',
    'Editor workspaces': '编辑工作区',
    'Editor tools': '编辑工具',
    'Back to home': '返回首页',
    'Search tools, effects, or ask AI': '搜索工具、效果，或询问 AI',
    Undo: '撤销',
    Redo: '重做',
    'Create Motion Scene': '创建动效场景',
    'Action history': '操作记录',
    'Keyframe editor': '关键帧编辑器',
    'Audio mixer': '音频混音器',
    'AI Editor chat': 'AI 剪辑助手',
    'Project JSON / Comments': '项目数据 / 备注',
    'More editor actions': '更多编辑操作',
    'Settings & API keys': '设置与 API 密钥',
    'Screen recorder': '屏幕录制',
    'Editor tour': '编辑器导览',
    'Animation & effects tour': '动画与效果导览',
    'Help & shortcuts (press ?)': '帮助与快捷键（按 ?）',
    'Project JSON': '项目数据',
    'Cmd+K to search': '按 Cmd+K 搜索',
    System: '跟随系统',
    Light: '浅色',
    Dark: '深色',
    'Theme: System. Switch to Light': '主题：跟随系统。切换为浅色',
    'Theme: Light. Switch to Dark': '主题：浅色。切换为深色',
    'Theme: Dark. Switch to System': '主题：深色。切换为跟随系统',

    Media: '素材',
    Text: '文字',
    Graphics: '图形',
    Effects: '效果',
    Transitions: '转场',
    'AI Generate': 'AI 生成',
    Recipes: '配方',
    'Project Templates': '项目模板',
    'Import footage, audio, and stills.': '导入视频、音频和图片素材。',
    'Add title presets and caption elements.': '添加标题预设和字幕元素。',
    'Create shapes, arrows, and SVG overlays.': '创建形状、箭头和图形叠加层。',
    'Drag effects onto a clip to apply them.': '将效果拖到片段上即可应用。',
    'Drag transitions onto a clip\'s edge.': '将转场拖到片段边缘即可应用。',
    'Generate clips, captions, and assisted edits.': '生成片段、字幕并使用智能剪辑。',
    'Apply clip-scoped looks, overlays, and text stacks.': '应用片段效果、叠加层和文字组合。',
    'Load full-project starter layouts and presets.': '加载完整项目布局和预设。',
    'Import Media': '导入素材',
    'Import media': '导入素材',
    'No media imported': '尚未导入素材',
    'Drag files here or click to import': '将文件拖到这里，或点击导入',
    'Drop media here': '将素材拖到这里',
    'Import media to get started': '导入素材以开始编辑',
    'Add to timeline': '添加到时间线',
    'Replace asset': '替换素材',
    'Relink from folder': '从文件夹重新关联',
    'Show missing only': '仅显示缺失素材',
    'Sort media': '排序素材',
    'Large thumbnails': '大缩略图',
    'Small thumbnails': '小缩略图',
    'List view': '列表视图',
    'Search media': '搜索素材',
    'Search effects': '搜索效果',
    'Search transitions': '搜索转场',
    'Search recipes': '搜索配方',
    'Search templates': '搜索模板',
    'Search tracks': '搜索轨道',
    'Search track layers': '搜索轨道层',

    'Initializing editor…': '正在初始化编辑器…',
    'Loading editor...': '正在加载编辑器...',
    'Loading editor…': '正在加载编辑器…',
    Loading: '加载中',
    'Loading...': '加载中...',
    'Loading…': '加载中…',
    'Saving...': '保存中...',
    'Saving…': '保存中…',
    'Saved!': '已保存',
    Save: '保存',
    Close: '关闭',
    Cancel: '取消',
    Apply: '应用',
    Reset: '重置',
    Delete: '删除',
    Duplicate: '复制',
    Rename: '重命名',
    Select: '选择',
    All: '全部',
    None: '无',
    'No clip selected': '未选择片段',
    'No compatible cut': '没有可用的剪辑切点',
    'Player': '播放器',
    'Live preview': '实时预览',
    'Preview canvas': '预览画布',
    'Composition grid': '构图网格',
    'Title and action safe margins': '标题与动作安全区',
    'Aspect ratio': '画面比例',
    'Playback quality': '播放质量',
    'Preview Zoom': '预览缩放',
    'Canvas snapping': '画布吸附',
    'Skip back 5s': '后退 5 秒',
    'Skip forward 5s': '前进 5 秒',

    Timeline: '时间线',
    Inspector: '检查器',
    'Track layers': '轨道层',
    'Manage track layers': '管理轨道层',
    'Track layer types': '轨道层类型',
    'Add track': '添加轨道',
    'Timeline zoom': '时间线缩放',
    'Zoom out': '缩小',
    'Zoom in': '放大',
    'Large tracks': '大轨道',
    'Compact tracks': '紧凑轨道',
    'Snap on (N)': '吸附已开启（N）',
    'Snap off (N)': '吸附已关闭（N）',
    Split: '分割',
    'Trim start to playhead': '裁剪到播放头起点',
    'Trim end to playhead': '裁剪到播放头终点',
    'Ripple delete': '波纹删除',
    'Separate Audio': '分离音频',
    'Copy Effects': '复制效果',
    'Paste Effects': '粘贴效果',
    'Close Gap to Previous': '关闭与上一片段的间隙',
    'Video Clip': '视频片段',
    'Audio Clip': '音频片段',
    'Image Clip': '图片片段',
    Hide: '隐藏',
    Mute: '静音',
    Solo: '独奏',
    'Move up': '上移',
    'Move down': '下移',

    Position: '位置',
    Scale: '缩放',
    Rotation: '旋转',
    Opacity: '不透明度',
    Volume: '音量',
    Color: '颜色',
    Audio: '音频',
    Video: '视频',
    'Video Effects': '视频效果',
    Crop: '裁剪',
    'Reset Crop': '重置裁剪',
    Transform: '变换',
    Blending: '混合',
    Alignment: '对齐',
    Keyframes: '关键帧',
    'Auto Captions': '自动字幕',
    Captions: '字幕',
    'Caption language': '字幕语言',
    'Color grading': '调色',
    Filters: '滤镜',
    'Background removal': '背景移除',
    'Green screen': '绿幕',
    Masks: '蒙版',
    'Motion tracking': '运动跟踪',
    'Noise reduction': '降噪',
    'Audio effects': '音频效果',
    'No effects applied': '未应用效果',
    'Add effect': '添加效果',

    'Project name': '项目名称',
    'Project Name': '项目名称',
    'New Project': '新建项目',
    'Save project name': '保存项目名称',
    'Rename project': '重命名项目',
    Export: '导出',
    'Export options': '导出选项',
    'Export Video': '导出视频',
    'Choose a ready-made preset or fine-tune every setting.': '选择预设，或自定义每一项设置。',
    'Quick Export': '快速导出',
    'For Your Video': '适合当前视频',
    'Custom export...': '自定义导出...',
    'Compress video...': '压缩视频...',
    'Full settings with AI upscaling': '完整设置，支持 AI 超分辨率',
    'Shrink any video to a target size': '将视频压缩到目标大小',
    'Best match': '最佳匹配',
    Format: '格式',
    Codec: '编码器',
    Resolution: '分辨率',
    'Frame rate': '帧率',
    'Bitrate (kbps)': '码率（kbps）',
    Quality: '质量',
    'Audio format': '音频格式',
    'Sample rate': '采样率',
    'Audio bitrate': '音频码率',
    Sharpening: '锐化',
    'Export as H.264 anyway': '仍以 H.264 导出',
    'Audio Only (WAV)': '仅导出音频（WAV）',
    'Uncompressed audio': '未压缩音频',

    Settings: '设置',
    'Configure preferences and manage API keys for external services.': '配置偏好设置并管理外部服务的 API 密钥。',
    General: '常规',
    'API Keys': 'API 密钥',
    Width: '宽度',
    Height: '高度',
    'Editing frame rate': '编辑帧率',
    'No background fill': '不填充背景',
    'Blur background fill': '模糊填充背景',
    'Auto-save interval': '自动保存间隔',
    'Text to Speech provider': '文字转语音服务',
    'AI Assistant API format': 'AI 助手接口格式',
    'Base URL': '服务地址',
    'Model ID': '模型 ID',
    'AI Aggregator provider': 'AI 聚合服务',
    'Save Key': '保存密钥',
    'Delete key': '删除密钥',
    Unlock: '解锁',
    Lock: '锁定',
    'Change Password': '修改密码',
    'Set Up Master Password': '设置主密码',
    'Current Password': '当前密码',
    'Confirm New Password': '确认新密码',

    'AI edit request': 'AI 剪辑请求',
    'Ask the AI to edit your video…': '告诉 AI 如何编辑视频…',
    Send: '发送',
    Stop: '停止',
    'Saved on this device for this project': '已保存在本设备的当前项目中',
    'Describe an edit in plain language and the AI will perform it on your timeline.': '用自然语言描述剪辑需求，AI 会直接在时间线上执行。',
    'Open or create a project, then describe edits in plain language.': '打开或创建项目，然后用自然语言描述剪辑需求。',
    'Open settings': '打开设置',

    Templates: '模板',
    'Browse templates': '浏览模板',
    'Recent projects': '最近项目',
    'Open editor': '打开编辑器',
    'Skip on startup': '启动时跳过',
    'Select Format': '选择格式',
    'Create Project': '创建项目',
    'Creating...': '创建中...',
    'Search templates...': '搜索模板...',
    'No Recent Projects': '暂无最近项目',
    'Loading recent projects...': '正在加载最近项目...',
    'Your recently opened projects will appear here. Start a new project or use a template to get started.': '最近打开的项目会显示在这里。创建新项目或使用模板开始编辑。',
    'Recent projects are stored locally in your browser': '最近项目保存在本地',
    'Remove from recent': '从最近项目中移除',
    'Recover Your Work': '恢复编辑内容',
    'We found an unsaved project': '发现未保存的项目',
    'Clear all saved projects': '清除所有已保存项目',
    'Start Fresh': '重新开始',
    'Recover Project': '恢复项目',
    'Recovering...': '恢复中...',
    'Use Template': '使用模板',
    'Save as Template': '另存为模板',
    'Template Name': '模板名称',
    Description: '描述',
    Category: '分类',
    'Author Name': '作者名称',
    Cloud: '云端',
    Local: '本地',

    'Match Video Dimensions?': '匹配视频尺寸？',
    "The video you're adding has different dimensions than your current project settings.": '要添加的视频尺寸与当前项目设置不同。',
    'Keep Current': '保持当前设置',
    'Match Video': '匹配视频尺寸',
    'Keyboard Shortcuts': '键盘快捷键',
    'Search shortcuts': '搜索快捷键',
    'Reset All': '全部重置',
    'No shortcuts found': '未找到快捷键',
    'Screen Recording': '屏幕录制',
    'System Audio': '系统音频',
    Microphone: '麦克风',
    'Frame Rate': '帧率',
    'Webcam Resolution': '摄像头分辨率',
    'Skip tour': '跳过导览',
    'Overall progress': '总体进度',
    'Copy URL': '复制地址',
    'Copy token': '复制令牌',
    'Rotate token': '轮换令牌',
    'Copy config': '复制配置',
    'Folder picker not supported': '不支持选择文件夹',
    'No matches found': '未找到匹配项',
    'Import failed': '导入失败',
    'Recording failed': '录制失败',
    'Export failed': '导出失败',
    'Effect applied': '效果已应用',
    'Transition applied': '转场已应用',
  }

  const patterns = [
    [/^Recent Projects \((\d+)\)$/, '最近项目 ($1)'],
    [/^Recent projects \((\d+)\)$/, '最近项目 ($1)'],
    [/^Open (.+)$/, '打开 $1'],
    [/^Remove (.+)$/, '移除 $1'],
    [/^Delete (.+)$/, '删除 $1'],
    [/^Rename (.+)$/, '重命名 $1'],
    [/^Duplicate (.+)$/, '复制 $1'],
    [/^Hide (.+)$/, '隐藏 $1'],
    [/^Mute (.+)$/, '静音 $1'],
    [/^Solo (.+)$/, '独奏 $1'],
    [/^Lock (.+)$/, '锁定 $1'],
    [/^Move (.+) up$/, '将 $1 上移'],
    [/^Move (.+) down$/, '将 $1 下移'],
    [/^Delete selected clips$/, '删除选中的片段'],
    [/^Undo \((.+)\)$/, '撤销 ($1)'],
    [/^Redo \((.+)\)$/, '重做 ($1)'],
    [/^Split \((.+)\)$/, '分割 ($1)'],
    [/^Delete \((.+)\)$/, '删除 ($1)'],
    [/^Duplicate \((.+)\)$/, '复制 ($1)'],
    [/^Ripple delete \((.+)\)$/, '波纹删除 ($1)'],
    [/^Trim start to playhead \((.+)\)$/, '裁剪到播放头起点 ($1)'],
    [/^Trim end to playhead \((.+)\)$/, '裁剪到播放头终点 ($1)'],
    [/^Est\. (.+)$/, '预计 $1'],
    [/^Importing (.+) \((\d+)\/(\d+)\)\.\.\.$/, '正在导入 $1 ($2/$3)...'],
    [/^Extracting audio from (.+)\.\.\.$/, '正在从 $1 提取音频...'],
    [/^Replacing asset\.\.\.$/, '正在替换素材...'],
    [/^Relinking (.+)…$/, '正在重新关联 $1…'],
    [/^(\d+) recording(s?) imported!$/, '已导入 $1 个录制文件'],
    [/^(\d+) older (save|saves) available$/, '有 $1 个更早的保存版本可用'],
    [/^Last saved (.+)$/, '上次保存于 $1'],
    [/^(\d+) editable$/, '$1 个可编辑项'],
  ]

  const exactTranslate = (value) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed) return null
    const direct = translations[trimmed]
    if (direct) return value.replace(trimmed, direct)
    for (const [pattern, replacement] of patterns) {
      const match = trimmed.match(pattern)
      if (match) {
        return value.replace(trimmed, trimmed.replace(pattern, replacement))
      }
    }
    return null
  }

  const shouldSkipElement = (element) => {
    const tagName = element.tagName.toLowerCase()
    return tagName === 'script' || tagName === 'style' || tagName === 'code' ||
      tagName === 'input' || tagName === 'textarea' || tagName === 'select' ||
      element.isContentEditable
  }

  const translateElement = (element) => {
    for (const attribute of ['aria-label', 'title', 'placeholder']) {
      const current = element.getAttribute(attribute)
      const translated = exactTranslate(current)
      if (translated && translated !== current) element.setAttribute(attribute, translated)
    }

    if (shouldSkipElement(element)) return

    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const translated = exactTranslate(child.nodeValue)
        if (translated && translated !== child.nodeValue) child.nodeValue = translated
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        translateElement(child)
      }
    }
  }

  const translateNode = (node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      translateElement(node)
    } else if (node.nodeType === Node.TEXT_NODE && node.parentElement && !shouldSkipElement(node.parentElement)) {
      const translated = exactTranslate(node.nodeValue)
      if (translated && translated !== node.nodeValue) node.nodeValue = translated
    }
  }

  const start = () => {
    document.documentElement.lang = 'zh-CN'
    document.title = 'Luna AI 剪辑'
    translateElement(document.documentElement)

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target.nodeType === Node.ELEMENT_NODE) {
          translateElement(record.target)
          continue
        }
        for (const node of record.addedNodes) translateNode(node)
        if (record.type === 'characterData') translateNode(record.target)
      }
    })
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'title', 'placeholder'],
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
})()
