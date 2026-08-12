import { getNativeWorkspacePath } from '@freecut/infrastructure/storage/native-file-system'
import {
  projectAiEditingConversationHistoryPath,
  projectAiEditingConversationPath,
  projectAiEditingRunsPath,
} from '@freecut/infrastructure/storage/workspace-fs/paths'

export interface AiEditingRecordPaths {
  conversation: string
  history: string
  runs: string
}

function resolveWorkspacePath(workspacePath: string | null, segments: string[]): string {
  const relativePath = segments.join('/')
  if (!workspacePath) return relativePath

  const separator = workspacePath.includes('\\') ? '\\' : '/'
  const root = workspacePath.replace(/[\\/]+$/, '')
  return `${root}${separator}${segments.join(separator)}`
}

export function getAiEditingRecordPaths(
  projectId: string,
  workspacePath: string | null,
): AiEditingRecordPaths {
  return {
    conversation: resolveWorkspacePath(workspacePath, projectAiEditingConversationPath(projectId)),
    history: resolveWorkspacePath(workspacePath, projectAiEditingConversationHistoryPath(projectId)),
    runs: resolveWorkspacePath(workspacePath, projectAiEditingRunsPath(projectId)),
  }
}

export async function resolveAiEditingRecordPaths(
  projectId: string,
): Promise<AiEditingRecordPaths> {
  return getAiEditingRecordPaths(projectId, await getNativeWorkspacePath())
}

export function formatAiEditingRecordPaths(paths: AiEditingRecordPaths): string {
  return `当前对话：${paths.conversation}`
}
