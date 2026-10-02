import type { ExternalAgentDescriptor, ExternalAgentTaskRequest, ExternalAgentTaskResult } from '../../../src/shared/types/externalAgent'

/** Adapter methods run in the main process; renderer never supplies paths or launch commands. */
export interface ExternalAgentAdapter {
  descriptor: ExternalAgentDescriptor
  downloadUrl?: string
  isInstalled(): Promise<boolean>
  open?: () => Promise<void>
  installSkill?: () => Promise<void>
  startTask?: (request: ExternalAgentTaskRequest) => Promise<ExternalAgentTaskResult>
}
