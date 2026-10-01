import { useState } from 'react'
import {
  ArrowRight,
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock3,
  CloudOff,
  Film,
  Folder,
  Pencil,
  Plus,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'

import type {
  DirectorLanPlanSummary,
  DirectorLanShot,
  DirectorLanTake,
  DirectorPlanSchema,
} from '../shared/types'
import { Button, Dialog, IconButton, Popover, PopoverTrigger, PopoverContent, PopoverClose, Tooltip, toast } from '../ui'
import { DirectorShotEditorDialog, type DirectorShotDraft } from './DirectorShotEditorDialog'
import '../styles/director-lab-shot-edit.css'

interface DirectorLabShotListProps {
  plan: DirectorLanPlanSummary
  schema: DirectorPlanSchema | null
  shots: DirectorLanShot[]
  endpoint: string | null
  refreshPlans: () => Promise<DirectorLanPlanSummary[]>
  onWriteStateChange: (planId: string, pending: boolean) => void
  onOpenTake: (take: DirectorLanTake) => void
}

export function DirectorLabShotList({
  plan,
  schema,
  shots,
  endpoint,
  refreshPlans,
  onWriteStateChange,
  onOpenTake,
}: DirectorLabShotListProps) {
  const [editingShotId, setEditingShotId] = useState<string | null>(null)
  const [shotDraft, setShotDraft] = useState<DirectorShotDraft | null>(null)
  const [editConflict, setEditConflict] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<DirectorLanShot | null>(null)
  const [mutating, setMutating] = useState(false)

  async function handleMutationError(error: unknown, fallback: string, deletingShotId?: string): Promise<void> {
    const message = error instanceof Error ? error.message : fallback
    if (!message.includes('HTTP 409') && !message.includes('其他端修改')) {
      toast.error(message)
      return
    }
    try {
      const latestPlans = await refreshPlans()
      if (deletingShotId) {
        const latestShot = latestPlans.find((item) => item.id === plan.id)?.shots.find((shot) => shot.id === deletingShotId)
        setDeleteCandidate(latestShot ?? null)
      }
      toast.error('计划已更新，请核对后重试')
    } catch {
      toast.error('计划有新修改，刷新失败，请稍后重试')
    }
  }

  function planUpdate(shots: Array<{
    id: string
    name: string
    duration_ms: number
    remark: string
    attributes: DirectorLanShot['attributes']
  }>) {
    if (!endpoint) throw new Error('手机尚未连接')
    return window.luna.lunaKaHttpClient.request<DirectorLanPlanSummary>(
      endpoint,
      `/api/v1/director/plans/${encodeURIComponent(plan.id)}`,
      {
        method: 'PATCH',
        body: {
          expected_revision: plan.revision ?? 0,
          title: plan.title,
          shots,
        },
      },
    )
  }

  async function addShot(): Promise<void> {
    if (!schema || !endpoint || mutating) return
    setMutating(true)
    onWriteStateChange(plan.id, true)
    try {
      await planUpdate([
        ...plan.shots,
        {
          id: `shot-${crypto.randomUUID()}`,
          name: `镜头 ${plan.shots.length + 1}`,
          duration_ms: 5000,
          remark: '',
          attributes: [],
        },
      ])
      await refreshPlans()
    } catch (error) {
      await handleMutationError(error, '新增镜头失败')
    } finally {
      setMutating(false)
      onWriteStateChange(plan.id, false)
    }
  }

  async function deleteShot(shot: DirectorLanShot): Promise<void> {
    if (!endpoint || mutating) return
    setMutating(true)
    onWriteStateChange(plan.id, true)
    try {
      await planUpdate(plan.shots.filter((item) => item.id !== shot.id))
      await refreshPlans()
      setDeleteCandidate(null)
    } catch (error) {
      await handleMutationError(error, '删除镜头失败', shot.id)
    } finally {
      setMutating(false)
      onWriteStateChange(plan.id, false)
    }
  }

  function beginShotEdit(shot: DirectorLanShot): void {
    setEditConflict(false)
    setEditingShotId(shot.id)
    setShotDraft({
      id: shot.id,
      baseRevision: plan.revision ?? 0,
      name: shot.name,
      durationMs: shot.duration_ms,
      values: Object.fromEntries((schema?.shot_fields ?? []).map((definition) => [
        definition.id,
        shot.attributes.find((attribute) =>
          attribute.id === `${shot.id}-attribute-${definition.id}`)?.description ?? '',
      ])),
      remark: shot.remark,
    })
  }

  async function saveShotEdit(): Promise<void> {
    if (!endpoint || !schema || !shotDraft || mutating) return
    const durationMs = Math.round(shotDraft.durationMs)
    if (
      !shotDraft.name.trim() ||
      !Number.isFinite(durationMs) ||
      durationMs < 1000 ||
      durationMs > 3600000
    ) {
      toast.error('请填写有效的镜头名称和时长')
      return
    }
    if (schema.shot_fields.some((field) =>
      (shotDraft.values[field.id] ?? '').length > field.max_length)) {
      toast.error('镜头内容超过长度限制')
      return
    }
    setMutating(true)
    onWriteStateChange(plan.id, true)
    try {
      if (!plan.shots.some((shot) => shot.id === shotDraft.id)) {
        throw new Error('该镜头已被删除，草稿已保留')
      }
      const shots = plan.shots.map((shot) => {
        const isEditedShot = shot.id === shotDraft.id
        return {
          id: shot.id,
          name: isEditedShot ? shotDraft.name.trim() : shot.name,
          duration_ms: isEditedShot ? durationMs : shot.duration_ms,
          remark: isEditedShot ? shotDraft.remark.trim() : shot.remark,
          attributes: isEditedShot
            ? [
                ...shot.attributes.filter((attribute) => !schema.shot_fields.some((field) =>
                  attribute.id === `${shot.id}-attribute-${field.id}`)),
                ...schema.shot_fields.flatMap((field) => {
                  const description = shotDraft.values[field.id]?.trim() ?? ''
                  return description ? [{
                    id: `${shot.id}-attribute-${field.id}`,
                    name: field.storage_name,
                    description,
                  }] : []
                }),
              ]
            : shot.attributes,
        }
      })
      await window.luna.lunaKaHttpClient.request<DirectorLanPlanSummary>(endpoint,
        `/api/v1/director/plans/${encodeURIComponent(plan.id)}`, {
          method: 'PATCH',
          body: { expected_revision: shotDraft.baseRevision, title: plan.title, shots },
        })
      setEditingShotId(null)
      setShotDraft(null)
      toast.success('镜头已保存')
      void refreshPlans().catch(() => undefined)
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError)
      if (message.includes('HTTP 409') || message.includes('已在其他端修改')) {
        let latestRevision: number | undefined
        try {
          const latest = await refreshPlans()
          latestRevision = latest.find((item) => item.id === plan.id)?.revision
        } catch {
          // Keep the draft and its original revision when refresh fails.
        }
        if (latestRevision != null) {
          setEditConflict(true)
          const revision = latestRevision
          setShotDraft((current) => current
            ? { ...current, baseRevision: revision }
            : current)
          toast.error('计划已在其他端修改，远端已刷新；确认草稿后再次保存以应用')
        } else {
          toast.error('版本冲突，远端刷新失败；当前草稿已保留')
        }
      } else {
        toast.error(message)
      }
    } finally {
      setMutating(false)
      onWriteStateChange(plan.id, false)
    }
  }

  return (
    <div className="lab-shot-browser">
      {plan.source === 'remote' && endpoint && schema && (
        <div className="lab-shot-toolbar">
          <Button variant="secondary" size="compact" icon={<Plus size={15} />}
            disabled={mutating || editingShotId !== null} onClick={() => void addShot()}>新增镜头</Button>
        </div>
      )}
      <div className="lab-shot-grid">
      {shots.map((shot) => {
        const availableCount = shot.takes.filter((take) => take.available).length
        const status = shot.takes.length === 0
          ? 'pending'
          : availableCount === 0
            ? 'missing'
            : availableCount === shot.takes.length
              ? 'complete'
              : 'partial'
        const statusLabel = status === 'pending'
          ? '待拍'
          : status === 'missing'
            ? '素材缺失'
            : `${availableCount}/${shot.takes.length} 段可用`
        const StatusIcon = status === 'complete'
          ? CheckCircle2
          : status === 'missing'
            ? AlertCircle
            : null
        const thumbnailTake = shot.takes.find((take) =>
          take.available && take.kind === 'photo' && take.stream_url)
          ?? shot.takes.find((take) => take.available && take.stream_url)

        return (
          <article className="lab-shot-row" key={shot.id}>
            <span className="lab-shot-row-index">{String(shot.order).padStart(2, '0')}</span>
            {thumbnailTake ? (
              <button
                className="lab-shot-card-media"
                type="button"
                aria-label={`预览${shot.name}素材`}
                onClick={() => onOpenTake(thumbnailTake)}
              >
                {thumbnailTake.kind === 'video' ? (
                  <video src={thumbnailTake.stream_url ?? undefined} muted preload="metadata" />
                ) : (
                  <img src={thumbnailTake.stream_url ?? undefined} alt="" loading="lazy" />
                )}
                {thumbnailTake.kind === 'video' && <Film className="lab-shot-card-media-type" size={16} />}
              </button>
            ) : (
              <div className="lab-shot-card-media is-empty">
                {shot.takes.length > 0 ? <CloudOff size={20} /> : <Camera size={20} />}
              </div>
            )}
            <div className="lab-shot-row-copy">
              <div className="lab-shot-row-heading">
                <strong>{shot.name}</strong>
                <span className={`lab-shot-status is-${status}`}>
                  {StatusIcon && <StatusIcon size={13} />}
                  {statusLabel}
                </span>
                <span className="lab-shot-target">
                  <Clock3 size={13} /> {(shot.duration_ms / 1000).toFixed(1)} 秒
                </span>
              </div>
              {schema && (
                <div className="lab-shot-field-values">
                  {schema.shot_fields.map((field) => {
                    const value = shot.attributes.find((attribute) =>
                      attribute.id === `${shot.id}-attribute-${field.id}`)?.description
                    return value ? <div key={field.id}><span>{field.label}</span><p>{value}</p></div> : null
                  })}
                  {shot.remark && <div><span>备注</span><p>{shot.remark}</p></div>}
                </div>
              )}
              {shot.takes.length > 0 && (
                <div className="lab-shot-take-strip">
                  {shot.takes.map((take) => (
                    <button
                      key={take.id}
                      type="button"
                      aria-label={`查看${take.file_name}`}
                      title={take.file_name}
                      disabled={!take.available || !take.stream_url}
                      onClick={() => onOpenTake(take)}
                    >
                      {take.available && take.stream_url ? (
                        take.kind === 'video'
                          ? <video src={take.stream_url} muted preload="metadata" />
                          : <img src={take.stream_url} alt="" loading="lazy" />
                      ) : <CloudOff size={16} />}
                      {take.kind === 'video' && <Film size={12} className="lab-shot-take-type" />}
                    </button>
                  ))}
                </div>
              )}
              <footer className="lab-shot-card-footer">
                <span className="lab-shot-card-take-count">
                  <Folder size={14} /> {shot.takes.length} 条素材
                </span>
                {plan.source === 'remote' && endpoint && schema && (
                  <div className="lab-shot-card-actions">
                    <Button variant="utility" size="mini" icon={<Pencil size={13} />}
                      disabled={editingShotId !== null || mutating} onClick={() => beginShotEdit(shot)}>编辑</Button>
                    <Popover>
                      <PopoverTrigger asChild>
                        <IconButton variant="ghost" size="mini" icon={<MoreHorizontal size={15} />}
                          aria-label={`${shot.name}更多操作`} disabled={editingShotId !== null || mutating} />
                      </PopoverTrigger>
                      <PopoverContent>
                        <PopoverClose asChild>
                          <Button variant="danger" size="compact" icon={<Trash2 size={14} />}
                            onClick={() => setDeleteCandidate(shot)}>删除镜头</Button>
                        </PopoverClose>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
                {thumbnailTake && (
                  <Tooltip content="查看素材">
                    <IconButton
                      variant="ghost"
                      size="compact"
                      icon={<ArrowRight size={15} />}
                      aria-label={`查看${shot.name}素材`}
                      onClick={() => onOpenTake(thumbnailTake)}
                    />
                  </Tooltip>
                )}
              </footer>
            </div>
          </article>
        )
      })}
      </div>
      <DirectorShotEditorDialog draft={shotDraft} schema={schema} saving={mutating} conflict={editConflict}
        onChange={setShotDraft} onClose={() => { setEditingShotId(null); setShotDraft(null) }} onSave={() => void saveShotEdit()} />
      <Dialog
        open={deleteCandidate !== null}
        onOpenChange={(open) => !open && !mutating && setDeleteCandidate(null)}
        showCloseButton={!mutating}
        title="删除镜头"
        description={deleteCandidate
          ? `删除“${deleteCandidate.name}”${deleteCandidate.takes.length > 0 ? '及其已拍素材' : ''}？`
          : undefined}
        footer={<>
          <Button variant="secondary" disabled={mutating} onClick={() => setDeleteCandidate(null)}>取消</Button>
          <Button variant="danger" disabled={mutating} onClick={() => deleteCandidate && void deleteShot(deleteCandidate)}>删除</Button>
        </>}
      />
      {shots.length === 0 && (
        <div className="lab-shot-empty">
          {plan.shots.length === 0 ? '暂无镜头' : '没有匹配的镜头'}
        </div>
      )}
    </div>
  )
}
