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
  MessageSquare,
  Pencil,
  Save,
  X,
} from 'lucide-react'

import type {
  DirectorLanPlanSummary,
  DirectorLanShot,
  DirectorLanTake,
} from '../shared/types'
import { IconButton, Input, Tooltip, toast } from '../ui'
import '../styles/director-lab-shot-edit.css'

interface DirectorLabShotListProps {
  plan: DirectorLanPlanSummary
  shots: DirectorLanShot[]
  endpoint: string | null
  refreshPlans: () => Promise<DirectorLanPlanSummary[]>
  onWriteStateChange: (planId: string, pending: boolean) => void
  onOpenTake: (take: DirectorLanTake) => void
}

interface DirectorShotDraft {
  id: string
  baseRevision: number
  name: string
  durationMs: number
  attributeDescriptions: Record<string, string>
  remark: string
}

export function DirectorLabShotList({
  plan,
  shots,
  endpoint,
  refreshPlans,
  onWriteStateChange,
  onOpenTake,
}: DirectorLabShotListProps) {
  const [editingShotId, setEditingShotId] = useState<string | null>(null)
  const [shotDraft, setShotDraft] = useState<DirectorShotDraft | null>(null)
  const [savingShotId, setSavingShotId] = useState<string | null>(null)

  function beginShotEdit(shot: DirectorLanShot): void {
    setEditingShotId(shot.id)
    setShotDraft({
      id: shot.id,
      baseRevision: plan.revision ?? 0,
      name: shot.name,
      durationMs: shot.duration_ms,
      attributeDescriptions: Object.fromEntries(plan.attributes.map((definition) => [
        definition.id,
        shot.attributes.find((attribute) =>
          attribute.id === definition.id || attribute.name === definition.name)?.description ?? '',
      ])),
      remark: shot.remark,
    })
  }

  async function saveShotEdit(): Promise<void> {
    if (!endpoint || !shotDraft) return
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
    setSavingShotId(shotDraft.id)
    onWriteStateChange(plan.id, true)
    try {
      const shots = plan.shots.map((shot) => {
        const isEditedShot = shot.id === shotDraft.id
        return {
          id: shot.id,
          name: isEditedShot ? shotDraft.name.trim() : shot.name,
          duration_ms: isEditedShot ? durationMs : shot.duration_ms,
          remark: isEditedShot ? shotDraft.remark.trim() : shot.remark,
          attributes: isEditedShot
            ? shot.attributes.map((attribute) => {
                const definition = plan.attributes.find((item) =>
                  item.id === attribute.id || item.name === attribute.name)
                return {
                  ...attribute,
                  description: definition
                    ? shotDraft.attributeDescriptions[definition.id]?.trim() ?? attribute.description
                    : attribute.description,
                }
              })
            : shot.attributes,
        }
      })
      await window.luna.lunaKaHttpClient.request<DirectorLanPlanSummary>(
        endpoint,
        `/api/v1/director/plans/${encodeURIComponent(plan.id)}`,
        {
          method: 'PATCH',
          body: {
            expected_revision: shotDraft.baseRevision,
            title: plan.title,
            attributes: plan.attributes,
            shots,
          },
        },
      )
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
      onWriteStateChange(plan.id, false)
      setSavingShotId(null)
    }
  }

  return (
    <div className="lab-shot-browser">
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
        const isEditing = editingShotId === shot.id && shotDraft?.id === shot.id
        const draft = isEditing ? shotDraft : null
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
                {draft ? (
                  <Input
                    aria-label="镜头名称"
                    variant="compact"
                    value={draft.name}
                    maxLength={120}
                    onChange={(event) => setShotDraft({ ...draft, name: event.target.value })}
                  />
                ) : <strong>{shot.name}</strong>}
                <span className={`lab-shot-status is-${status}`}>
                  {StatusIcon && <StatusIcon size={13} />}
                  {statusLabel}
                </span>
                {draft ? (
                  <label className="lab-shot-edit-duration">
                    <Clock3 size={13} />
                    <Input
                      aria-label="镜头时长秒数"
                      variant="compact"
                      type="number"
                      min="1"
                      max="3600"
                      step="0.5"
                      value={draft.durationMs / 1000}
                      onChange={(event) => setShotDraft({
                        ...draft,
                        durationMs: Number(event.target.value) * 1000,
                      })}
                    />
                    <span>秒</span>
                  </label>
                ) : (
                  <span className="lab-shot-target">
                    <Clock3 size={13} /> {(shot.duration_ms / 1000).toFixed(1)} 秒
                  </span>
                )}
                {plan.source === 'remote' && endpoint && (
                  draft ? (
                    <div className="lab-shot-edit-actions">
                      <Tooltip content="保存镜头">
                        <IconButton
                          variant="outline"
                          size="compact"
                          icon={<Save size={14} />}
                          aria-label="保存镜头"
                          disabled={savingShotId === shot.id}
                          onClick={() => void saveShotEdit()}
                        />
                      </Tooltip>
                      <Tooltip content="取消编辑">
                        <IconButton
                          variant="ghost"
                          size="compact"
                          icon={<X size={14} />}
                          aria-label="取消编辑"
                          disabled={savingShotId === shot.id}
                          onClick={() => { setEditingShotId(null); setShotDraft(null) }}
                        />
                      </Tooltip>
                    </div>
                  ) : (
                    <Tooltip content="编辑镜头">
                      <IconButton
                        variant="ghost"
                        size="compact"
                        icon={<Pencil size={14} />}
                        aria-label="编辑镜头"
                        disabled={editingShotId !== null}
                        onClick={() => beginShotEdit(shot)}
                      />
                    </Tooltip>
                  )
                )}
              </div>
              {draft && (
                <div className="lab-shot-edit-attributes">
                  {plan.attributes.map((attribute) => (
                    <label className="lab-shot-edit-attribute" key={attribute.id}>
                      <span>{attribute.name}</span>
                      <textarea
                        className="ui-input ui-input-compact lab-shot-edit-description"
                        aria-label={`${attribute.name}说明`}
                        value={draft.attributeDescriptions[attribute.id] ?? ''}
                        placeholder={`填写${attribute.name}`}
                        rows={2}
                        maxLength={4000}
                        onChange={(event) => setShotDraft({
                          ...draft,
                          attributeDescriptions: {
                            ...draft.attributeDescriptions,
                            [attribute.id]: event.target.value,
                          },
                        })}
                      />
                    </label>
                  ))}
                  {plan.attributes.length === 0 && (
                    <p className="lab-shot-edit-empty">计划未设置属性</p>
                  )}
                  <label className="lab-shot-edit-remark">
                    <span><MessageSquare size={13} />备注</span>
                    <textarea
                      className="ui-input ui-input-compact lab-shot-edit-description"
                      aria-label="镜头备注"
                      value={draft.remark}
                      placeholder="填写备注"
                      rows={2}
                      maxLength={4000}
                      onChange={(event) => setShotDraft({ ...draft, remark: event.target.value })}
                    />
                  </label>
                </div>
              )}
              <footer className="lab-shot-card-footer">
                <span className="lab-shot-card-take-count">
                  <Folder size={14} /> {shot.takes.length} 条素材
                </span>
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
      {shots.length === 0 && (
        <div className="lab-shot-empty">
          {plan.shots.length === 0 ? '暂无镜头' : '没有匹配的镜头'}
        </div>
      )}
    </div>
  )
}
