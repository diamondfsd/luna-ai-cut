import type { BrowserWindow } from 'electron'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { GoUltraClient } from '../devices/go-ultra/protocol'
import type { LunaClient } from '../devices/insta360/lunaProtocol'
import type { GoUltraProtocol, LunaUltraProtocol } from '../devices/common/deviceProtocols'
import type { LunaFile } from '../../src/shared/types'

export interface IpcContext {
  win: BrowserWindow | null
  clients: Map<string, LunaClient>
  lunaClientFor: (host?: string, controlPort?: number) => LunaClient
  lunaControlPortFor: (host: string) => number
  goUltraClients: Map<string, GoUltraClient>
  activeDownloadControllers: Set<AbortController>
  activeDownloadTasks: Set<Promise<unknown>>
  activeExportControllers: Map<string, AbortController>
  activeExportEncoders: Map<string, ChildProcessWithoutNullStreams>
  activeNativeExportTasks: Set<string>
  previewCacheTasks: Map<string, Promise<boolean>>
  videoFrameRateTasks: Map<string, Promise<number | null>>
  enqueuePreviewTask: <T>(run: () => Promise<T>, priority?: number) => Promise<T>
  ensureCameraSessionForFile: (file: LunaFile, url?: string, localPath?: string | null) => Promise<void>
  lunaProtocol: () => LunaUltraProtocol
  goUltraProtocol: () => GoUltraProtocol
}
