(() => {
  const CHOOSE_ASSETS_TIMEOUT_MS = 60_000

  const parentApi = () => {
    const parentWindow = window.parent
    const api = parentWindow !== window ? parentWindow.luna?.aiEditor : undefined
    if (!api) throw new Error('Luna 文件服务不可用')
    return api
  }

  const chooseAssets = (projectId, existingPaths = []) => {
    const parentWindow = window.parent
    if (parentWindow === window) return Promise.reject(new Error('Luna 素材选择器不可用'))
    const requestId = globalThis.crypto?.randomUUID?.() || `choose-assets-${Date.now()}-${Math.random().toString(16).slice(2)}`

    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeoutId)
        window.removeEventListener('message', handleMessage)
        window.removeEventListener('pagehide', handlePageHide)
        callback(value)
      }
      const handleMessage = (event) => {
        if (event.source !== parentWindow) return
        const message = event.data
        if (!message || typeof message !== 'object') return
        if (message.source !== 'luna-host' || message.type !== 'choose-assets-result') return
        if (message.requestId !== requestId || message.projectId !== projectId) return
        finish(resolve, Array.isArray(message.assets) ? message.assets : [])
      }
      const handlePageHide = () => finish(resolve, [])
      const timeoutId = window.setTimeout(() => {
        finish(reject, new Error('素材选择已超时'))
      }, CHOOSE_ASSETS_TIMEOUT_MS)

      window.addEventListener('message', handleMessage)
      window.addEventListener('pagehide', handlePageHide)
      try {
        parentWindow.postMessage({
          source: 'luna-openreel',
          type: 'choose-assets',
          requestId,
          projectId,
          existingPaths: Array.isArray(existingPaths) ? existingPaths.filter((path) => typeof path === 'string') : [],
        }, '*')
      } catch (error) {
        finish(reject, error instanceof Error ? error : new Error('无法打开素材选择器'))
      }
    })
  }

  // OpenReel only checks for fs to enable native project and export storage.
  // Keeping platform unset leaves the editor in its regular web UI.
  window.openreel = Object.assign(window.openreel || {}, {
    lunaProject: {
      load: (projectId) => parentApi().project.load(projectId),
      save: (projectId, editorDocument) => parentApi().project.save(projectId, editorDocument),
      chooseAssets,
    },
    fs: {
      showSaveDialog: (options) => parentApi().showSaveDialog(options),
      showOpenDialog: (options) => parentApi().showOpenDialog(options),
      readFile: (filePath) => parentApi().readFile(filePath),
      readFileBytes: (filePath) => parentApi().readFileBytes(filePath),
      tempFilePath: (extension) => parentApi().tempFilePath(extension),
      writeFile: (filePath, data) => parentApi().writeFile(filePath, data),
      openWrite: (filePath) => parentApi().openWrite(filePath),
      writeChunk: (handleId, data, position) => parentApi().writeChunk(handleId, data, position),
      closeWrite: (handleId) => parentApi().closeWrite(handleId),
      abortWrite: (handleId) => parentApi().abortWrite(handleId),
      revealInFolder: (filePath) => parentApi().revealInFolder(filePath),
    },
  })
})()
