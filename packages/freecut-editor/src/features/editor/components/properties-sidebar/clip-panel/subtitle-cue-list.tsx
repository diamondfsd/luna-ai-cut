import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useMemo, useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@freecut/components/ui/button'
import { Input } from '@freecut/components/ui/input'
import { Label } from '@freecut/components/ui/label'
import { Textarea } from '@freecut/components/ui/textarea'
import {
  buildCueText,
  getCueFormatFlags,
  parseSubtitleCueText,
  toggleCueFormat,
  type CueFormatFlags,
} from '@freecut/shared/utils/subtitle-cue-format'
import { cn } from '@freecut/shared/ui/cn'

const CUE_ROW_ESTIMATE_PX = 116
const MIN_CUE_DURATION_SECONDS = 0.01

interface SubtitleCueRowProps {
  index: number
  cueId: string
  text: string
  startSeconds: number
  endSeconds: number
  onChange: (
    cueId: string,
    patch: Partial<{ text: string; startSeconds: number; endSeconds: number }>,
  ) => void
  onSeek?: (startSeconds: number) => void
}

interface VirtualCueListProps {
  cues: readonly { id: string; startSeconds: number; endSeconds: number; text: string }[]
  onChange: SubtitleCueRowProps['onChange']
  onSeek: SubtitleCueRowProps['onSeek']
}

export const VirtualCueList = memo(function VirtualCueList({
  cues,
  onChange,
  onSeek,
}: VirtualCueListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: cues.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CUE_ROW_ESTIMATE_PX,
    overscan: 4,
    getItemKey: (index) => cues[index]?.id ?? index,
  })

  return (
    <div ref={scrollRef} className="h-[40vh] overflow-auto pr-2">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const cue = cues[virtualRow.index]
          if (!cue) return null
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 right-0 pb-2"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <SubtitleCueRow
                index={virtualRow.index}
                cueId={cue.id}
                text={cue.text}
                startSeconds={cue.startSeconds}
                endSeconds={cue.endSeconds}
                onChange={onChange}
                onSeek={onSeek}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
})

const SubtitleCueRow = memo(function SubtitleCueRow({
  index,
  cueId,
  text,
  startSeconds,
  endSeconds,
  onChange,
  onSeek,
}: SubtitleCueRowProps) {
  const { t } = useTranslation()
  const parsed = useMemo(() => parseSubtitleCueText(text), [text])
  const flags = useMemo(() => getCueFormatFlags(parsed), [parsed])

  const handlePlainTextChange = useCallback(
    (nextPlainText: string) => {
      onChange(cueId, { text: buildCueText(nextPlainText, flags, text) })
    },
    [cueId, flags, onChange, text],
  )

  const handleToggle = useCallback(
    (format: keyof CueFormatFlags) => {
      onChange(cueId, { text: toggleCueFormat(text, format) })
    },
    [cueId, onChange, text],
  )

  return (
    <li className="rounded border border-border bg-card/40 p-2">
      <div className="flex items-center gap-2 pb-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title={t('editor.subtitleSection.seekToCue')}
          onClick={() => onSeek?.(startSeconds)}
          className="h-5 px-1.5 text-[10px] font-semibold uppercase tabular-nums text-muted-foreground"
        >
          #{index + 1}
        </Button>
        <Label className="sr-only" htmlFor={`cue-${cueId}-start`}>
          {t('editor.subtitleSection.start')}
        </Label>
        <Input
          id={`cue-${cueId}-start`}
          type="number"
          step="0.01"
          min="0"
          value={Number(startSeconds.toFixed(3))}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (!Number.isFinite(value)) return
            const clamped = Math.max(0, Math.min(value, endSeconds - MIN_CUE_DURATION_SECONDS))
            onChange(cueId, { startSeconds: clamped })
          }}
          className="h-6 w-28 text-right text-xs tabular-nums"
        />
        <span className="text-[10px] text-muted-foreground">-&gt;</span>
        <Label className="sr-only" htmlFor={`cue-${cueId}-end`}>
          {t('editor.subtitleSection.end')}
        </Label>
        <Input
          id={`cue-${cueId}-end`}
          type="number"
          step="0.01"
          min="0"
          value={Number(endSeconds.toFixed(3))}
          onChange={(event) => {
            const value = Number(event.target.value)
            if (!Number.isFinite(value)) return
            const clamped = Math.max(startSeconds + MIN_CUE_DURATION_SECONDS, value)
            onChange(cueId, { endSeconds: clamped })
          }}
          className="h-6 w-28 text-right text-xs tabular-nums"
        />
      </div>
      <Textarea
        value={parsed.plainText}
        onChange={(event) => handlePlainTextChange(event.target.value)}
        rows={2}
        className="w-full resize-none px-2 py-1 text-xs leading-snug"
      />
      <div className="flex items-center gap-1 pt-1">
        <FormatToggleButton
          active={flags.italic}
          onClick={() => handleToggle('italic')}
          label={t('editor.subtitleSection.italic')}
          glyph="I"
          glyphStyle={{ fontStyle: 'italic' }}
        />
        <FormatToggleButton
          active={flags.bold}
          onClick={() => handleToggle('bold')}
          label={t('editor.subtitleSection.bold')}
          glyph="B"
          glyphStyle={{ fontWeight: 700 }}
        />
        <FormatToggleButton
          active={flags.underline}
          onClick={() => handleToggle('underline')}
          label={t('editor.subtitleSection.underline')}
          glyph="U"
          glyphStyle={{ textDecoration: 'underline' }}
        />
        {parsed.alignment && (
          <span
            className="ml-auto text-[10px] uppercase text-muted-foreground"
            title={t('editor.subtitleSection.cuePosition', {
              vertical: parsed.alignment.verticalAlign,
              horizontal: parsed.alignment.textAlign,
            })}
          >
            {parsed.alignment.verticalAlign === 'top'
              ? 'top'
              : parsed.alignment.verticalAlign === 'bottom'
                ? 'bottom'
                : 'middle'}{' '}
            {parsed.alignment.textAlign}
          </span>
        )}
      </div>
    </li>
  )
})

interface FormatToggleButtonProps {
  active: boolean
  onClick: () => void
  label: string
  glyph: string
  glyphStyle?: CSSProperties
}

function FormatToggleButton({
  active,
  onClick,
  label,
  glyph,
  glyphStyle,
}: FormatToggleButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-5 w-5 px-0 text-[11px] leading-none shadow-none',
        active && 'border-primary bg-primary/15 text-foreground',
      )}
      style={glyphStyle}
    >
      {glyph}
    </Button>
  )
}
