import { MODE_ROWS } from '../lib/panoramaStitchingLayout'
import { Button } from '../ui'
import '../styles/panorama-phone-record-list.css'

export interface PhonePanoramaRecord {
  id: string
  started_at: string
  photos: Array<{ slot: number; name: string; available: boolean }>
  mode?: string | null
  localDownloadState?: 'downloaded' | 'partial' | 'not-downloaded'
  localDownloadedPhotos?: number
}

interface PanoramaPhoneRecordListProps {
  records: PhonePanoramaRecord[]
  selectedRecordId: string | null
  disabled: boolean
  onSelect: (record: PhonePanoramaRecord) => void
}

export function PanoramaPhoneRecordList({ records, selectedRecordId, disabled, onSelect }: PanoramaPhoneRecordListProps) {
  if (records.length === 0) return null

  return (
    <div className="panorama-phone-record-list" aria-label="手机拍摄记录">
      {records.map((record) => {
        const availableCount = record.photos.filter((photo) => photo.available).length
        const localState = record.localDownloadState ?? 'not-downloaded'
        const localStatus = localState === 'downloaded'
          ? '已下载'
          : localState === 'partial' && (record.localDownloadedPhotos ?? 0) > 0
            ? `本地 ${record.localDownloadedPhotos}/${record.photos.length}`
            : '未下载'
        const date = new Date(record.started_at)
        const dateLabel = Number.isNaN(date.getTime()) ? record.started_at : date.toLocaleString()
        return (
          <Button
            key={record.id}
            className="panorama-phone-record-button"
            variant={selectedRecordId === record.id ? 'primary' : 'secondary'}
            disabled={disabled}
            onClick={() => onSelect(record)}
          >
            <span className="panorama-phone-record-date">{dateLabel}</span>
            <span className="panorama-phone-record-meta">
              {record.mode && MODE_ROWS[record.mode] ? `${MODE_ROWS[record.mode].join('/')} · ` : ''}{availableCount}/{record.photos.length} 张
              {' · '}{localStatus}
            </span>
          </Button>
        )
      })}
    </div>
  )
}
