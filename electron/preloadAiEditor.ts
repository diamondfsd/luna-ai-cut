import { ipcRenderer } from 'electron'
import type { AiEditorFileApi } from '../src/shared/types'

export const aiEditorApi: AiEditorFileApi = {
  onOpenProject: callback => {
    const listener = (_event: Electron.IpcRendererEvent, projectId: string | null) => callback(projectId)
    ipcRenderer.on('ai-editor:open-project', listener)
    return () => ipcRenderer.off('ai-editor:open-project', listener)
  },
  openWindow: mediaIds => ipcRenderer.invoke('ai-editor:open-window', mediaIds),
  resolveLocalMediaIds: paths => ipcRenderer.invoke('ai-editor:resolve-media-paths', paths),
  exportProject: projectId => ipcRenderer.invoke('ai-editor:export-project', projectId),
  listFilters: () => ipcRenderer.invoke('ai-editor:list-filters'),
  listWatermarks: () => ipcRenderer.invoke('ai-editor:list-watermarks'),
  project: {
    list: () => ipcRenderer.invoke('ai-editor:list-projects'),
    create: name => ipcRenderer.invoke('ai-editor:create-project', name),
    load: projectId => ipcRenderer.invoke('ai-editor:load-project', projectId),
    save: (project, expectedRevision, taskId) => ipcRenderer.invoke('ai-editor:save-project', project, expectedRevision, taskId),
    delete: projectId => ipcRenderer.invoke('ai-editor:delete-project', projectId),
    rename: (projectId, name) => ipcRenderer.invoke('ai-editor:rename-project', projectId, name),
    addMedia: (projectId, mediaIds) => ipcRenderer.invoke('ai-editor:add-media', projectId, mediaIds),
  },
  footageSelection: {
    list: () => ipcRenderer.invoke('footage-selection:list'),
    create: (name, mediaIds) => ipcRenderer.invoke('footage-selection:create', name, mediaIds),
    load: projectId => ipcRenderer.invoke('footage-selection:load', projectId),
    save: (project, expectedRevision) => ipcRenderer.invoke('footage-selection:save', project, expectedRevision),
    delete: projectId => ipcRenderer.invoke('footage-selection:delete', projectId),
  },
  agent: {
    createRequest: (request, projectId) => ipcRenderer.invoke('ai-editor:agent-create-request', request, projectId ?? null),
    updateRequest: (sessionId, request) => ipcRenderer.invoke('ai-editor:agent-update-request', sessionId, request),
    cancelRequest: sessionId => ipcRenderer.invoke('ai-editor:agent-cancel-request', sessionId),
    confirmExport: sessionId => ipcRenderer.invoke('ai-editor:agent-confirm-export', sessionId),
    denyExport: sessionId => ipcRenderer.invoke('ai-editor:agent-deny-export', sessionId),
    getSnapshot: () => ipcRenderer.invoke('ai-editor:agent-snapshot'),
    onEvent: callback => {
      const listener = (_event: Electron.IpcRendererEvent, value: import('../src/shared/types').AiEditorAgentEvent) => callback(value)
      ipcRenderer.on('ai-editor:agent-event', listener)
      return () => ipcRenderer.off('ai-editor:agent-event', listener)
    },
    onActivate: callback => {
      const listener = () => callback()
      ipcRenderer.on('ai-editor:agent-activate', listener)
      return () => ipcRenderer.off('ai-editor:agent-activate', listener)
    },
  },
  listLocalMedia: query => ipcRenderer.invoke('ai-editor:list-local-media', query),
  getLocalMedia: mediaId => ipcRenderer.invoke('ai-editor:get-local-media', mediaId),
  getLocalMediaMetadata: mediaIds => ipcRenderer.invoke('ai-editor:get-local-media-metadata', mediaIds),
  readLocalMediaBytes: mediaId => ipcRenderer.invoke('ai-editor:read-local-media-bytes', mediaId),
  inspectLocalMedia: (mediaIds, options) => ipcRenderer.invoke('ai-editor:inspect-local-media', mediaIds, options),
  createMediaContactSheet: (mediaIds, options) => ipcRenderer.invoke('ai-editor:create-media-contact-sheet', mediaIds, options),
  transcribeLocalMedia: (mediaId, options) => ipcRenderer.invoke('ai-editor:transcribe-local-media', mediaId, options),
  transcribeAudioSamples: (samples, options) => ipcRenderer.invoke('ai-editor:transcribe-audio-samples', samples, options),
}
