import { ipcRenderer } from 'electron'
import type { AiEditorFileApi } from '../src/shared/types'

export const aiEditorApi: AiEditorFileApi = {
    openWindow: (assets = []) => ipcRenderer.invoke('ai-editor:open-window', assets),
    project: {
      list: () => ipcRenderer.invoke('ai-editor:list-projects'),
      create: (name, assets) => ipcRenderer.invoke('ai-editor:create-project', name, assets),
      load: (projectId) => ipcRenderer.invoke('ai-editor:load-project', projectId),
      save: (projectId, editorDocument) => ipcRenderer.invoke('ai-editor:save-project', projectId, editorDocument),
      delete: (projectId) => ipcRenderer.invoke('ai-editor:delete-project', projectId),
      rename: (projectId, name) => ipcRenderer.invoke('ai-editor:rename-project', projectId, name),
    },
    mcp: {
      getLauncherPath: () => ipcRenderer.invoke('ai-editor:mcp-launcher-path'),
      getHttpConnection: () => ipcRenderer.invoke('ai-editor:mcp-http-connection'),
      onRequest: (callback) => {
        const listener = (_event: Electron.IpcRendererEvent, request: import('../src/shared/types').AiEditorMcpRequest): void => {
          Promise.resolve(callback(request)).then(
            (response) => ipcRenderer.send('ai-editor:mcp-response', request.callId, response),
            (error: unknown) => ipcRenderer.send('ai-editor:mcp-response', request.callId, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          )
        }
        ipcRenderer.on('ai-editor:mcp-request', listener)
        return () => ipcRenderer.off('ai-editor:mcp-request', listener)
      },
    },
    agent: {
      createRequest: (request, projectId) => ipcRenderer.invoke('ai-editor:agent-create-request', request, projectId ?? null),
      updateRequest: (sessionId, request) => ipcRenderer.invoke('ai-editor:agent-update-request', sessionId, request),
      cancelRequest: (sessionId) => ipcRenderer.invoke('ai-editor:agent-cancel-request', sessionId),
      confirmExport: (sessionId) => ipcRenderer.invoke('ai-editor:agent-confirm-export', sessionId),
      denyExport: (sessionId) => ipcRenderer.invoke('ai-editor:agent-deny-export', sessionId),
      getSnapshot: () => ipcRenderer.invoke('ai-editor:agent-snapshot'),
      onEvent: (callback) => {
        const listener = (_event: Electron.IpcRendererEvent, value: import('../src/shared/types').AiEditorAgentEvent): void => callback(value)
        ipcRenderer.on('ai-editor:agent-event', listener)
        return () => ipcRenderer.off('ai-editor:agent-event', listener)
      },
      onActivate: (callback) => {
        const listener = (): void => callback()
        ipcRenderer.on('ai-editor:agent-activate', listener)
        return () => ipcRenderer.off('ai-editor:agent-activate', listener)
      },
    },
    listLocalMedia: (query) => ipcRenderer.invoke('ai-editor:list-local-media', query),
    getLocalMedia: (mediaId) => ipcRenderer.invoke('ai-editor:get-local-media', mediaId),
    getLocalMediaMetadata: (mediaIds) => ipcRenderer.invoke('ai-editor:get-local-media-metadata', mediaIds),
    readLocalMediaBytes: (mediaId) => ipcRenderer.invoke('ai-editor:read-local-media-bytes', mediaId),
    inspectLocalMedia: (mediaIds, options) => ipcRenderer.invoke('ai-editor:inspect-local-media', mediaIds, options),
    createMediaContactSheet: (mediaIds, options) => ipcRenderer.invoke('ai-editor:create-media-contact-sheet', mediaIds, options),
    transcribeLocalMedia: (mediaId, options) => ipcRenderer.invoke('ai-editor:transcribe-local-media', mediaId, options),
    transcribeAudioSamples: (samples, options) => ipcRenderer.invoke('ai-editor:transcribe-audio-samples', samples, options),
    showSaveDialog: (options) => ipcRenderer.invoke('ai-editor:show-save-dialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('ai-editor:show-open-dialog', options),
    readFile: (filePath) => ipcRenderer.invoke('ai-editor:read-file', filePath),
    readFileBytes: (filePath) => ipcRenderer.invoke('ai-editor:read-file-bytes', filePath),
    tempFilePath: (extension) => ipcRenderer.invoke('ai-editor:temp-file-path', extension),
    writeFile: (filePath, data) => ipcRenderer.invoke('ai-editor:write-file', filePath, data),
    openWrite: (filePath) => ipcRenderer.invoke('ai-editor:open-write', filePath),
    writeChunk: (handleId, data, position) => ipcRenderer.invoke('ai-editor:write-chunk', handleId, data, position),
    closeWrite: (handleId) => ipcRenderer.invoke('ai-editor:close-write', handleId),
    abortWrite: (handleId) => ipcRenderer.invoke('ai-editor:abort-write', handleId),
    revealInFolder: (filePath) => ipcRenderer.invoke('ai-editor:reveal-in-folder', filePath),
}
