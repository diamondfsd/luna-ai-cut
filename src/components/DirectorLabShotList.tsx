import { useState, type ReactNode } from 'react'
import {
  Camera,
  CloudOff,
  Pencil,
  Plus,
  MoreHorizontal,
  Trash2,
  Upload,
} from 'lucide-react'

import type {
  DirectorLanPlanSummary,
  DirectorLanShot,
  DirectorLanTake,
  DirectorPlanSchema,
} from '../shared/types'
import { Button, Dialog, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, IconButton, toast } from '../ui'
import { DirectorShotEditorDialog, type DirectorShotDraft } from './DirectorShotEditorDialog'
import { DirectorMediaThumbnail } from './DirectorMediaThumbnail'
import { DirectorShotDetailDialog } from './DirectorShotDetailDialog'
import { normalizeDirectorShotFields } from '../lib/directorShotFields'
import { directorPlanContentSignature } from '../lib/directorPlanSync'
import '../styles/director-lab-shot-edit.css'

interface DirectorLabShotListProps {
  plan: DirectorLanPlanSummary
  schema: DirectorPlanSchema | null
  shots: DirectorLanShot[]
  tools?: ReactNode
  phoneConnected: boolean
  refreshPlans: () => Promise<DirectorLanPlanSummary[]>
  onWriteStateChange: (planId: string, pending: boolean) => void
  onOpenTake: (take: DirectorLanTake) => void
  onLocalPlanChange: (plan: DirectorLanPlanSummary) => void
}

