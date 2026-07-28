export const PIXEL_FLOW_SETTINGS_VERSION = 7
export const DEFAULT_PIXEL_FLOW_DURATION = 1.8
export const DEFAULT_PIXEL_FLOW_SIZE = 6
export const DEFAULT_PIXEL_FLOW_WIDTH = 5
export const DEFAULT_PIXEL_FLOW_SEMANTIC_DELAY = 8
export const DEFAULT_PIXEL_FLOW_BLOOM = 50
export const DEFAULT_PIXEL_FLOW_FILTER = 50
export const DEFAULT_PIXEL_FLOW_COLOR_TRANSITION = 0.5
export const DEFAULT_PIXEL_FLOW_SKY_MODE = 'ripple'
export const DEFAULT_PIXEL_FLOW_OTHER_DIRECTION = 'top-down'
export const DEFAULT_PIXEL_FLOW_MODE = 'whole-frame'
export const DEFAULT_PIXEL_FLOW_TRAJECTORY = 'highlight-flow'

export const PIXEL_FLOW_MODE_OPTIONS = [
  { value: 'segmented', label: '智能分层' },
  { value: 'whole-frame', label: '整体流动' },
]

export const PIXEL_FLOW_TRAJECTORY_OPTIONS = [
  { value: 'highlight-flow', label: '高光漫流' },
  { value: 'cascade', label: '层叠下坠' },
  { value: 'diagonal', label: '斜向穿行' },
  { value: 'split', label: '中心分流' },
]

export const PIXEL_FLOW_SKY_MODE_OPTIONS = [
  { value: 'ripple', label: '水波' },
  { value: 'sweep', label: '横扫' },
  { value: 'full', label: '全亮' },
]

export const PIXEL_FLOW_OTHER_DIRECTION_OPTIONS = [
  { value: 'top-down', label: '上到下' },
  { value: 'outside-in', label: '外到内' },
  { value: 'inside-out', label: '内到外' },
]
