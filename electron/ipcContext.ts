import type { BrowserWindow } from 'electron'
import type { GoUltraClient } from './goUltraProtocol'
import type { LunaClient } from './lunaProtocol'
import type { GoUltraProtocol, LunaUltraProtocol } from './deviceProtocols'

export interface IpcContext {
  win: BrowserWindow | null
  clients: Map<string, LunaClient>
  goUltraClients: Map<string, GoUltraClient>
  activeDownloadControllers: Set<AbortController>
  activeExportControllers: Map<string, AbortController>
  previewCacheTasks: Map<string, Promise<boolean>>
  videoFrameRateTasks: Map<string, Promise<number | null>>
  lunaProtocol: () => LunaUltraProtocol
  goUltraProtocol: () => GoUltraProtocol
}
