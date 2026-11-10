import { useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import type { NamedExportPreset } from '../shared/types/settings'
import { Button, Dialog, IconButton, Input, Select, toast } from '../ui'
import './ExportPresetControl.css'

interface ExportPresetControlProps<T extends NamedExportPreset> {
  presets: T[]
  onApply: (preset: T) => void
  onSave: (name: string) => Promise<T>
  onDelete: (presetId: string) => Promise<void>
}

export function ExportPresetControl<T extends NamedExportPreset>({ presets, onApply, onSave, onDelete }: ExportPresetControlProps<T>) {
  const [selectedId, setSelectedId] = useState<string>()
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = presets.find((preset) => preset.id === selectedId)

  const handleSave = async (): Promise<void> => {
    const trimmedName = name.trim()
    if (!trimmedName || busy) return
    setBusy(true)
    try {
      const preset = await onSave(trimmedName)
      setSelectedId(preset.id)
      setName('')
      setSaveDialogOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!selected || busy) return
    setBusy(true)
    try {
      await onDelete(selected.id)
      setSelectedId(undefined)
      setDeleteDialogOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="export-preset-control">
        <Select
          variant="compact"
          className="export-preset-select"
          placeholder="导出方案"
          options={presets.map((preset) => ({ value: preset.id, label: preset.name }))}
          value={selected && selectedId}
          disabled={presets.length === 0}
          onValueChange={(id) => {
            setSelectedId(id)
            const preset = presets.find((item) => item.id === id)
            if (preset) onApply(preset)
          }}
        />
        <Button variant="secondary" size="compact" icon={<Save size={13} />} onClick={() => setSaveDialogOpen(true)}>
          保存方案
        </Button>
        {selected && (
          <IconButton variant="ghost" icon={<Trash2 size={13} />} title="删除方案" onClick={() => setDeleteDialogOpen(true)} />
        )}
      </div>

      <Dialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        title="保存方案"
        footer={(
          <>
            <Button variant="secondary" size="compact" onClick={() => setSaveDialogOpen(false)} disabled={busy}>取消</Button>
            <Button variant="primary" size="compact" onClick={() => void handleSave()} disabled={busy || !name.trim()}>保存</Button>
          </>
        )}
      >
        <Input variant="compact" fullWidth value={name} maxLength={60} autoFocus placeholder="方案名称" onChange={(event) => setName(event.target.value)} />
      </Dialog>

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="删除方案"
        footer={(
          <>
            <Button variant="secondary" size="compact" onClick={() => setDeleteDialogOpen(false)} disabled={busy}>取消</Button>
            <Button variant="danger" size="compact" onClick={() => void handleDelete()} disabled={busy}>删除</Button>
          </>
        )}
      >
        {selected?.name}
      </Dialog>
    </>
  )
}
