import { Textarea } from '../ui'
import { MessageSquare } from 'lucide-react'
import type { DirectorPlanSchema } from '../shared/types'
import { Button, Dialog, Input } from '../ui'
import './DirectorShotEditorDialog.css'

export interface DirectorShotDraft {
  id: string
  baseSignature: string
  name: string
  durationMs: number
  values: Record<string, string>
  remark: string
}

interface Props {
  draft: DirectorShotDraft | null
  schema: DirectorPlanSchema | null
  saving: boolean
  conflict: boolean
  creating?: boolean
  onChange: (draft: DirectorShotDraft) => void
  onClose: () => void
  onSave: () => void
}

export function DirectorShotEditorDialog({ draft, schema, saving, conflict, creating, onChange, onClose, onSave }: Props) {
  return <Dialog
    open={draft !== null}
    onOpenChange={(open) => !open && !saving && onClose()}
    title={creating ? '新增镜头' : '编辑镜头'}
    className="lab-shot-editor-dialog"
    showCloseButton={!saving}
    closeOnMaskClick={false}
    footer={<>
      <Button disabled={saving} onClick={onClose}>取消</Button>
      <Button variant="primary" disabled={saving} onClick={onSave}>{saving ? '保存中' : conflict ? '确认应用草稿' : '保存镜头'}</Button>
    </>}
  >
    {draft && <fieldset className="lab-shot-editor-fields" disabled={saving}>
      {conflict && <p className="lab-shot-editor-conflict" role="alert">手机已有新修改。草稿已保留，再次保存将替换该镜头内容。</p>}
      <div className="lab-shot-editor-basics">
        <label className="lab-shot-edit-attribute"><span>镜头名称</span>
          <Input variant="compact" value={draft.name} maxLength={120} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        </label>
        <label className="lab-shot-edit-attribute"><span>时长（秒）</span>
          <Input variant="compact" type="number" min="1" max="3600" step="0.5" value={draft.durationMs / 1000}
            onChange={(event) => onChange({ ...draft, durationMs: Number(event.target.value) * 1000 })} />
        </label>
      </div>
      <div className="lab-shot-edit-attributes">
        {schema?.shot_fields.map((field) => <label className="lab-shot-edit-attribute" key={field.id}>
          <span>{field.label}</span>
          {field.kind === 'multiline' ? <Textarea
            className="lab-shot-edit-description"
            value={draft.values[field.id] ?? ''} rows={3} maxLength={field.max_length}
            onChange={(event) => onChange({ ...draft, values: { ...draft.values, [field.id]: event.target.value } })}
          /> : <Input variant="compact" value={draft.values[field.id] ?? ''} maxLength={field.max_length}
            onChange={(event) => onChange({ ...draft, values: { ...draft.values, [field.id]: event.target.value } })} />}
        </label>)}
        <label className="lab-shot-edit-remark"><span><MessageSquare size={13} />备注</span>
          <Textarea className="lab-shot-edit-description" value={draft.remark} rows={3} maxLength={4000}
            onChange={(event) => onChange({ ...draft, remark: event.target.value })} />
        </label>
      </div>
    </fieldset>}
  </Dialog>
}
