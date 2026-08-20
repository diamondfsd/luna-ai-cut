import type { MetadataEntry } from '../shared/types'

const REDUNDANT_VIDEO_METADATA_KEYS = new Set([
  'Make',
  'Model',
  'FirmwareVersion',
  'SerialNumber',
  'size',
  '文件大小',
  'DateTimeOriginal',
  'ModifyDate',
])

function metadataEntryLabel(name: string, key: string): string {
  if (name === '视频' && key === 'SerialNumber') return '序列号'
  return key
}

function visibleMetadataEntries(name: string, entries: MetadataEntry[]): MetadataEntry[] {
  return entries.filter((entry) => (
    !entry.key.startsWith('标签')
    && !(name === '视频' && REDUNDANT_VIDEO_METADATA_KEYS.has(entry.key))
  ))
}

export function MediaMetadataGroup({ name, entries }: { name: string; entries: MetadataEntry[] }) {
  const visibleEntries = visibleMetadataEntries(name, entries)
  if (visibleEntries.length === 0) return null
  return (
    <section>
      <span className="eyebrow">{name}</span>
      <dl>
        {visibleEntries.map((entry) => (
          <div key={`${name}-${entry.key}`}>
            <dt>{metadataEntryLabel(name, entry.key)}</dt>
            <dd title={entry.value}>{entry.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
