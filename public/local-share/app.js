(() => {
  const bootScreen = document.getElementById('boot-screen')
  const wechatGuide = document.getElementById('wechat-guide')
  bootScreen.hidden = true
  if (/MicroMessenger|wxwork/i.test(navigator.userAgent)) {
    wechatGuide.hidden = false
    return
  }
  document.getElementById('app-shell').hidden = false
  document.getElementById('selection-bar').hidden = false

  const base = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`
  const state = {
    source: 'export',
    cursor: null,
    items: [],
    loading: false,
    selected: new Set(),
    fileRootId: null,
    filePath: '',
    fileParentPath: null,
    viewerIndex: -1,
    viewerHistoryActive: false,
    uploading: false,
  }
  const grid = document.getElementById('grid')
  const more = document.getElementById('more')
  const error = document.getElementById('error')
  const summary = document.getElementById('summary')
  const selectionBar = document.getElementById('selection-bar')
  const fileBack = document.getElementById('file-back')
  const viewer = document.getElementById('viewer')
  const viewerMedia = document.getElementById('viewer-media')
  const selectionCount = document.getElementById('selection-count')
  const selectionSize = document.getElementById('selection-size')
  const downloadSelected = document.getElementById('download-selected')
  const zipDownload = document.getElementById('zip-download')
  const uploadInput = document.getElementById('upload-files')
  const uploadTrigger = document.getElementById('upload-trigger')
  const imageTransform = { scale: 1, x: 0, y: 0 }
  let touchGesture = null

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
    return `${(bytes / 1073741824).toFixed(1)} GB`
  }
  const formatTime = (value) => new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
  const extension = (name) => (name.split('.').pop() || 'FILE').slice(0, 5)
  const byteLength = (value) => new TextEncoder().encode(value).length

  function zipEntryName(name, usedNames) {
    const parsedName = name.replace(/\\/g, '/').split('/').pop() || ''
    const parsed = [...parsedName].map((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127 ? '_' : character
    }).join('').trim() || 'resource'
    const extensionIndex = parsed.lastIndexOf('.')
    const stem = extensionIndex > 0 ? parsed.slice(0, extensionIndex) : parsed
    const extension = extensionIndex > 0 ? parsed.slice(extensionIndex) : ''
    let candidate = parsed
    let suffix = 1
    while (usedNames.has(candidate)) {
      candidate = `${stem} (${suffix})${extension}`
      suffix += 1
    }
    usedNames.add(candidate)
    return candidate
  }

  function estimateZipSize(items) {
    const usedNames = new Set()
    let offset = 0n
    let centralSize = 0n
    let zip64 = false
    for (const item of items) {
      const size = BigInt(Math.max(0, Number(item.size) || 0))
      const nameSize = BigInt(byteLength(zipEntryName(item.name, usedNames)))
      const entryZip64 = size > 0xffffffffn || offset > 0xffffffffn
      zip64 ||= entryZip64
      offset += 30n + nameSize + (entryZip64 ? 20n : 0n) + size + (entryZip64 ? 24n : 16n)
      centralSize += 46n + nameSize + (entryZip64 ? 28n : 0n)
    }
    const centralOffset = offset
    offset += centralSize
    if (zip64 || items.length > 0xffff || centralSize > 0xffffffffn || centralOffset > 0xffffffffn) {
      offset += 56n + 20n
    }
    offset += 22n
    return Number(offset)
  }

  function selectedItems() {
    return state.items.filter((item) => state.selected.has(item.id))
  }

  function updateSelection() {
    selectionCount.textContent = `已选择 ${state.selected.size} 项`
    const items = selectedItems()
    if (items.length === 0) {
      selectionSize.textContent = ''
    } else if (zipDownload.checked) {
      selectionSize.textContent = `预计 ZIP ${formatSize(estimateZipSize(items))}`
    } else {
      const totalSize = items.reduce((sum, item) => sum + (Number(item.size) || 0), 0)
      selectionSize.textContent = `文件合计 ${formatSize(totalSize)}`
    }
    downloadSelected.disabled = state.selected.size === 0
    downloadSelected.textContent = zipDownload.checked ? '下载 ZIP 包' : '下载所选资源'
    selectionBar.hidden = state.source === 'files'
    grid.querySelectorAll('.photo-card').forEach((card) => {
      card.classList.toggle('selected', state.selected.has(card.dataset.id))
      const dot = card.querySelector('.selection-dot')
      if (dot) {
        const selected = state.selected.has(card.dataset.id)
        dot.setAttribute('aria-pressed', String(selected))
        dot.setAttribute('aria-label', `${selected ? '取消选择' : '选择'} ${dot.dataset.name}`)
      }
    })
  }

  function toggleSelection(id) {
    if (state.selected.has(id)) state.selected.delete(id)
    else state.selected.add(id)
    updateSelection()
  }

  function updateFileNavigation() {
    const inFiles = state.source === 'files'
    fileBack.hidden = !inFiles || state.fileRootId === null
    fileBack.textContent = state.filePath ? '返回上一级' : '返回共享文件'
  }

  function createCard(item) {
    const card = document.createElement('article')
    card.className = 'photo-card'
    card.dataset.id = item.id
    const preview = document.createElement('button')
    preview.className = 'preview-trigger'
    preview.setAttribute('aria-label', `预览 ${item.name}`)

    if (item.previewKind !== 'download-only') {
      const image = document.createElement('img')
      image.loading = 'lazy'
      image.alt = ''
      image.src = `${base}thumb/${encodeURIComponent(item.id)}`
      image.addEventListener('error', () => image.remove())
      preview.appendChild(image)
      if (item.previewKind === 'video') {
        const play = document.createElement('span')
        play.className = 'video-badge'
        preview.appendChild(play)
      }
    } else {
      const placeholder = document.createElement('span')
      placeholder.className = 'file-placeholder'
      placeholder.textContent = extension(item.name)
      preview.appendChild(placeholder)
    }

    const selection = document.createElement('button')
    selection.className = 'selection-dot'
    selection.type = 'button'
    selection.dataset.name = item.name
    selection.setAttribute('aria-pressed', 'false')
    selection.setAttribute('aria-label', `选择 ${item.name}`)
    selection.addEventListener('click', () => toggleSelection(item.id))
    preview.addEventListener('click', () => openViewer(item))
    card.append(preview, selection)
    return card
  }

  function createFileEntry(item) {
    const entry = document.createElement('article')
    entry.className = 'file-entry'
    const button = document.createElement('button')
    button.className = 'file-entry-button'
    button.type = 'button'
    button.setAttribute('aria-label', `${item.kind === 'directory' ? '打开文件夹' : '下载文件'} ${item.name}`)
    const icon = document.createElement('span')
    icon.className = `file-entry-icon ${item.kind === 'directory' ? 'folder' : 'file'}`
    icon.textContent = item.kind === 'directory' ? '文件夹' : extension(item.name)
    const details = document.createElement('span')
    details.className = 'file-entry-details'
    const name = document.createElement('strong')
    name.textContent = item.name
    details.appendChild(name)
    if (item.kind === 'file') {
      const meta = document.createElement('small')
      meta.textContent = formatSize(item.size || 0)
      details.appendChild(meta)
    }
    const arrow = document.createElement('span')
    arrow.className = 'file-entry-arrow'
    arrow.textContent = item.kind === 'directory' ? '进入' : '下载'
    button.append(icon, details, arrow)
    button.addEventListener('click', () => {
      if (item.kind === 'directory') {
        void loadSharedFiles(item.rootId || state.fileRootId, item.path)
        return
      }
      const link = document.createElement('a')
      link.href = `${base}file-download/${encodeURIComponent(item.id)}`
      link.download = item.name
      document.body.appendChild(link)
      link.click()
      link.remove()
    })
    entry.appendChild(button)
    return entry
  }

  function createFileRoot(root) {
    return createFileEntry({ kind: 'directory', id: root.id, rootId: root.id, name: root.name, path: '' })
  }

  function renderViewer(index) {
    const item = state.items[index]
    if (!item) return
    state.viewerIndex = index
    document.getElementById('viewer-title').textContent = item.name
    document.getElementById('viewer-position').textContent = `${index + 1} / ${state.items.length}`
    document.getElementById('viewer-info').textContent = `${formatTime(item.createdAt)} · ${formatSize(item.size)}`
    const media = viewerMedia
    media.replaceChildren()
    media.classList.toggle('image-zoomable', item.previewKind === 'image')
    resetImageTransform()
    const mediaUrl = `${base}media/${encodeURIComponent(item.id)}`
    if (item.previewKind === 'image') {
      const image = document.createElement('img')
      image.src = mediaUrl
      image.alt = item.name
      media.appendChild(image)
    } else if (item.previewKind === 'video') {
      const video = document.createElement('video')
      video.src = mediaUrl
      video.controls = true
      video.playsInline = true
      media.appendChild(video)
    } else {
      const message = document.createElement('div')
      message.className = 'download-only'
      message.textContent = '该格式请下载后查看'
      media.appendChild(message)
    }
    const download = document.getElementById('download')
    download.href = `${base}download/${encodeURIComponent(item.id)}`
    download.setAttribute('download', item.name)
  }

  function openViewer(item) {
    const index = state.items.findIndex((candidate) => candidate.id === item.id)
    if (index < 0) return
    renderViewer(index)
    if (!viewer.hidden) return
    history.pushState(Object.assign({}, history.state || {}, { lunaViewer: true }), '')
    state.viewerHistoryActive = true
    viewer.hidden = false
    document.body.classList.add('viewer-open')
  }

  function closeViewer() {
    viewer.hidden = true
    document.body.classList.remove('viewer-open')
    viewerMedia.replaceChildren()
    viewerMedia.classList.remove('image-zoomable')
    resetImageTransform()
    state.viewerIndex = -1
  }

  function requestViewerClose() {
    if (state.viewerHistoryActive) history.back()
    else closeViewer()
  }

  function moveViewer(direction) {
    const index = state.viewerIndex + direction
    if (index >= 0 && index < state.items.length) renderViewer(index)
  }

  function touchDistance(touches) {
    return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
  }

  function resetImageTransform() {
    imageTransform.scale = 1
    imageTransform.x = 0
    imageTransform.y = 0
    touchGesture = null
    const image = viewerMedia.querySelector('img')
    if (image) image.style.transform = ''
  }

  function applyImageTransform(scale, x, y) {
    const image = viewerMedia.querySelector('img')
    if (!image) return
    const nextScale = Math.min(4, Math.max(1, scale))
    const maxX = Math.max(0, (image.offsetWidth * nextScale - viewerMedia.clientWidth) / 2)
    const maxY = Math.max(0, (image.offsetHeight * nextScale - viewerMedia.clientHeight) / 2)
    imageTransform.scale = nextScale
    imageTransform.x = Math.min(maxX, Math.max(-maxX, x))
    imageTransform.y = Math.min(maxY, Math.max(-maxY, y))
    image.style.transform = `translate3d(${imageTransform.x}px, ${imageTransform.y}px, 0) scale(${nextScale})`
  }

  async function load(reset) {
    if (state.source === 'files') {
      await loadSharedFiles(reset ? null : state.fileRootId, reset ? '' : state.filePath)
      return
    }
    if (state.loading) return
    state.loading = true
    error.replaceChildren()
    if (reset) {
      state.cursor = null
      state.items = []
      state.selected.clear()
      grid.replaceChildren()
      updateSelection()
    }
    try {
      const params = new URLSearchParams({ source: state.source, limit: '60' })
      if (state.cursor) params.set('cursor', state.cursor)
      const response = await fetch(`${base}api/resources?${params}`)
      if (!response.ok) throw new Error(response.status === 401 || response.status === 404 ? '本次分享已结束，请重新扫码' : '资源读取失败')
      const data = await response.json()
      state.items.push(...data.items)
      state.cursor = data.nextCursor
      data.items.forEach((item) => grid.appendChild(createCard(item)))
      const sourceLabel = state.source === 'export' ? '导出文件' : '本地资源'
      summary.textContent = `${data.total} 个${sourceLabel}`
      more.hidden = !state.cursor
      if (state.items.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'empty'
        empty.textContent = '当前没有可访问的资源'
        grid.appendChild(empty)
      }
    } catch (cause) {
      const box = document.createElement('div')
      box.className = 'error'
      box.textContent = cause instanceof Error ? cause.message : '无法连接电脑'
      error.appendChild(box)
      summary.textContent = '连接不可用'
    } finally {
      state.loading = false
      requestAnimationFrame(maybeLoadMore)
    }
  }

  async function loadSharedFiles(rootId, path) {
    if (state.loading) return
    state.loading = true
    error.replaceChildren()
    state.selected.clear()
    grid.replaceChildren()
    state.fileRootId = rootId
    state.filePath = path || ''
    state.fileParentPath = null
    updateSelection()
    updateFileNavigation()
    try {
      const params = new URLSearchParams()
      if (rootId) params.set('root', rootId)
      if (path) params.set('path', path)
      const query = params.toString()
      const response = await fetch(`${base}api/files${query ? `?${query}` : ''}`)
      if (!response.ok) throw new Error(response.status === 401 || response.status === 404 ? '本次分享已结束，请重新扫码' : '共享文件读取失败')
      const data = await response.json()
      state.fileRootId = data.rootId
      state.filePath = data.path || ''
      state.fileParentPath = data.parentPath
      updateFileNavigation()
      if (!data.rootId) {
        const directoryRoots = data.roots.filter((root) => root.kind !== 'files')
        const fileRoot = data.roots.find((root) => root.kind === 'files')
        directoryRoots.forEach((root) => grid.appendChild(createFileRoot(root)))
        let draggedFileCount = 0
        if (fileRoot) {
          const fileResponse = await fetch(`${base}api/files?root=${encodeURIComponent(fileRoot.id)}`)
          if (!fileResponse.ok) throw new Error('拖入文件读取失败')
          const fileData = await fileResponse.json()
          const heading = document.createElement('div')
          heading.className = 'file-section-title'
          heading.textContent = '拖入的文件'
          grid.appendChild(heading)
          fileData.items.forEach((item) => grid.appendChild(createFileEntry(item)))
          draggedFileCount = fileData.items.length
        }
        summary.textContent = `${directoryRoots.length} 个共享文件夹${draggedFileCount > 0 ? ` · ${draggedFileCount} 个拖入文件` : ''}`
      } else {
        data.items.forEach((item) => grid.appendChild(createFileEntry(item)))
        summary.textContent = `${data.total} 个项目${data.rootName ? ` · ${data.rootName}` : ''}`
      }
      if (grid.children.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'empty'
        empty.textContent = data.rootId ? '当前目录没有内容' : '暂未添加共享目录或文件'
        grid.appendChild(empty)
      }
      more.hidden = true
    } catch (cause) {
      const box = document.createElement('div')
      box.className = 'error'
      box.textContent = cause instanceof Error ? cause.message : '无法连接电脑'
      error.appendChild(box)
      summary.textContent = '连接不可用'
    } finally {
      state.loading = false
    }
  }

  function downloadSelection() {
    const items = selectedItems()
    if (items.length === 0) return
    downloadSelected.disabled = true
    if (zipDownload.checked) {
      const params = new URLSearchParams()
      items.forEach((item) => params.append('id', item.id))
      const link = document.createElement('a')
      link.href = `${base}download-zip?${params.toString()}`
      link.download = 'Luna AI Cut 资源.zip'
      document.body.appendChild(link)
      link.click()
      link.remove()
      downloadSelected.textContent = '下载 ZIP 包'
      downloadSelected.disabled = false
      return
    }
    downloadSelected.textContent = '正在开始下载'
    for (const item of items) {
      const link = document.createElement('a')
      link.href = `${base}download/${encodeURIComponent(item.id)}`
      link.download = item.name
      document.body.appendChild(link)
      link.click()
      link.remove()
    }
    downloadSelected.textContent = '下载所选资源'
    downloadSelected.disabled = false
  }

  async function uploadFiles(fileList) {
    if (state.uploading || fileList.length === 0) return
    state.uploading = true
    uploadTrigger.disabled = true
    uploadTrigger.textContent = '正在上传'
    let uploaded = 0
    try {
      for (const file of fileList) {
        const response = await fetch(`${base}api/upload`, {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: file,
        })
        if (!response.ok) {
          let message = '上传失败'
          try {
            const body = await response.json()
            if (body.error) message = body.error
          } catch { /* Keep the generic message. */ }
          throw new Error(`${file.name}：${message}`)
        }
        uploaded += 1
        summary.textContent = `已上传 ${uploaded}/${fileList.length} 个文件`
      }
      if (uploaded > 0) {
        const localTab = document.querySelector('.tab[data-source="local"]')
        if (localTab) localTab.click()
      }
    } catch (cause) {
      const box = document.createElement('div')
      box.className = 'error'
      box.textContent = cause instanceof Error ? cause.message : '上传失败，请重试'
      error.replaceChildren(box)
    } finally {
      state.uploading = false
      uploadTrigger.disabled = false
      uploadTrigger.textContent = '上传素材'
      uploadInput.value = ''
    }
  }

  function maybeLoadMore() {
    if (state.source === 'files') return
    if (!state.cursor || state.loading || more.hidden) return
    const scrollTop = window.scrollY || window.pageYOffset || 0
    const remaining = document.documentElement.scrollHeight - scrollTop - window.innerHeight
    if (remaining < 400) void load(false)
  }

  document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => {
      const active = item === button
      item.classList.toggle('active', active)
      item.setAttribute('aria-selected', String(active))
    })
    state.source = button.dataset.source
    state.fileRootId = null
    state.filePath = ''
    updateFileNavigation()
    load(true)
  }))
  fileBack.addEventListener('click', () => {
    if (state.fileRootId === null) return
    if (state.filePath) {
      void loadSharedFiles(state.fileRootId, state.fileParentPath || '')
    } else {
      void loadSharedFiles(null, '')
    }
  })
  uploadTrigger.addEventListener('click', () => uploadInput.click())
  uploadInput.addEventListener('change', () => void uploadFiles(uploadInput.files ? [...uploadInput.files] : []))
  zipDownload.addEventListener('change', updateSelection)
  downloadSelected.addEventListener('click', () => void downloadSelection())
  document.getElementById('close').addEventListener('click', requestViewerClose)
  window.addEventListener('popstate', () => {
    if (!viewer.hidden) closeViewer()
    state.viewerHistoryActive = false
  })
  window.addEventListener('scroll', maybeLoadMore, { passive: true })
  window.addEventListener('resize', maybeLoadMore)
  if ('IntersectionObserver' in window) {
    const loadObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load(false)
    }, { rootMargin: '400px 0px' })
    loadObserver.observe(more)
  }

  viewerMedia.addEventListener('touchstart', (event) => {
    const image = viewerMedia.querySelector('img')
    if (image && event.touches.length === 2) {
      event.preventDefault()
      touchGesture = { mode: 'pinch', distance: Math.max(1, touchDistance(event.touches)), scale: imageTransform.scale }
      return
    }
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    if (image && imageTransform.scale > 1) {
      event.preventDefault()
      touchGesture = { mode: 'pan', x: touch.clientX, y: touch.clientY, baseX: imageTransform.x, baseY: imageTransform.y }
      return
    }
    const video = typeof event.target.closest === 'function' ? event.target.closest('video') : null
    if (video && touch.clientY > video.getBoundingClientRect().bottom - 64) return
    touchGesture = { mode: 'swipe', x: touch.clientX, y: touch.clientY }
  }, { passive: false })

  viewerMedia.addEventListener('touchmove', (event) => {
    if (!touchGesture) return
    if (touchGesture.mode === 'pinch' && event.touches.length === 2) {
      event.preventDefault()
      applyImageTransform(touchGesture.scale * touchDistance(event.touches) / touchGesture.distance, imageTransform.x, imageTransform.y)
    } else if (touchGesture.mode === 'pan' && event.touches.length === 1) {
      event.preventDefault()
      applyImageTransform(
        imageTransform.scale,
        touchGesture.baseX + event.touches[0].clientX - touchGesture.x,
        touchGesture.baseY + event.touches[0].clientY - touchGesture.y
      )
    }
  }, { passive: false })

  viewerMedia.addEventListener('touchend', (event) => {
    if (!touchGesture) return
    if (touchGesture.mode === 'pinch' && event.touches.length === 1) {
      const touch = event.touches[0]
      touchGesture = { mode: 'pan', x: touch.clientX, y: touch.clientY, baseX: imageTransform.x, baseY: imageTransform.y }
      return
    }
    if (touchGesture.mode === 'swipe' && event.changedTouches.length === 1) {
      const deltaX = event.changedTouches[0].clientX - touchGesture.x
      const deltaY = event.changedTouches[0].clientY - touchGesture.y
      if (Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) moveViewer(deltaX < 0 ? 1 : -1)
    }
    touchGesture = null
  }, { passive: true })
  viewerMedia.addEventListener('touchcancel', () => { touchGesture = null })
  load(true)
})()
