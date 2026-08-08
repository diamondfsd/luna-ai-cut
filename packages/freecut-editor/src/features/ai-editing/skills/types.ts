export interface AiEditingSkill {
  id: string
  name: string
  description: string
  instructions: string
  triggers: string[]
  toolIds: string[]
  requiresFinishedVideo: boolean
  productionMode?: 'blueprint'
  source: 'built-in' | 'custom'
  enabled: boolean
}

export interface AiEditingCustomSkillInput {
  name: string
  description: string
  instructions: string
  triggers: string[]
}
