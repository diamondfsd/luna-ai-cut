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
  return `${text}\n\n用户明确引用的编辑资源：\n${resources}\n请优先围绕这些资源完成请求，并使用其中的真实 ID 调用工具。`
}
