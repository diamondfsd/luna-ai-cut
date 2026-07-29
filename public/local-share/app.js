(() => {
  const base = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`
  const state = {
    source: 'export',
    cursor: null,
    items: [],
    loading: false,
    selecting: false,
    selected: new Set(),
  }
  const grid = document.getElementById('grid')
  const more = document.getElementById('more')
  const error = document.getElementById('error')
  const summary = document.getElementById('summary')
  const viewer = document.getElementById('viewer')
  const selectButton = document.getElementById('select-button')
  const selectionBar = document.getElementById('selection-bar')
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
    grid.classList.toggle('selecting', state.selecting)
    selectButton.classList.toggle('active', state.selecting)
    selectButton.textContent = state.selecting ? '完成' : '选择'
    selectionBar.hidden = !state.selecting
    selectionCount.textContent = `已选择 ${state.selected.size} 项`
    downloadSelected.disabled = state.selected.size === 0
    grid.querySelectorAll('.photo-card').forEach((card) => {
      card.classList.toggle('selected', state.selected.has(card.dataset.id))
      const dot = card.querySelector('.selection-dot')
      if (dot) dot.textContent = state.selected.has(card.dataset.id) ? '✓' : ''
    })
  }

  function toggleSelection(id) {
    if (state.selected.has(id)) state.selected.delete(id)
    else state.selected.add(id)
    updateSelection()
  }

  function createCard(item) {
    const button = document.createElement('button')
    button.className = 'photo-card'
    button.dataset.id = item.id
    button.setAttribute('aria-label', item.name)

    if (item.previewKind !== 'download-only') {
      const image = document.createElement('img')
      image.loading = 'lazy'
      image.alt = ''
      image.src = `${base}thumb/${encodeURIComponent(item.id)}`
      image.addEventListener('error', () => image.remove())
      button.appendChild(image)
      if (item.previewKind === 'video') {
        const play = document.createElement('span')
        play.className = 'video-badge'
        play.textContent = '▶'
        button.appendChild(play)
      }
    } else {
      const placeholder = document.createElement('span')
      placeholder.className = 'file-placeholder'
      placeholder.textContent = extension(item.name)
      button.appendChild(placeholder)
    }

    const selection = document.createElement('span')
    selection.className = 'selection-dot'
    button.appendChild(selection)
    button.addEventListener('click', () => {
      if (state.selecting) toggleSelection(item.id)
      else openViewer(item)
    })
    return button
  }

  function openViewer(item) {
    document.getElementById('viewer-title').textContent = item.name
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
    viewer.showModal()
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

  document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === button))
    state.source = button.dataset.source
    load(true)
  }))
  selectButton.addEventListener('click', () => {
    state.selecting = !state.selecting
    if (!state.selecting) state.selected.clear()
    updateSelection()
  })
  downloadSelected.addEventListener('click', () => void downloadSelection())
  more.addEventListener('click', () => load(false))
  document.getElementById('close').addEventListener('click', () => viewer.close())
  viewer.addEventListener('close', () => document.getElementById('viewer-media').replaceChildren())
  load(true)
})()
