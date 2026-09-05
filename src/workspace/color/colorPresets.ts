import type { EditPipeline } from '../shared/editPipeline'

export interface ColorPreset {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** 序列化的完整调色参数 JSON */
  colorJson: string
}

function getLuna(): typeof window.luna {
  if (typeof window === 'undefined') throw new Error('不在浏览器环境')
  return window.luna
}

/** 加载所有用户预设 */
export async function loadUserPresets(): Promise<ColorPreset[]> {
  try {
    return await getLuna().workspace.listColorPresets()
  } catch {
    return []
  }
}

/** 保存预设（同名覆盖） */
export async function saveUserPreset(name: string, color: EditPipeline['color']): Promise<ColorPreset> {
  const colorJson = JSON.stringify(color)
  return getLuna().workspace.saveColorPreset(name, colorJson)
}

/** 删除预设 */
export async function deleteUserPreset(id: string): Promise<void> {
  return getLuna().workspace.deleteColorPreset(id)
}

/** 重命名预设 */
export async function renameUserPreset(id: string, newName: string): Promise<void> {
  return getLuna().workspace.renameColorPreset(id, newName)
}

/** 将预设数据反序列化为完整 color 对象 */
export function deserializePresetColor(preset: ColorPreset): EditPipeline['color'] {
  try {
    return JSON.parse(preset.colorJson) as EditPipeline['color']
  } catch {
    // 解析失败返回空对象，后续由 onChange 合并默认值
    return {} as EditPipeline['color']
  }
}
