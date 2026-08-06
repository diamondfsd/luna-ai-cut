import { useTranslation } from 'react-i18next'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { RULER_HEIGHT } from './dopesheet-constants'

interface DopesheetRulerHeaderProps {
  propertyGridStyle: CSSProperties
  timelineRef: React.RefObject<HTMLDivElement | null>
  onRulerPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onRulerPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onRulerPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onRulerPointerLeave: (event: ReactPointerEvent<HTMLDivElement>) => void
  rulerTickElements: ReactNode
  liveRulerCanvas?: ReactNode
  reservedRightGutterWidth?: number
  propertyFilter?: 'all' | 'keyframed'
  onPropertyFilterChange?: (filter: 'all' | 'keyframed') => void
}

export function DopesheetRulerHeader({
  propertyGridStyle,
  timelineRef,
  onRulerPointerDown,
  onRulerPointerMove,
  onRulerPointerUp,
  onRulerPointerLeave,
  rulerTickElements,
  liveRulerCanvas,
  reservedRightGutterWidth = 0,
  propertyFilter = 'all',
  onPropertyFilterChange,
}: DopesheetRulerHeaderProps) {
  const { t } = useTranslation()

  return (
    <div className="grid border-b border-border bg-muted/25" style={propertyGridStyle}>
      <div
        className="flex items-center justify-between gap-2 px-1 text-[10px] font-medium text-muted-foreground"
        style={{ height: RULER_HEIGHT }}
      >
        <span>{t('timeline.keyframeEditor.property')}</span>
        {onPropertyFilterChange ? (
          <div
            role="group"
            aria-label={t('timeline.keyframeEditor.propertyVisibility')}
            className="flex h-[18px] shrink-0 items-center rounded border border-border/70 bg-background/70 p-px"
          >
            {(['keyframed', 'all'] as const).map((filter) => {
              const selected = propertyFilter === filter
              return (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={selected}
                  className={`h-4 rounded px-1.5 text-[9px] leading-none transition-colors ${
                    selected
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => onPropertyFilterChange(filter)}
                >
                  {t(
                    filter === 'keyframed'
                      ? 'timeline.keyframeEditor.animatedProperties'
                      : 'timeline.keyframeEditor.allProperties',
                  )}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      <div
        data-testid="dopesheet-ruler"
        ref={timelineRef}
        className="relative border-l border-border cursor-ew-resize overflow-x-clip"
        style={{ height: RULER_HEIGHT }}
        onPointerDown={onRulerPointerDown}
        onPointerMove={onRulerPointerMove}
        onPointerUp={onRulerPointerUp}
        onPointerCancel={onRulerPointerUp}
        onPointerLeave={onRulerPointerLeave}
      >
        {liveRulerCanvas ?? (
          <div data-motion-viewport-surface data-motion-ruler-surface className="absolute inset-0">
            {rulerTickElements}
          </div>
        )}
        {reservedRightGutterWidth > 0 ? (
          <div
            data-testid="dopesheet-ruler-scrollbar-gutter"
            className="pointer-events-none absolute inset-y-0 right-0 z-10 border-l border-border/60 bg-background/80"
            style={{ width: reservedRightGutterWidth }}
          />
        ) : null}
      </div>
    </div>
  )
}
