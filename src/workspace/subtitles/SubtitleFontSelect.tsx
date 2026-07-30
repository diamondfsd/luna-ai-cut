import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { SUBTITLE_BUILTIN_FONT } from '../../shared/subtitleTrack'
import type { WorkspaceSubtitleFontAsset } from '../../shared/types'
import { filePathToPreviewUrl } from '../../lib/fileUtils'
import { Button, Popover, PopoverClose, PopoverContent, PopoverTrigger, SearchField } from '../../ui'

interface SubtitleFontSelectProps {
  assets: WorkspaceSubtitleFontAsset[]
  value: WorkspaceSubtitleFontAsset
  onChange: (font: WorkspaceSubtitleFontAsset) => void
}

const loadingFontPreviews = new Set<string>()

function matchesFont(font: WorkspaceSubtitleFontAsset, search: string): boolean {
  return font.fileName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
}

function fontUrl(font: WorkspaceSubtitleFontAsset): string {
  if (font.filePath.startsWith('fonts/')) return font.filePath
  return filePathToPreviewUrl(font.filePath) ?? font.filePath
}

function fontPreviewFamily(font: WorkspaceSubtitleFontAsset): string {
  let hash = 2166136261
  for (const character of font.filePath) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619)
  return `LunaSubtitleFont${(hash >>> 0).toString(16)}`
}

function FontName({ font }: { font: WorkspaceSubtitleFontAsset }) {
  const family = useMemo(() => fontPreviewFamily(font), [font])

  useEffect(() => {
    if (loadingFontPreviews.has(family)) return
    loadingFontPreviews.add(family)
    const face = new FontFace(family, `url("${fontUrl(font)}")`)
    void face.load().then((loaded) => document.fonts.add(loaded)).catch(() => loadingFontPreviews.delete(family))
  }, [family, font])

  return <span style={{ fontFamily: `"${family}", sans-serif` }}>{font.fileName}</span>
}

export function SubtitleFontSelect({ assets, value, onChange }: SubtitleFontSelectProps) {
  const [search, setSearch] = useState('')
  const fonts = useMemo(() => [SUBTITLE_BUILTIN_FONT, ...assets]
    .filter((font, index, all) => all.findIndex((item) => item.filePath === font.filePath) === index), [assets])
  const options = fonts.filter((font) => matchesFont(font, search))

  return (
    <Popover onOpenChange={(open) => { if (!open) setSearch('') }}>
      <PopoverTrigger asChild>
        <Button variant="toolbar" size="mini" className="workspace-subtitle-font-select-trigger" title={value.fileName}>
          <FontName font={value} />
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="workspace-subtitle-font-select-popover" align="end" sideOffset={6}>
        <SearchField
          variant="compact"
          fullWidth
          wrapperClassName="workspace-subtitle-font-search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="搜索字体文件"
          aria-label="搜索字体文件"
        />
        <div className="workspace-subtitle-font-options" role="listbox" aria-label="字幕字体">
          {options.map((font) => (
            <PopoverClose key={font.filePath} asChild>
              <Button
                variant="ghost"
                size="mini"
                role="option"
                aria-selected={font.filePath === value.filePath}
                className={font.filePath === value.filePath ? 'is-active' : undefined}
                onClick={() => onChange(font)}
                title={font.fileName}
              >
                <FontName font={font} />
                {font.filePath === value.filePath && <Check size={14} aria-hidden="true" />}
              </Button>
            </PopoverClose>
          ))}
          {options.length === 0 && <p>没有匹配的字体</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
