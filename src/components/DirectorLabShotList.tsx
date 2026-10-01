import { useState } from 'react'
import {
  Camera,
  CloudOff,
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
import { Button, Dialog, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, IconButton, toast } from '../ui'
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
          const thumbnailTake = shot.takes.find((take) =>
            take.available && take.kind === 'photo' && take.stream_url)
            ?? shot.takes.find((take) => take.available && take.stream_url)
          const canEdit = plan.source === 'remote' && endpoint && schema

          return (
            <article className="lab-shot-row" key={shot.id}>
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
                </button>
              ) : (
                <div className="lab-shot-card-media is-empty">
                  {shot.takes.length > 0 ? <CloudOff size={20} /> : <Camera size={20} />}
                </div>
              )}
              <div className="lab-shot-row-copy">
                <div className="lab-shot-row-heading">
                  <strong title={shot.name}>{shot.name}</strong>
                  <span className="lab-shot-card-take-count">{shot.takes.length} 条素材</span>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      variant="ghost"
                      size="compact"
                      icon={<MoreHorizontal size={16} />}
                      aria-label={`${shot.name}更多操作`}
                      disabled={!canEdit || editingShotId !== null || mutating}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => beginShotEdit(shot)}>
                      <Pencil size={14} />编辑
                    </DropdownMenuItem>
                    <DropdownMenuItem destructive onSelect={() => setDeleteCandidate(shot)}>
                      <Trash2 size={14} />删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
