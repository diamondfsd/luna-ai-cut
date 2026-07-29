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
    viewerIndex: -1,
    viewerHistoryActive: false,
  }
  const grid = document.getElementById('grid')
  const more = document.getElementById('more')
  const error = document.getElementById('error')
  const summary = document.getElementById('summary')
  const viewer = document.getElementById('viewer')
  const selectionCount = document.getElementById('selection-count')
  const downloadSelected = document.getElementById('download-selected')

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

  function updateSelection() {
    selectionCount.textContent = `已选择 ${state.selected.size} 项`
    downloadSelected.disabled = state.selected.size === 0
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

  function renderViewer(index) {
    const item = state.items[index]
    if (!item) return
    state.viewerIndex = index
    document.getElementById('viewer-title').textContent = item.name
    document.getElementById('viewer-position').textContent = `${index + 1} / ${state.items.length}`
    document.getElementById('viewer-info').textContent = `${formatTime(item.createdAt)} · ${formatSize(item.size)}`
    const media = document.getElementById('viewer-media')
    media.replaceChildren()
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
    document.getElementById('viewer-media').replaceChildren()
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

  async function load(reset) {
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
      summary.textContent = `${data.total} 个${state.source === 'export' ? '导出文件' : '本地资源'}`
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

  async function downloadSelection() {
    const items = state.items.filter((item) => state.selected.has(item.id))
    if (items.length === 0) return
    downloadSelected.disabled = true
    downloadSelected.textContent = '正在开始下载'
    for (const item of items) {
      const link = document.createElement('a')
      link.href = `${base}download/${encodeURIComponent(item.id)}`
      link.download = item.name
      document.body.appendChild(link)
      link.click()
      link.remove()
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
    downloadSelected.textContent = '下载所选资源'
    downloadSelected.disabled = false
  }

  function maybeLoadMore() {
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
    load(true)
  }))
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

  let touchStart = null
  document.getElementById('viewer-media').addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return
    const video = typeof event.target.closest === 'function' ? event.target.closest('video') : null
    if (video && event.touches[0].clientY > video.getBoundingClientRect().bottom - 64) return
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }, { passive: true })
  document.getElementById('viewer-media').addEventListener('touchend', (event) => {
    if (!touchStart || event.changedTouches.length !== 1) return
    const deltaX = event.changedTouches[0].clientX - touchStart.x
    const deltaY = event.changedTouches[0].clientY - touchStart.y
    touchStart = null
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return
    moveViewer(deltaX < 0 ? 1 : -1)
  }, { passive: true })
  document.getElementById('viewer-media').addEventListener('touchcancel', () => { touchStart = null })
  load(true)
})()
