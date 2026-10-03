import type { DirectorLanShot, DirectorLanShotAttribute } from '../shared/types/directorLab.ts'

const fields = [
  { id: 'content', name: '画面内容', aliases: ['画面内容', '画面说明', '场景', '主体', '目标', '拍摄目标'] },
  { id: 'framing', name: '景别', aliases: ['景别'] },
  { id: 'movement', name: '运镜方式', aliases: ['运镜方式', '运镜说明', '拍摄方式', '运镜', '相机运动'] },
]

export function normalizeDirectorShotFields(shot: Pick<DirectorLanShot, 'id' | 'attributes' | 'remark' | 'visual_description' | 'movement_description'>) {
  const attributes: DirectorLanShotAttribute[] = []
  const extra: string[] = []
  for (const field of fields) {
    const candidates = shot.attributes.filter((attribute) =>
      attribute.id === `${shot.id}-attribute-${field.id}` || field.aliases.includes(attribute.name.trim()))
    const selected = candidates.find((attribute) => attribute.id === `${shot.id}-attribute-${field.id}`) ?? candidates[0]
    const description = selected?.description.trim()
      ?? (field.id === 'content' ? shot.visual_description?.trim() : field.id === 'movement' ? shot.movement_description?.trim() : '')
    if (description) attributes.push({ id: `${shot.id}-attribute-${field.id}`, name: field.name, description })
    for (const candidate of candidates) {
      if (candidate !== selected && candidate.description.trim() !== description) extra.push(`${candidate.name.trim()}：${candidate.description.trim()}`)
    }
  }
  for (const attribute of shot.attributes) {
    if (attribute.description.trim() && !fields.some((field) => field.aliases.includes(attribute.name.trim())
      || attribute.id === `${shot.id}-attribute-${field.id}`)) extra.push(`${attribute.name.trim()}：${attribute.description.trim()}`)
  }
  const remark = [shot.remark.trim(), ...extra.filter((value) => !shot.remark.includes(value))].filter(Boolean).join('\n')
  return { attributes, remark }
}
