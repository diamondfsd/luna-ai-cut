import { useCallback, useMemo } from 'react'
import { Clock3, Download } from 'lucide-react'
import type { DirectorLabDownloadProgress, DirectorLanShot, DirectorLanTake } from '../shared/types'
import { formatBytes } from '../lib/format'
import { Button } from '../ui'
import { PreviewModal } from './PreviewModal'
import { DirectorMediaThumbnail } from './DirectorMediaThumbnail'
import './DirectorMediaPreviewDialog.css'

interface DirectorMediaPreviewDialogProps {
  take: DirectorLanTake
  shot: DirectorLanShot
  takes: DirectorLanTake[]
  planTitle: string
  downloading: boolean
  downloadProgress?: DirectorLabDownloadProgress | null
  onSelectTake: (take: DirectorLanTake) => void
  onDownload: (take: DirectorLanTake) => void
  onClose: () => void
}

function mediaPath(take: DirectorLanTake): string {
  const url = new URL(take.stream_url!)
  if (url.protocol !== 'file:') url.searchParams.set('path', take.file_name)
  return url.toString()
}

export function DirectorMediaPreviewDialog({ take, shot, takes, downloading, downloadProgress,
  onSelectTake, onDownload, onClose }: DirectorMediaPreviewDialogProps) {
  const sources = useMemo(() => new Map(takes.filter((item) => item.available && item.stream_url)
    .map((item) => [mediaPath(item), item])), [takes])
  const resolveSource = useCallback(async (path: string) => {
    const media = sources.get(path)
    if (!media?.stream_url) throw new Error('素材不可用')
    if (media.kind !== 'video' || media.stream_url.startsWith('file:')) return path
    return (await window.luna.directorLab.preparePreview({ url: media.stream_url, cacheKey: media.stream_url })).url
  }, [sources])
  const selectPath = useCallback((path: string) => {
    const selected = sources.get(path)
    if (selected && selected.id !== take.id) onSelectTake(selected)
  }, [sources, take.id, onSelectTake])
  if (!take.stream_url || !take.available) return null
  return <PreviewModal filePath={mediaPath(take)} filePathList={[...sources.keys()]} previewOnly
    resolveSource={resolveSource} onFilePathChange={selectPath} onClose={onClose}
    renderThumbnail={(path) => {
      const media = sources.get(path)
      return media?.stream_url ? <DirectorMediaThumbnail url={media.stream_url} /> : null
    }}
    renderInspector={(path) => {
      const media = sources.get(path) ?? take
      return <aside className="lab-director-inspector" aria-label="镜头信息">
        <div className="lab-viewer-shot-heading"><span>镜头 {shot.order}</span><h3>{shot.name}</h3></div>
        {shot.attributes.map((attribute) => <section className="lab-viewer-shot-section" key={attribute.id}>
          <span>{attribute.name}</span><p>{attribute.description}</p>
        </section>)}
        {shot.remark && <section className="lab-viewer-shot-section"><span>备注</span><p>{shot.remark}</p></section>}
        <div className="lab-viewer-shot-duration"><Clock3 size={14} /><span>建议时长 {shot.duration_ms / 1000} 秒</span></div>
        <section className="lab-viewer-shot-section"><span>{media.file_name}</span><p>
          {media.size_bytes ? formatBytes(media.size_bytes) : '大小未知'}
          {media.selected_range && ` · ${(media.selected_range.start_ms / 1000).toFixed(1)}–${(media.selected_range.end_ms / 1000).toFixed(1)} 秒`}
        </p></section>
        {media.download_url?.startsWith('http') && <Button size="compact" variant="secondary" icon={<Download size={15} />}
          disabled={downloading} onClick={() => onDownload(media)}>{downloading ? '下载中' : '下载原素材'}</Button>}
        {downloadProgress && downloadProgress.phase !== 'done' && <span role="status">{downloadProgress.percent}%</span>}
      </aside>
    }} />
}
