import resourceReferencesPrompt from './prompts/messages/resource-references.md?raw'
import { renderPrompt } from './prompts/render-prompt'

export type AiEditingResourceKind = 'project' | 'media' | 'timeline-clip'

export interface AiEditingResourceReference {
  kind: AiEditingResourceKind
  id: string
  label: string
}

const RESOURCE_KIND_LABELS: Record<AiEditingResourceKind, string> = {
  project: '项目',
  media: '素材',
  'timeline-clip': '时间轴片段',
}

export function describeAiEditingReference(reference: AiEditingResourceReference): string {
  return `${RESOURCE_KIND_LABELS[reference.kind]}“${reference.label}”（ID：${reference.id}）`
}

export function addAiEditingReferenceContext(
  text: string,
  references: readonly AiEditingResourceReference[],
): string {
  if (references.length === 0) return text
  const resources = references.map((reference) => `- ${describeAiEditingReference(reference)}`).join('\n')
  return renderPrompt(resourceReferencesPrompt, {
    USER_REQUEST: text,
    RESOURCES: resources,
  })
}
