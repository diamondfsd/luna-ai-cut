import { useCallback, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { AtSign, Clapperboard, FileVideo, FolderKanban, Send, X } from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@freecut/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@freecut/components/ui/select'
import { Textarea } from '@freecut/components/ui/textarea'
import { useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { useProjectStore } from '@freecut/features/projects/stores/project-store'
import { useSelectionStore } from '@freecut/shared/state/selection'
import { cn } from '@freecut/shared/ui/cn'
import type { AiEditingResourceReference } from '../resource-references'
import type { AiEditingReasoningEffort } from '../store'

interface AiEditingReferenceOption extends AiEditingResourceReference {
  detail: string
  selected: boolean
}

interface MentionState {
  start: number
  end: number
  query: string
}

const MAX_REFERENCE_OPTIONS = 24
const REASONING_EFFORTS: AiEditingReasoningEffort[] = ['low', 'high', 'xhigh', 'max']

function formatTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

function mediaKindLabel(mimeType: string): string {
  if (mimeType.startsWith('video/')) return '视频素材'
  if (mimeType.startsWith('audio/')) return '音频素材'
  if (mimeType.startsWith('image/')) return '图片素材'
  return '素材'
}

function timelineKindLabel(type: string): string {
  if (type === 'video') return '视频片段'
  if (type === 'audio') return '音频片段'
  if (type === 'text') return '文字片段'
  if (type === 'image') return '图片片段'
  return '时间轴片段'
}

function findMention(value: string, cursor: number): MentionState | null {
  const beforeCursor = value.slice(0, cursor)
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCursor)
  if (!match) return null
  const query = match[2] ?? ''
  return { start: cursor - query.length - 1, end: cursor, query }
}

function ReferenceIcon({ kind }: { kind: AiEditingResourceReference['kind'] }) {
  if (kind === 'project') return <FolderKanban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  if (kind === 'media') return <FileVideo className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  return <Clapperboard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
}

export function AiEditingComposer({
  canChat,
  busy,
  reasoningEffort,
  onReasoningEffortChange,
  onSubmit,
  onCancel,
}: {
  canChat: boolean
  busy: boolean
  reasoningEffort: AiEditingReasoningEffort
  onReasoningEffortChange: (effort: AiEditingReasoningEffort) => void
  onSubmit: (text: string, references: AiEditingResourceReference[]) => void
  onCancel: () => void
}) {
  const currentProject = useProjectStore((state) => state.currentProject)
  const mediaItems = useMediaLibraryStore((state) => state.mediaItems)
  const selectedMediaIds = useMediaLibraryStore((state) => state.selectedMediaIds)
  const timelineItems = useTimelineStore((state) => state.items)
  const fps = useTimelineStore((state) => state.fps)
  const selectedItemIds = useSelectionStore((state) => state.selectedItemIds)
  const [input, setInput] = useState('')
  const [references, setReferences] = useState<AiEditingResourceReference[]>([])
  const [mention, setMention] = useState<MentionState | null>(null)
  const [activeOptionIndex, setActiveOptionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const referenceOptions = useMemo<AiEditingReferenceOption[]>(() => {
    const selectedMediaIdSet = new Set(selectedMediaIds)
    const selectedItemIdSet = new Set(selectedItemIds)
    const resolvedFps = fps > 0 ? fps : 30
    const options: AiEditingReferenceOption[] = [
      ...(currentProject ? [{
        kind: 'project' as const,
        id: currentProject.id,
        label: currentProject.name,
        detail: '当前项目',
        selected: false,
      }] : []),
      ...mediaItems.map((item) => ({
        kind: 'media' as const,
        id: item.id,
        label: item.fileName,
        detail: mediaKindLabel(item.mimeType),
        selected: selectedMediaIdSet.has(item.id),
      })),
      ...timelineItems.map((item) => ({
        kind: 'timeline-clip' as const,
        id: item.id,
        label: item.label || timelineKindLabel(item.type),
        detail: `${timelineKindLabel(item.type)} ${formatTime(item.from / resolvedFps)}-${formatTime((item.from + item.durationInFrames) / resolvedFps)}`,
        selected: selectedItemIdSet.has(item.id),
      })),
    ]
    return options.sort((left, right) => Number(right.selected) - Number(left.selected) || left.label.localeCompare(right.label, 'zh-CN'))
  }, [currentProject, fps, mediaItems, selectedItemIds, selectedMediaIds, timelineItems])

  const visibleOptions = useMemo(() => {
    const query = mention?.query.trim().toLocaleLowerCase() ?? ''
    return referenceOptions
      .filter((option) => !references.some((reference) => reference.kind === option.kind && reference.id === option.id))
      .filter((option) => !query || `${option.label} ${option.detail}`.toLocaleLowerCase().includes(query))
      .slice(0, MAX_REFERENCE_OPTIONS)
  }, [mention?.query, referenceOptions, references])

  const closeMention = useCallback(() => {
    setMention(null)
    setActiveOptionIndex(0)
  }, [])

  const updateMention = useCallback((value: string, cursor: number) => {
    const nextMention = findMention(value, cursor)
    setMention(nextMention)
    setActiveOptionIndex(0)
  }, [])

  const handleInputChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = event.currentTarget
    setInput(value)
    updateMention(value, selectionStart ?? value.length)
  }, [updateMention])

  const selectReference = useCallback((option: AiEditingReferenceOption) => {
    const activeMention = mention
    setReferences((current) => current.some((reference) => reference.kind === option.kind && reference.id === option.id)
      ? current
      : [...current, { kind: option.kind, id: option.id, label: option.label }])
    if (activeMention) {
      setInput((current) => `${current.slice(0, activeMention.start)}${current.slice(activeMention.end)}`)
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(activeMention.start, activeMention.start)
      })
    }
    closeMention()
  }, [closeMention, mention])

  const removeReference = useCallback((reference: AiEditingResourceReference) => {
    setReferences((current) => current.filter((entry) => entry.kind !== reference.kind || entry.id !== reference.id))
  }, [])

  const openReferencePicker = useCallback(() => {
    const cursor = textareaRef.current?.selectionStart ?? input.length
    setMention({ start: cursor, end: cursor, query: '' })
    setActiveOptionIndex(0)
  }, [input.length])

  const send = useCallback(() => {
    const text = input.trim()
    if (!text || !canChat || busy) return
    onSubmit(text, references)
    setInput('')
    setReferences([])
    closeMention()
  }, [busy, canChat, closeMention, input, onSubmit, references])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMention()
        return
      }
      if (event.key === 'ArrowDown' && visibleOptions.length > 0) {
        event.preventDefault()
        setActiveOptionIndex((index) => (index + 1) % visibleOptions.length)
        return
      }
      if (event.key === 'ArrowUp' && visibleOptions.length > 0) {
        event.preventDefault()
        setActiveOptionIndex((index) => (index - 1 + visibleOptions.length) % visibleOptions.length)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && visibleOptions[activeOptionIndex]) {
        event.preventDefault()
        selectReference(visibleOptions[activeOptionIndex])
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }, [activeOptionIndex, closeMention, mention, selectReference, send, visibleOptions])

  return (
    <div className="shrink-0 border-t border-border p-2.5">
      <Popover open={mention !== null} onOpenChange={(open) => { if (!open) closeMention() }}>
        <PopoverAnchor asChild>
          <div>
            {references.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1" aria-label="已引用的编辑资源">
                {references.map((reference) => (
                  <span key={`${reference.kind}:${reference.id}`} className="inline-flex max-w-full items-center gap-1 rounded border border-primary/25 bg-primary/5 py-0.5 pl-1.5 pr-0.5 text-[10px] text-foreground">
                    <ReferenceIcon kind={reference.kind} />
                    <span className="max-w-36 truncate">{reference.label}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-4 w-4 text-muted-foreground hover:text-foreground"
                      onClick={() => removeReference(reference)}
                      aria-label={`移除引用 ${reference.label}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </span>
                ))}
              </div>
            )}
            <div className="rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onSelect={(event) => updateMention(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
                placeholder={canChat ? '描述想要完成的剪辑' : '完成设置后开始对话'}
                className="min-h-14 max-h-28 resize-none border-0 bg-transparent px-2.5 py-2 text-xs shadow-none focus-visible:ring-0"
                disabled={!canChat || busy}
              />
              <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground"
                  onClick={openReferencePicker}
                  disabled={!canChat || busy || referenceOptions.length === 0}
                  aria-label="引用编辑资源"
                  data-tooltip="引用资源"
                >
                  <AtSign className="h-3.5 w-3.5" />
                </Button>
                <div className="flex items-center gap-1">
                  <Select
                    value={reasoningEffort}
                    onValueChange={(value) => onReasoningEffortChange(value as AiEditingReasoningEffort)}
                    disabled={busy}
                  >
                    <SelectTrigger
                      className="h-7 w-[7.25rem] border-0 px-2 text-[11px] text-muted-foreground shadow-none"
                      aria-label="思考强度"
                      data-tooltip="思考强度"
                    >
                      <span className="truncate">思考</span>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {REASONING_EFFORTS.map((effort) => (
                        <SelectItem key={effort} value={effort} className="text-xs">
                          {effort}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {busy ? (
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onCancel} aria-label="停止剪辑操作"><X className="h-3.5 w-3.5" /></Button>
                  ) : (
                    <Button type="button" size="icon" className="h-7 w-7 shrink-0" onClick={send} disabled={!canChat || !input.trim()} aria-label="发送剪辑请求"><Send className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          className="w-[min(20rem,calc(100vw-2rem))] p-1.5"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="max-h-64 overflow-y-auto" role="listbox" aria-label="可引用的编辑资源">
            {visibleOptions.map((option, index) => (
              <Button
                key={`${option.kind}:${option.id}`}
                type="button"
                variant="ghost"
                className={cn('h-auto w-full justify-start gap-2 px-2 py-1.5 text-left hover:bg-accent', index === activeOptionIndex && 'bg-accent')}
                onClick={() => selectReference(option)}
                role="option"
                aria-selected={index === activeOptionIndex}
              >
                <ReferenceIcon kind={option.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-foreground">{option.label}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{option.selected ? `已选中 · ${option.detail}` : option.detail}</span>
                </span>
              </Button>
            ))}
            {visibleOptions.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">没有找到可引用的内容</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
