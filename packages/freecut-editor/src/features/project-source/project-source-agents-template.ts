import legacyTemplate from './project-source-agents-template.legacy.md?raw'
import template from './project-source-agents-template.md?raw'

export const PROJECT_SOURCE_AGENTS_TEMPLATE = template

export function isLegacyProjectSourceAgentsTemplate(content: string): boolean {
  return content === legacyTemplate
}
