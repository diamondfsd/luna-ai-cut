import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { MediaGallery } from '../components/MediaGallery'
import { MediaLibraryToolbar } from '../components/MediaLibraryToolbar'
import { PreviewModal } from '../components/PreviewModal'
import type { LunaFile } from '../shared/types'
import { useMediaLibraryController, MediaLibraryCtx } from './useMediaLibraryController'
import { Modal } from '../ui'
import '../styles/library.css'

function previewPath(file: LunaFile): string {
  return file.downloadFilePath ?? file.localPath ?? file.previewUrl ?? file.sourceUrl ?? file.id
}

function usesProxyPreview(file: LunaFile): boolean {
  return !file.downloadFilePath && !file.localPath && Boolean(file.previewUrl) && previewPath(file) === file.previewUrl
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
 * 相机媒体库页面 — /library
 *
 * 数据源：从 Luna 相机设备读取文件列表。
 * 预览方式：远程地址预览。
 * 特色功能：下载到本地、存储介质筛选。
 */
export function CameraMediaPage() {
  const location = useLocation()
  const pageActive = location.pathname === '/library' || location.pathname === '/'
  const controller = useMediaLibraryController('camera')

  // 页面组件只管理滚动日期状态，其他状态通过 Context 共享给子组件
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

  // 页面会被保留并隐藏；重新进入时同步磁盘状态，清除已在本地资源中删除的下载标记。
  useEffect(() => {
    if (pageActive) void controller.restoreDownloadedRecords()
    // 只在路由重新激活时同步，文件列表首次加载时已由主进程检查本地文件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageActive])

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
        mode="camera"
        currentDate={currentDate}
      />

      <MediaGallery
        mode="camera"
        groupTitle={groupTitle}
      />

      {pageActive && controller.previewFile && (
        <PreviewModal
          previewOnly
          filePath={previewPath(controller.previewFile)}
          filePathList={controller.filteredFiles.map(previewPath)}
          proxyPreviewPaths={controller.filteredFiles.filter(usesProxyPreview).map(previewPath)}
          onClose={() => {
            controller.setPreviewFile(null)
            controller.setPreviewFiles([])
          }}
        />
      )}

      <Modal
        open={controller.showCameraDeleteDialog}
        onOpenChange={controller.setShowCameraDeleteDialog}
        title="删除相机素材"
        description={`将从当前${controller.sourceMode === 'wired' ? '相机磁盘' : '相机'}中永久删除已选的 ${controller.selectedFiles.length} 个素材。`}
        confirmText="确认删除"
        confirmVariant="danger"
        confirmDisabled={controller.deletingCameraFiles}
        confirmLoading={controller.deletingCameraFiles}
        onConfirm={() => void controller.deleteSelectedCameraFiles()}
      >
        <p className="delete-dialog-copy">
          此操作无法撤销。关联的低清预览或 Live Photo 动态文件也会一并删除，已经下载到电脑的文件不会受到影响。
        </p>
      </Modal>
    </MediaLibraryCtx.Provider>
  )
}