export function DirectorLabShotList({
  plan,
  schema,
  shots,
  tools,
  phoneConnected,
  refreshPlans,
  onWriteStateChange,
  onOpenTake,
  onLocalPlanChange,
}: DirectorLabShotListProps) {
  const [editingShotId, setEditingShotId] = useState<string | null>(null)
  const [shotDraft, setShotDraft] = useState<DirectorShotDraft | null>(null)
  const [editConflict, setEditConflict] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<DirectorLanShot | null>(null)
  const [mutating, setMutating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [detailShotId, setDetailShotId] = useState<string | null>(null)

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
  }>, expectedSignature = plan.local_content_signature ?? directorPlanContentSignature(plan)) {
    return window.luna.directorLab.saveLocalPlan({ ...plan,
      synced_signature: plan.synced_signature ?? directorPlanContentSignature(plan), shots: shots.map((shot, index) => ({
      ...shot, order: index + 1, completed_takes: 0, takes: [],
    })) }, expectedSignature).then((saved) => { onLocalPlanChange(saved); return saved })
  }

  function addShot(): void {
    if (mutating) return
    const id = `shot-${crypto.randomUUID()}`
    setCreating(true)
    setEditConflict(false)
    setEditingShotId(id)
    setShotDraft({ id, baseSignature: plan.local_content_signature ?? directorPlanContentSignature(plan),
      name: '', durationMs: 5000, values: {}, remark: '' })
  }

  async function addMaterials(shot: DirectorLanShot): Promise<void> {
    if (mutating) return
    setMutating(true)
    onWriteStateChange(plan.id, true)
    try {
      const saved = await window.luna.directorLab.importMaterials(plan, shot.id)
      if (saved) onLocalPlanChange(saved)
    } catch (error) {
      await handleMutationError(error, '添加素材失败')
    } finally {
      setMutating(false)
      onWriteStateChange(plan.id, false)
    }
  }

  async function deleteShot(shot: DirectorLanShot): Promise<void> {
    if (mutating) return
    const latest = plan.shots.find((item) => item.id === shot.id)
    if (JSON.stringify(latest) !== JSON.stringify(shot)) {
      setDeleteCandidate(latest ?? null)
      toast.error('镜头已更新，请重新确认删除')
      return
    }
    setMutating(true)
    onWriteStateChange(plan.id, true)
    try {
      await planUpdate(plan.shots.filter((item) => item.id !== shot.id))
      setDeleteCandidate(null)
    } catch (error) {
      await handleMutationError(error, '删除镜头失败', shot.id)
    } finally {
      setMutating(false)
      onWriteStateChange(plan.id, false)
    }
  }

  function beginShotEdit(shot: DirectorLanShot): void {
    const normalized = normalizeDirectorShotFields(shot)
    setCreating(false)
    setEditConflict(false)
    setEditingShotId(shot.id)
    setShotDraft({
      id: shot.id,
      baseSignature: plan.local_content_signature ?? directorPlanContentSignature(plan),
      name: shot.name,
      durationMs: shot.duration_ms,
      values: Object.fromEntries((schema?.shot_fields ?? []).map((definition) => [
        definition.id,
        normalized.attributes.find((attribute) =>
          attribute.id === `${shot.id}-attribute-${definition.id}`)?.description ?? '',
      ])),
      remark: normalized.remark,
    })
  }

  async function saveShotEdit(): Promise<void> {
    if (!schema || !shotDraft || mutating) return
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
      if (!creating && !plan.shots.some((shot) => shot.id === shotDraft.id)) {
        throw new Error('该镜头已被删除，草稿已保留')
      }
      const editedAttributes = schema.shot_fields.flatMap((field) => {
        const description = shotDraft.values[field.id]?.trim() ?? ''
        return description ? [{ id: `${shotDraft.id}-attribute-${field.id}`, name: field.storage_name, description }] : []
      })
      const shots = plan.shots.map((shot) => {
        const isEditedShot = shot.id === shotDraft.id
        return {
          id: shot.id,
          name: isEditedShot ? shotDraft.name.trim() : shot.name,
          duration_ms: isEditedShot ? durationMs : shot.duration_ms,
          remark: isEditedShot ? shotDraft.remark.trim() : shot.remark,
          attributes: isEditedShot
            ? editedAttributes
            : shot.attributes,
        }
      })
      if (creating) {
        onLocalPlanChange(await window.luna.directorLab.addLocalShot(plan, {
          id: shotDraft.id, name: shotDraft.name.trim(), duration_ms: durationMs, remark: shotDraft.remark.trim(),
          attributes: editedAttributes, order: plan.shots.length + 1, completed_takes: 0, takes: [],
        }))
      } else await planUpdate(shots, shotDraft.baseSignature)
      setEditingShotId(null)
      setShotDraft(null)
      toast.success('镜头已保存')
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError)
      if (message.includes('HTTP 409') || message.includes('已在其他端修改') || message.includes('计划已更新')) {
        let latestSignature: string | undefined
        try {
          const latest = await refreshPlans()
          const latestPlan = latest.find((item) => item.id === plan.id)
          if (latestPlan) latestSignature = latestPlan.local_content_signature ?? directorPlanContentSignature(latestPlan)
        } catch {
          // Keep the draft and its original revision when refresh fails.
        }
        if (latestSignature != null) {
          setEditConflict(true)
          const signature = latestSignature
          setShotDraft((current) => current
            ? { ...current, baseSignature: signature }
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
      <div className="lab-director-toolbar">
        {tools}
        {schema && (
          <Button variant="secondary" size="compact" icon={<Plus size={15} />}
            disabled={mutating || editingShotId !== null} onClick={() => void addShot()}>新增镜头</Button>
        )}
      </div>
      <div className="lab-shot-grid">
        {shots.map((shot) => {
          const thumbnailTake = shot.takes.find((take) =>
            take.available && take.kind === 'photo' && take.stream_url)
            ?? shot.takes.find((take) => take.available && take.stream_url)
          const canEdit = Boolean(schema)

          return (
            <article className="lab-shot-row" key={shot.id}>
              <span className="lab-shot-index">{String(shot.order).padStart(2, '0')}</span>
              {thumbnailTake ? (
                <button
                  className="lab-shot-card-media"
                  type="button"
                  aria-label={`预览${shot.name}素材`}
                  onClick={() => onOpenTake(thumbnailTake)}
                >
                  <DirectorMediaThumbnail url={thumbnailTake.stream_url!} />
                </button>
              ) : (
                <button type="button" className="lab-shot-card-media is-empty" aria-label={`查看${shot.name}拍摄详情`}
                  onClick={() => setDetailShotId(shot.id)}>
                  {shot.takes.length > 0 ? <CloudOff size={20} /> : <Camera size={20} />}
                </button>
              )}
              <div className="lab-shot-row-copy">
                <div className="lab-shot-row-heading">
                  <button type="button" className="lab-shot-title" title={shot.name} onClick={() => setDetailShotId(shot.id)}>{shot.name}</button>
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
                    <DropdownMenuItem onSelect={() => void addMaterials(shot)}>
                      <Upload size={14} />添加素材
                    </DropdownMenuItem>
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
      <DirectorShotDetailDialog shot={plan.shots.find((shot) => shot.id === detailShotId) ?? null}
        phoneConnected={phoneConnected}
        adding={mutating} onClose={() => setDetailShotId(null)} onAddMaterials={(shot) => void addMaterials(shot)} onOpenTake={onOpenTake} />
      <DirectorShotEditorDialog draft={shotDraft} schema={schema} saving={mutating} conflict={editConflict} creating={creating}
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
