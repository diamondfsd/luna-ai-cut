import { Captions, Combine, Download, Plus, Scissors, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { WorkspaceProject, WorkspaceSubtitleCue, WorkspaceSubtitleLanguage, WorkspaceSubtitleTrack } from '../../shared/types'
import { Button, Dialog, IconButton, Input, Select, Switch, Tooltip } from '../../ui'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import type { EditPipeline } from '../shared/editPipeline'
import '../../styles/workspace-subtitles.css'

interface SubtitlePanelProps {
  duration: number
  trim: EditPipeline['trim']
  onSeek: (time: number) => void
}

function timeSeconds(milliseconds: number): string {
  return (milliseconds / 1_000).toFixed(2)
}

function updatedProject(project: WorkspaceProject, assetId: string, subtitles: WorkspaceSubtitleTrack): WorkspaceProject {
  return {
    ...project,
    assets: project.assets.map((asset) => asset.id === assetId ? { ...asset, subtitles } : asset),
  }
}

export function SubtitlePanel({ duration, trim, onSeek }: SubtitlePanelProps) {
  const media = useWorkspaceMedia()
  const project = media.currentProject
  const asset = project?.assets[media.activeIndex]
  const track = asset?.subtitles?.schemaVersion === 1 ? asset.subtitles : undefined
  const [language, setLanguage] = useState<WorkspaceSubtitleLanguage>('auto')
  const [requestId, setRequestId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ label: string; percent: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const activeIdentity = `${project?.id ?? ''}:${asset?.id ?? ''}`
  const identityRef = useRef(activeIdentity)
  identityRef.current = activeIdentity

  useEffect(() => window.luna.onWorkspaceSubtitleProgress((next) => {
    if (next.requestId === requestId) setProgress({ label: next.label, percent: next.percent })
  }), [requestId])

  useEffect(() => () => {
    if (requestId) void window.luna.workspace.cancelSubtitleTranscription(requestId)
  }, [requestId, activeIdentity])

  useEffect(() => {
    setSelectedId(null)
    setError(null)
    if (track?.language === 'zh' || track?.language === 'en') setLanguage(track.language)
  }, [activeIdentity, track?.language])

  const range = useMemo(() => ({
    startMs: Math.round((trim?.startTime ?? 0) * 1_000),
    endMs: Math.round((trim?.endTime ?? duration) * 1_000),
  }), [duration, trim?.endTime, trim?.startTime])

  const setTrack = (next: WorkspaceSubtitleTrack): void => {
    if (!project || !asset) return
    media.setCurrentProject(updatedProject(project, asset.id, next))
  }

  const patchCue = (id: string, patch: Partial<WorkspaceSubtitleCue>): void => {
    if (!track) return
    setTrack({
      ...track,
      cues: track.cues.map((cue) => cue.id === id ? { ...cue, ...patch, source: 'edited' as const } : cue)
        .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs),
    })
  }

  const beginGeneration = async (): Promise<void> => {
    if (!project || !asset || asset.kind !== 'video') return
    const nextRequestId = crypto.randomUUID()
    const identity = `${project.id}:${asset.id}`
    setRequestId(nextRequestId)
    setProgress({ label: '正在准备字幕识别', percent: null })
    setError(null)
    try {
      const result = await window.luna.workspace.transcribeSubtitles({
        requestId: nextRequestId,
        filePath: asset.path,
        startMs: range.startMs,
        endMs: range.endMs,
        language,
      })
      if (identityRef.current !== identity || result.requestId !== nextRequestId) return
      if (result.cues.length === 0) throw new Error('没有识别到可用语音')
      const subtitles: WorkspaceSubtitleTrack = {
        schemaVersion: 1,
        enabled: true,
        language: result.language,
        model: result.model,
        sourceRange: range,
        sourceFingerprint: result.sourceFingerprint,
        cues: result.cues,
        generatedAt: new Date().toISOString(),
      }
      const saved = await window.luna.workspace.saveProject(updatedProject(project, asset.id, subtitles))
      if (identityRef.current === identity) media.setCurrentProject(saved)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!/abort|cancel|取消/i.test(message)) setError(message)
    } finally {
      if (identityRef.current === identity) {
        setRequestId(null)
        setProgress(null)
      }
    }
  }

  const requestGeneration = (): void => {
    if (track?.cues.length) setReplaceOpen(true)
    else void beginGeneration()
  }

  const addCue = (): void => {
    if (!track) return
    const startMs = Math.max(range.startMs, track.cues[track.cues.length - 1]?.endMs ?? range.startMs)
    const endMs = Math.min(range.endMs, startMs + 2_000)
    if (endMs <= startMs) return
    const cue: WorkspaceSubtitleCue = { id: crypto.randomUUID(), startMs, endMs, text: '新字幕', source: 'edited' }
    setTrack({ ...track, cues: [...track.cues, cue] })
    setSelectedId(cue.id)
  }

  const splitSelected = (): void => {
    if (!track || !selectedId) return
    const index = track.cues.findIndex((cue) => cue.id === selectedId)
    const cue = track.cues[index]
    if (!cue || cue.endMs - cue.startMs < 200) return
    const middleTime = Math.round((cue.startMs + cue.endMs) / 2)
    const middleText = Math.max(1, Math.round(cue.text.length / 2))
    const first = { ...cue, endMs: middleTime, text: cue.text.slice(0, middleText).trim() || cue.text, source: 'edited' as const }
    const second = { ...cue, id: crypto.randomUUID(), startMs: middleTime, text: cue.text.slice(middleText).trim() || cue.text, source: 'edited' as const }
    setTrack({ ...track, cues: [...track.cues.slice(0, index), first, second, ...track.cues.slice(index + 1)] })
    setSelectedId(second.id)
  }

  const mergeSelected = (): void => {
    if (!track || !selectedId) return
    const index = track.cues.findIndex((cue) => cue.id === selectedId)
    const cue = track.cues[index]
    const next = track.cues[index + 1]
    if (!cue || !next) return
    const merged = { ...cue, endMs: next.endMs, text: `${cue.text}${cue.text.endsWith(' ') ? '' : ' '}${next.text}`, source: 'edited' as const }
    setTrack({ ...track, cues: [...track.cues.slice(0, index), merged, ...track.cues.slice(index + 2)] })
  }

  if (!project || !asset) return <p className="workspace-subtitle-empty">请先打开一个项目中的视频</p>

  return (
    <div className="workspace-subtitle-panel">
      <div className="workspace-subtitle-controls">
        <Select
          variant="compact"
          fullWidth
          value={language}
          disabled={Boolean(requestId)}
          placeholder="识别语言"
          options={[{ value: 'auto', label: '自动检测' }, { value: 'zh', label: '中文' }, { value: 'en', label: '英语' }]}
          onValueChange={(value) => setLanguage(value as WorkspaceSubtitleLanguage)}
        />
        {requestId ? (
          <Button variant="secondary" size="compact" onClick={() => window.luna.workspace.cancelSubtitleTranscription(requestId)}>取消识别</Button>
        ) : (
          <Button variant="primary" size="compact" icon={<Captions size={15} />} onClick={requestGeneration}>生成字幕</Button>
        )}
      </div>

      {progress && (
        <div className="workspace-subtitle-progress" role="status">
          <span>{progress.label}</span><span>{progress.percent === null ? '' : `${progress.percent}%`}</span>
          <div><i style={{ width: `${progress.percent ?? 8}%` }} /></div>
        </div>
      )}
      {error && <p className="workspace-subtitle-error" role="alert">{error}</p>}

      {track ? (
        <>
          <div className="workspace-subtitle-toolbar">
            <label><Switch ariaLabel="显示字幕" checked={track.enabled} onCheckedChange={(enabled) => setTrack({ ...track, enabled })} />显示字幕</label>
            <span>
              <Tooltip content="新增字幕"><IconButton variant="ghost" size="mini" icon={<Plus size={16} />} aria-label="新增字幕" onClick={addCue} /></Tooltip>
              <Tooltip content="拆分字幕"><IconButton variant="ghost" size="mini" icon={<Scissors size={15} />} aria-label="拆分字幕" disabled={!selectedId} onClick={splitSelected} /></Tooltip>
              <Tooltip content="与下一条合并"><IconButton variant="ghost" size="mini" icon={<Combine size={15} />} aria-label="与下一条合并" disabled={!selectedId} onClick={mergeSelected} /></Tooltip>
              <Tooltip content="导出 SRT"><IconButton variant="ghost" size="mini" icon={<Download size={16} />} aria-label="导出 SRT" onClick={() => window.luna.workspace.exportSubtitlesSrt({ sourcePath: asset.path, track, range })} /></Tooltip>
            </span>
          </div>
          <div className="workspace-subtitle-list">
            {track.cues.map((cue, index) => (
              <article key={cue.id} className={selectedId === cue.id ? 'is-selected' : ''} onClick={() => { setSelectedId(cue.id); onSeek(cue.startMs / 1_000) }}>
                <header><span>{index + 1}</span><Tooltip content="删除字幕"><IconButton variant="ghost" size="mini" icon={<Trash2 size={14} />} aria-label={`删除第 ${index + 1} 条字幕`} onClick={(event) => { event.stopPropagation(); setTrack({ ...track, cues: track.cues.filter((item) => item.id !== cue.id) }) }} /></Tooltip></header>
                <textarea aria-label={`第 ${index + 1} 条字幕文字`} value={cue.text} onClick={(event) => event.stopPropagation()} onChange={(event) => patchCue(cue.id, { text: event.target.value })} />
                <div className="workspace-subtitle-times">
                  <Input aria-label={`第 ${index + 1} 条开始时间`} variant="compact" type="number" min={0} step={0.01} value={timeSeconds(cue.startMs)} onClick={(event) => event.stopPropagation()} onChange={(event) => patchCue(cue.id, { startMs: Math.max(0, Math.round(Number(event.target.value) * 1_000)) })} />
                  <span>至</span>
                  <Input aria-label={`第 ${index + 1} 条结束时间`} variant="compact" type="number" min={0} step={0.01} value={timeSeconds(cue.endMs)} onClick={(event) => event.stopPropagation()} onChange={(event) => patchCue(cue.id, { endMs: Math.max(cue.startMs + 10, Math.round(Number(event.target.value) * 1_000)) })} />
                </div>
              </article>
            ))}
          </div>
        </>
      ) : !requestId && <p className="workspace-subtitle-empty">从视频语音生成可编辑字幕</p>}

      <Dialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        title="重新生成字幕？"
        description="识别完成后会替换当前字幕。失败或取消时会保留现有内容。"
        tone="dark"
        footer={<><Button size="compact" onClick={() => setReplaceOpen(false)}>取消</Button><Button variant="primary" size="compact" onClick={() => { setReplaceOpen(false); void beginGeneration() }}>继续生成</Button></>}
      />
    </div>
  )
}
