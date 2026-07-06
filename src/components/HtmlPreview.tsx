import { useEffect, useRef, useState } from 'react'

import { useIsLivePhoto } from '../shared/livePhoto'
import { LivePhotoBadge } from '../ui'

interface HtmlPreviewProps {
  /** 显示用的 URL。为 null 时显示加载状态 */
  url: string | null
}

/**
 * 纯 HTML 预览组件。
 *
 * 适用于无需水印/调色等二次渲染的纯预览场景（如相机远程文件预览）。
 * 支持图片、视频、Live Photo 三种媒体类型。
 */
export function HtmlPreview({ url }: HtmlPreviewProps) {
  const isLivePhoto = useIsLivePhoto(url)

  // ── Live Photo ──
  const [liveVideoUrl, setLiveVideoUrl] = useState<string | null>(null)
  const [livePlaying, setLivePlaying] = useState(false)
  const liveLoadingRef = useRef(false)

  useEffect(() => {
    if (!isLivePhoto || !url) return
    if (liveLoadingRef.current) return
    liveLoadingRef.current = true
    window.luna
      .previewLivePhoto(url)
      .then((result) => setLiveVideoUrl(result.source ?? null))
      .catch(() => setLiveVideoUrl(null))
      .finally(() => { liveLoadingRef.current = false })
  }, [url, isLivePhoto])

  function toggleLivePhoto(): void {
    setLivePlaying((p) => !p)
  }

  // 加载中
  if (!url) {
    return (
      <div className="preview-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
        正在加载...
      </div>
    )
  }

  // Live Photo
  if (isLivePhoto) {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {livePlaying && liveVideoUrl ? (
          <video
            src={liveVideoUrl}
            controls
            autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <img
            src={url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        )}
        <div style={{ position: 'absolute', left: 18, bottom: 18, lineHeight: 0 }}>
          <LivePhotoBadge
            size={32}
            onClick={toggleLivePhoto}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLivePhoto() } }}
            aria-label={livePlaying ? '停止播放' : '播放 Live 图'}
            style={{ cursor: 'pointer' }}
          />
        </div>
      </div>
    )
  }

  // 视频
  const isVideo = url.match(/\.(mp4|mov|avi|mkv|webm|wmv|mts|insv|m4v|lrv)(\?|#|$)/i)
  if (isVideo) {
    return (
      <video
        src={url}
        controls
        autoPlay
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    )
  }

  // 图片（默认）
  return (
    <img
      src={url}
      alt=""
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
  )
}
