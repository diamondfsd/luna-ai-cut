import projectLayout from './project-layout.md?raw'
import documentationIndex from './index.md?raw'
import projectSourceSchema from '../../project-source/project-source-schema.ts?raw'
import type { VirtualFileInput } from '../coding-workspace/virtual-files'

const typeSources = import.meta.glob<string>('../../../types/*.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
})

function fileName(path: string): string {
  const name = path.split('/').pop()
  if (!name) throw new Error(`无法识别类型文档路径：${path}`)
  return name
}

export function getAiEditingDocumentationFiles(): VirtualFileInput[] {
  const generatedTypes = Object.entries(typeSources).map(([path, content]) => ({
    path: `docs/types/${fileName(path)}`,
    content,
  }))
  return [
    { path: 'docs/index.md', content: documentationIndex },
    { path: 'docs/project-layout.md', content: projectLayout },
    { path: 'docs/types/project-source-schema.ts', content: projectSourceSchema },
    ...generatedTypes,
  ].sort((left, right) => left.path.localeCompare(right.path))
}
