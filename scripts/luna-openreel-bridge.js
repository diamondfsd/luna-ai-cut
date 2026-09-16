(() => {
  const CHOOSE_ASSETS_TIMEOUT_MS = 60_000
  const AGENT_PROMPT_TIMEOUT_MS = 30_000
  let pendingImportAssets = []
  let mcpRequestHandler = null
  let agentEventHandler = null
  let agentActivateHandler = null

  const parentApi = () => {
    const parentWindow = window.parent
    const api = parentWindow !== window ? parentWindow.luna?.aiEditor : undefined
    if (!api) throw new Error('Luna 文件服务不可用')
    return api
  }

  const parentLog = (level, message, meta) => {
    try {
      const parentWindow = window.parent
      if (parentWindow === window) return
      const taggedMessage = `[OpenReel] ${message}`
      const openReelLog = parentWindow.luna?.logOpenReel
      if (typeof openReelLog === 'function') openReelLog(level, taggedMessage, meta)
      const rendererLog = parentWindow.luna?.log
      if (typeof rendererLog === 'function') rendererLog(level, taggedMessage, meta)
    } catch {
      // Logging must not affect editor behavior.
    }
  }

  const logValue = (value) => {
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
    if (typeof value === 'string') return value
    try {
      const serialized = JSON.stringify(value)
      return serialized === undefined ? String(value) : serialized
    } catch {
      try { return String(value) } catch { return '[unserializable]' }
    }
  }

  // OpenReel runs in the iframe realm. Forward its console output to the host
  // renderer log; the host logger keeps the original level where possible.
  for (const level of ['debug', 'log', 'info', 'warn', 'error']) {
    const original = typeof console[level] === 'function' ? console[level].bind(console) : null
    if (!original) continue
    console[level] = (...args) => {
      original(...args)
      const [first, ...rest] = args
      const firstValue = first === undefined ? '' : logValue(first)
      const message = typeof firstValue === 'string' ? firstValue : JSON.stringify(firstValue)
      parentLog(level, message || '', rest.length > 0 ? { args: rest.map(logValue) } : undefined)
    }
  }

  window.addEventListener('error', (event) => {
    parentLog('error', '[全局异常]', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: logValue(event.error),
    })
  }, true)
  window.addEventListener('unhandledrejection', (event) => {
    parentLog('error', '[未处理的异步异常]', { reason: logValue(event.reason) })
  })

  window.addEventListener('message', async (event) => {
    if (event.source !== window.parent) return
    const message = event.data
    if (!message || message.source !== 'luna-host') return

    if (message.type === 'mcp-request') {
      const response = typeof mcpRequestHandler === 'function'
        ? await Promise.resolve(mcpRequestHandler({
          callId: message.callId,
          kind: message.kind,
          name: message.name,
          args: message.args,
        })).catch((error) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }))
        : { ok: false, error: 'AI 剪辑工具尚未准备好' }
      try {
        window.parent.postMessage({
          source: 'luna-openreel',
          type: 'mcp-response',
          callId: message.callId,
          response,
        }, '*')
      } catch {
        // The host request will time out and report the failed handoff.
      }
      return
    }

    if (message.type === 'agent-event') {
      if (typeof agentEventHandler === 'function') agentEventHandler(message.event)
      return
    }

    if (message.type === 'agent-state') {
      const events = message.snapshot && Array.isArray(message.snapshot.events)
        ? message.snapshot.events
        : []
      if (typeof agentEventHandler === 'function') {
        for (const event of events) agentEventHandler(event)
      }
      return
    }

    if (message.type === 'agent-activate') {
      if (typeof agentActivateHandler === 'function') agentActivateHandler()
      return
    }

    if (message.type !== 'initial-media-sources') return
    pendingImportAssets = Array.isArray(message.assets)
      ? message.assets.filter((asset) => asset && typeof asset.path === 'string' && typeof asset.name === 'string')
      : []
    try {
      window.parent.postMessage({
        source: 'luna-openreel',
        type: 'initial-media-sources-ready',
      }, '*')
    } catch {
      // The host will time out and report the failed handoff.
    }
  })

  const matchImportAsset = (name, size) => {
    const index = pendingImportAssets.findIndex((asset) => asset.name === name && (asset.size === undefined || asset.size === size))
    if (index < 0) return null
    const [asset] = pendingImportAssets.splice(index, 1)
    return asset
  }

  const parentLunaApi = () => {
    const parentWindow = window.parent
    const api = parentWindow !== window ? parentWindow.luna : undefined
    if (!api) throw new Error('Luna 媒体服务不可用')
    return api
  }

  // The parent preload may return an ArrayBuffer from a different window
  // realm. Copy it into this iframe's realm before OpenReel checks its type.
  const localArrayBuffer = (value) => {
    if (value instanceof ArrayBuffer) return value
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer
    }
    if (value && typeof value === 'object' && typeof value.byteLength === 'number') {
      return new Uint8Array(value).slice().buffer
    }
    throw new TypeError('素材数据格式无效')
  }

  const readFileBytes = async (filePath) => localArrayBuffer(await parentApi().readFileBytes(filePath))
  const listLocalMedia = (query) => parentApi().listLocalMedia(query)
  const getLocalMedia = (mediaId) => parentApi().getLocalMedia(mediaId)
  const getLocalMediaMetadata = (mediaIds) => parentApi().getLocalMediaMetadata(mediaIds)
  const readLocalMediaBytes = async (mediaId) => localArrayBuffer(await parentApi().readLocalMediaBytes(mediaId))
  const inspectLocalMedia = (mediaIds, options) => parentApi().inspectLocalMedia(mediaIds, options)
  const createMediaContactSheet = (mediaIds, options) => parentApi().createMediaContactSheet(mediaIds, options)
  const transcribeLocalMedia = (mediaId, options) => parentApi().transcribeLocalMedia(mediaId, options)
  const transcribeAudioSamples = (samples, options) => parentApi().transcribeAudioSamples(samples, options)

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

  const generateAgentPrompt = (request) => {
    const parentWindow = window.parent
    if (parentWindow === window) return Promise.reject(new Error('Luna 提示词服务不可用'))
    const normalizedRequest = typeof request === 'string' ? request.trim() : ''
    if (!normalizedRequest) return Promise.reject(new Error('剪辑要求不能为空'))
    const requestId = globalThis.crypto?.randomUUID?.() || `agent-prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`

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
        if (!message || message.source !== 'luna-host' || message.type !== 'agent-prompt-generated') return
        if (message.requestId !== requestId) return
        if (typeof message.prompt === 'string' && message.prompt.trim()) {
          finish(resolve, message.prompt)
        } else {
          finish(reject, new Error(typeof message.error === 'string' ? message.error : '无法生成剪辑提示词'))
        }
      }
      const handlePageHide = () => finish(reject, new Error('AI 剪辑页面已关闭'))
      const timeoutId = window.setTimeout(() => {
        finish(reject, new Error('生成剪辑提示词超时'))
      }, AGENT_PROMPT_TIMEOUT_MS)

      window.addEventListener('message', handleMessage)
      window.addEventListener('pagehide', handlePageHide)
      try {
        parentWindow.postMessage({
          source: 'luna-openreel',
          type: 'generate-agent-prompt',
          requestId,
          request: normalizedRequest,
        }, '*')
      } catch (error) {
        finish(reject, error instanceof Error ? error : new Error('无法生成剪辑提示词'))
      }
    })
  }

  // OpenReel only checks for fs to enable native project and export storage.
  // Keeping platform unset leaves the editor in its regular web UI.
  window.openreel = Object.assign(window.openreel || {}, {
    mcp: {
      onRequest: (handler) => {
        mcpRequestHandler = handler
        return () => {
          if (mcpRequestHandler === handler) mcpRequestHandler = null
        }
      },
    },
    lunaAgent: {
      generatePrompt: (request) => generateAgentPrompt(request),
      createRequest: (request, projectId) => parentApi().agent.createRequest(request, projectId),
      updateRequest: (sessionId, request) => parentApi().agent.updateRequest(sessionId, request),
      cancelRequest: (sessionId) => parentApi().agent.cancelRequest(sessionId),
      confirmExport: (sessionId) => parentApi().agent.confirmExport(sessionId),
      denyExport: (sessionId) => parentApi().agent.denyExport(sessionId),
      getSnapshot: () => parentApi().agent.getSnapshot(),
      onEvent: (handler) => {
        agentEventHandler = handler
        return () => {
          if (agentEventHandler === handler) agentEventHandler = null
        }
      },
      onActivate: (handler) => {
        agentActivateHandler = handler
        return () => {
          if (agentActivateHandler === handler) agentActivateHandler = null
        }
      },
    },
    lunaProject: {
      list: () => parentApi().project.list(),
      create: (name) => parentApi().project.create(name),
      load: (projectId) => parentApi().project.load(projectId),
      save: (projectId, editorDocument) => parentApi().project.save(projectId, editorDocument),
      delete: (projectId) => parentApi().project.delete(projectId),
      rename: (projectId, name) => parentApi().project.rename(projectId, name),
      chooseAssets,
    },
    lunaMedia: {
      readFileBytes,
      listLocalMedia,
      getLocalMedia,
      getLocalMediaMetadata,
      readLocalMediaBytes,
      inspectLocalMedia,
      createMediaContactSheet,
      transcribeLocalMedia,
      transcribeAudioSamples,
      resolveThumbnail: (sourcePath, kind) => parentLunaApi().resolveThumbnail(sourcePath, kind),
      matchImportAsset,
    },
    fs: {
      showSaveDialog: (options) => parentApi().showSaveDialog(options),
      showOpenDialog: (options) => parentApi().showOpenDialog(options),
      readFile: (filePath) => parentApi().readFile(filePath),
      readFileBytes,
      tempFilePath: (extension) => parentApi().tempFilePath(extension),
      writeFile: (filePath, data) => parentApi().writeFile(filePath, data),
      openWrite: (filePath) => parentApi().openWrite(filePath),
      writeChunk: (handleId, data, position) => parentApi().writeChunk(handleId, data, position),
      closeWrite: (handleId) => parentApi().closeWrite(handleId),
      abortWrite: (handleId) => parentApi().abortWrite(handleId),
      revealInFolder: (filePath) => parentApi().revealInFolder(filePath),
    },
  })

  parentLog('info', '[bridge] ready')
})()
