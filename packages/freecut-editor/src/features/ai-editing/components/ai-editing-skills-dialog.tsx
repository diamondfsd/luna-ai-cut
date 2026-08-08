import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@freecut/components/ui/dialog'
import { Input } from '@freecut/components/ui/input'
import { Label } from '@freecut/components/ui/label'
import { Switch } from '@freecut/components/ui/switch'
import { Textarea } from '@freecut/components/ui/textarea'
import {
  addAiEditingCustomSkill,
  listAiEditingSkills,
  removeAiEditingCustomSkill,
  updateAiEditingSkillEnabled,
} from '../skills/service'
import type { AiEditingSkill } from '../skills/types'

interface AiEditingSkillsDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

interface SkillForm {
  name: string
  description: string
  triggers: string
  instructions: string
}

const EMPTY_FORM: SkillForm = { name: '', description: '', triggers: '', instructions: '' }

export function AiEditingSkillsDialog({ open, onOpenChange }: AiEditingSkillsDialogProps) {
  const [skills, setSkills] = useState<AiEditingSkill[]>([])
  const [form, setForm] = useState<SkillForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSkills(await listAiEditingSkills())
    } catch {
      setError('无法读取剪辑技能。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void reload()
  }, [open, reload])

  const updateEnabled = async (skill: AiEditingSkill, enabled: boolean): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await updateAiEditingSkillEnabled(skill.id, enabled)
      await reload()
    } catch {
      setError('无法更新剪辑技能。')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (skill: AiEditingSkill): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await removeAiEditingCustomSkill(skill.id)
      await reload()
    } catch {
      setError('无法移除剪辑技能。')
    } finally {
      setSaving(false)
    }
  }

  const add = async (): Promise<void> => {
    const triggers = form.triggers.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean)
    if (!form.name.trim() || !form.description.trim() || !form.instructions.trim() || triggers.length === 0) {
      setError('请填写名称、简介、触发词和剪辑指引。')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await addAiEditingCustomSkill({ ...form, triggers })
      setForm(EMPTY_FORM)
      await reload()
    } catch {
      setError('无法添加剪辑技能。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="freecut-app dark max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>剪辑技能</DialogTitle>
          <DialogDescription>启用适合当前创作方式的技能。每个技能会在匹配请求时提供专门的剪辑流程和风格指引。</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在读取技能</div>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <div key={skill.id} className="flex items-start gap-3 rounded-md border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{skill.name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{skill.description}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{skill.source === 'built-in' ? '内置技能' : '自定义技能'} · {skill.triggers.join('、')}</p>
                </div>
                <Switch checked={skill.enabled} onCheckedChange={(enabled) => void updateEnabled(skill, enabled)} disabled={saving} aria-label={`启用 ${skill.name}`} />
                {skill.source === 'custom' && (
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => void remove(skill)} disabled={saving} aria-label={`移除 ${skill.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /><p className="text-sm font-medium">添加自定义技能</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="editing-skill-name">名称</Label><Input id="editing-skill-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} disabled={saving} /></div>
            <div className="space-y-1.5"><Label htmlFor="editing-skill-triggers">触发词</Label><Input id="editing-skill-triggers" value={form.triggers} onChange={(event) => setForm((current) => ({ ...current, triggers: event.target.value }))} placeholder="旅行、日常、Vlog" disabled={saving} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="editing-skill-description">简介</Label><Input id="editing-skill-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} disabled={saving} /></div>
          <div className="space-y-1.5"><Label htmlFor="editing-skill-instructions">剪辑指引</Label><Textarea id="editing-skill-instructions" value={form.instructions} onChange={(event) => setForm((current) => ({ ...current, instructions: event.target.value }))} placeholder="描述镜头节奏、转场、文字和收尾的处理方式。" className="min-h-24 resize-y" disabled={saving} /></div>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" onClick={() => void add()} disabled={saving || loading}><Plus className="h-4 w-4" />添加技能</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
