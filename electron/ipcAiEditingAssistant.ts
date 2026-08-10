import { ipcMain } from 'electron'

import type {
  AiEditingAssistantConfigInput,
  AiEditingAssistantGenerateInput,
  AiEditingAssistantRequestStatus,
} from '../src/shared/types'
import {
  cancelAiEditingAssistantRequest,
  generateAiEditingAssistantResponse,
  getAiEditingAssistantConfig,
  saveAiEditingAssistantConfig,
} from './aiEditingAssistantService'

export function register(): void {
  ipcMain.handle('ai-editing-assistant:get-config', () => getAiEditingAssistantConfig())
  ipcMain.handle('ai-editing-assistant:save-config', (_event, input: AiEditingAssistantConfigInput) =>
    saveAiEditingAssistantConfig(input),
  )
  ipcMain.handle('ai-editing-assistant:generate', (event, input: AiEditingAssistantGenerateInput) =>
    generateAiEditingAssistantResponse(input, (status: AiEditingAssistantRequestStatus) => {
      if (!event.sender.isDestroyed()) event.sender.send('ai-editing-assistant:status', status)
    }),
  )
  ipcMain.handle('ai-editing-assistant:cancel', (_event, requestId: string) => {
    cancelAiEditingAssistantRequest(requestId)
  })
}
