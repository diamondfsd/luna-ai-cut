import type { BrowserWindow } from 'electron'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { GoUltraClient } from './goUltraProtocol'
import type { LunaClient } from './lunaProtocol'
import type { GoUltraProtocol, LunaUltraProtocol } from './deviceProtocols'
import type { LunaFile } from '../src/shared/types'

export interface IpcContext {
  win: BrowserWindow | null
  clients: Map<string, LunaClient>
  goUltraClients: Map<string, GoUltraClient>
  activeDownloadControllers: Set<AbortController>
  activeExportControllers: Map<string, AbortController>
  activeExportEncoders: Map<string, ChildProcessWithoutNullStreams>
  previewCacheTasks: Map<string, Promise<boolean>>
  videoFrameRateTasks: Map<string, Promise<number | null>>
  enqueuePreviewTask: <T>(run: () => Promise<T>, priority?: number) => Promise<T>
  ensureCameraSessionForFile: (file: LunaFile, url?: string) => Promise<void>
  lunaProtocol: () => LunaUltraProtocol
  goUltraProtocol: () => GoUltraProtocol
}
