import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { MediaGallery } from '../components/MediaGallery'
import { MediaLibraryToolbar } from '../components/MediaLibraryToolbar'
import { PreviewModal } from '../components/PreviewModal'
import { useMediaLibraryController, MediaLibraryCtx } from './useMediaLibraryController'
import type { LunaFile } from '../shared/types'
import { Modal } from '../ui'
import '../styles/library.css'

function previewPath(file: LunaFile): string {
  return file.downloadFilePath ?? file.localPath ?? file.sourceUrl ?? file.id
}

/** 格式化日期，年月日和星期之间加空格 */
function groupTitle(group: string): string {
  if (group.includes('未知')) return group
  const date = new Date(`${group}T00:00:00`)
  const dateStr = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(date)
  const weekdayStr = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
  return `${dateStr} ${weekdayStr}`
}

/**
 * 本地资源页面 — /local-resources
 *
 * 数据源：本地已下载 / 已导出文件。
 * 预览方式：本地文件预览，支持水印编辑。
 * 特色功能：删除本地文件、发送到工作台、批量导出。
 */
export function LocalMediaPage() {
  const location = useLocation()
  const pageActive = location.pathname === '/local-resources'
  const controller = useMediaLibraryController('local')

  const [currentDate, setCurrentDate] = useState(
    controller.groups.length > 0
      ? (() => {
          const date = new Date(`${controller.groups[0][0]}T00:00:00`)
          const dateStr = new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }).format(date)
          const weekdayStr = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
          return `${dateStr} ${weekdayStr}`
        })()
      : '',
  )

  // 滚动时自动切换当前可见分组的日期
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('.media-section[data-group]')
    if (els.length === 0) return

    const visible = new Map<Element, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible.set(entry.target, entry.intersectionRatio)
        }
        let best: Element | null = null
        let bestRatio = -1
        for (const [el, ratio] of visible) {
          if (ratio > bestRatio) { best = el; bestRatio = ratio }
        }
        if (best) {
          const group = best.getAttribute('data-group') || ''
          const date = new Date(`${group}T00:00:00`)
          const dateStr = new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }).format(date)
          const weekdayStr = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
          setCurrentDate(`${dateStr} ${weekdayStr}`)
        }
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5] },
    )

    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [controller.groups])

  return (
    <MediaLibraryCtx.Provider value={controller}>
      <MediaLibraryToolbar
        mode="local"
        currentDate={currentDate}
      />

      <MediaGallery
        mode="local"
        groupTitle={groupTitle}
      />

      {pageActive && controller.previewFile && (
        <PreviewModal
          lightweightPreview
          filePath={previewPath(controller.previewFile)}
          filePathList={controller.filteredFiles.map(previewPath)}
          isFileSelected={(filePath) => {
            const file = controller.filteredFiles.find((candidate) => previewPath(candidate) === filePath)
            return Boolean(file && controller.selected.has(file.id))
          }}
          onToggleFileSelection={(filePath) => {
            const file = controller.filteredFiles.find((candidate) => previewPath(candidate) === filePath)
            if (file) controller.toggleFile(file)
          }}
          onClose={() => {
            controller.setPreviewFile(null)
            controller.setPreviewFiles([])
          }}
        />
      )}

      <Modal
        open={controller.showDeleteDialog}
        onOpenChange={controller.setShowDeleteDialog}
        title="删除本地文件"
        description={`将删除已选的 ${controller.selectedFiles.length} 个本地文件。这个操作不会删除相机中的原始素材。`}
        confirmText={controller.deletingLocalFiles ? '删除中...' : '确认删除'}
        confirmVariant="danger"
        confirmDisabled={controller.deletingLocalFiles}
        confirmLoading={controller.deletingLocalFiles}
        onConfirm={() => void controller.deleteSelectedLocalFiles()}
      >
        <p className="delete-dialog-copy">
          删除后文件会从本地资源列表中移除，正在预览的已删除文件也会关闭。
        </p>
      </Modal>
    </MediaLibraryCtx.Provider>
  )
}
