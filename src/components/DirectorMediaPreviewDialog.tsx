import { useCallback, useMemo } from 'react'
import { Clock3, Download } from 'lucide-react'
import type { DirectorLabDownloadProgress, DirectorLanPlanSummary, DirectorLanShot, DirectorLanTake } from '../shared/types'
import { formatBytes } from '../lib/format'
import { Button, Dialog } from '../ui'
import { PreviewModal } from './PreviewModal'
import { DirectorMediaThumbnail } from './DirectorMediaThumbnail'
import { DirectorVideoRangeEditor } from './DirectorVideoRangeEditor'
import { DirectorTakeList } from './DirectorTakeList'
import { directorPreviewPath } from '../lib/directorMediaSource'
import { directorPlanWithTakeRange, type DirectorTakeRange } from '../lib/directorTakeRange'
import { directorPlanContentSignature } from '../lib/directorPlanSync'
import './DirectorMediaPreviewDialog.css'

interface DirectorMediaPreviewDialogProps {
  plan: DirectorLanPlanSummary
  onLocalPlanChange: (plan: DirectorLanPlanSummary) => void
  onWriteStateChange: (planId: string, pending: boolean) => void
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

export function DirectorMediaPreviewDialog({ plan, onLocalPlanChange, onWriteStateChange, take, shot, takes, downloading, downloadProgress,
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
  const videoSource = useCallback(async () => directorPreviewPath(await resolveSource(mediaPath(take))), [resolveSource, take])
  const saveRange = async (range: DirectorTakeRange) => {
    const expected = plan.local_content_signature ?? directorPlanContentSignature(plan)
    const next = directorPlanWithTakeRange(plan, take.id, range)
    onWriteStateChange(plan.id, true)
    try {
      const saved = await window.luna.directorLab.saveLocalPlan({ ...next,
        synced_signature: plan.synced_signature ?? directorPlanContentSignature(plan),
      }, expected)
      onLocalPlanChange(saved)
    } finally { onWriteStateChange(plan.id, false) }
  }
  if (!take.stream_url || !take.available) return <Dialog open title="素材不可用" onOpenChange={open => !open && onClose()}>
    请连接手机同步素材，或为这个镜头添加本地素材。
  </Dialog>
  if (take.kind === 'video') return <DirectorVideoRangeEditor key={take.id} take={take} shot={shot} takes={takes}
    source={videoSource} onSave={saveRange} onSelectTake={onSelectTake} onClose={onClose}
    downloading={downloading} onDownload={() => onDownload(take)} />
  return <PreviewModal filePath={mediaPath(take)} filePathList={[...sources.keys()]} previewOnly
    resolveSource={resolveSource} onFilePathChange={selectPath} onClose={onClose}
    renderThumbnail={(path) => {
      const media = sources.get(path)
      return media?.stream_url ? <DirectorMediaThumbnail url={media.stream_url} /> : null
    }}
    renderInspector={(path) => {
      const media = sources.get(path) ?? take
      return <aside className="lab-director-inspector" aria-label="镜头信息">
        {takes.length > 1 && <DirectorTakeList takes={takes} selectedId={take.id} onSelect={onSelectTake} />}
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
