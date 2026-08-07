import { ipcMain } from 'electron'

import type { AiEditingAssistantConfigInput, AiEditingAssistantGenerateInput } from '../src/shared/types'
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
  ipcMain.handle('ai-editing-assistant:generate', (_event, input: AiEditingAssistantGenerateInput) =>
    generateAiEditingAssistantResponse(input),
  )
  ipcMain.handle('ai-editing-assistant:cancel', (_event, requestId: string) => {
    cancelAiEditingAssistantRequest(requestId)
  })
}
