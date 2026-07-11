import { ipcMain } from 'electron'
import type { AiConfig } from '../src/shared/types'
import { chatCompletion } from './aiService'

export function register(): void {
  ipcMain.handle('ai:chat', async (_event, config: AiConfig, systemPrompt: string, messages: Array<{ role: string; content: string }>) => {
    return chatCompletion(config, systemPrompt, messages as Array<{ role: 'user' | 'assistant'; content: string }>)
  })
}
